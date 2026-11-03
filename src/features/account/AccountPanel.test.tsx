import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccountPanel, { authErrorText, parseEmailCredential } from './AccountPanel'

function fakeClient(overrides: Partial<{ signInWithOtp: unknown; verifyOtp: unknown }> = {}) {
  const auth = {
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
    ...overrides,
  }
  return { client: { auth } as unknown as SupabaseClient, auth }
}

describe('AccountPanel', () => {
  it('без ключей Supabase сообщает, что синхронизация не настроена', () => {
    render(<AccountPanel client={null} />)
    expect(screen.getByText('Синхронизация не настроена.')).toBeInTheDocument()
  })

  it('вход: email → письмо со ссылкой и кодом → ввод кода', async () => {
    const { client, auth } = fakeClient()
    render(<AccountPanel client={client} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' me@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Получить письмо для входа' }))
    expect(await screen.findByText(/Письмо отправлено на me@example.com/)).toBeInTheDocument()
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      options: { emailRedirectTo: window.location.origin + '/' },
    })

    fireEvent.change(screen.getByLabelText('Ссылка или код из письма'), {
      target: {
        value:
          ' https://abcd.supabase.co/auth/v1/verify?token=8f3a2b1c&type=magiclink&redirect_to=http://localhost:5173/vocab/ ',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await vi.waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: '8f3a2b1c', type: 'magiclink' }))
  })

  it('вход по коду (если код есть в письме)', async () => {
    const { client, auth } = fakeClient()
    render(<AccountPanel client={client} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Получить письмо для входа' }))
    fireEvent.change(await screen.findByLabelText('Ссылка или код из письма'), { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await vi.waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' }),
    )
  })

  it('непонятный текст вместо ссылки — подсказка, запрос не отправляется', async () => {
    const { client, auth } = fakeClient()
    render(<AccountPanel client={client} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Получить письмо для входа' }))
    fireEvent.change(await screen.findByLabelText('Ссылка или код из письма'), { target: { value: 'Sign in' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Вставьте ссылку из письма целиком')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('ошибка входа показывается по-русски', async () => {
    const { client } = fakeClient({
      signInWithOtp: vi.fn(async () => ({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429 } })),
    })
    render(<AccountPanel client={client} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Получить письмо для входа' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Слишком много писем')
  })
})

describe('parseEmailCredential', () => {
  it('понимает ссылку, обёрнутую почтовым сервисом, и код', () => {
    const link = 'https://abcd.supabase.co/auth/v1/verify?token=tok123&type=signup&redirect_to=x'
    expect(parseEmailCredential(`https://safelinks.example/?url=${encodeURIComponent(link)}`)).toEqual({
      token_hash: 'tok123',
      type: 'signup',
    })
    expect(parseEmailCredential('https://abcd.supabase.co/auth/v1/verify?token=t&type=weird')).toEqual({
      token_hash: 't',
      type: 'email',
    })
    expect(parseEmailCredential('12345678')).toEqual({ token: '12345678' })
    expect(parseEmailCredential('https://example.com/')).toBeNull()
    expect(parseEmailCredential('привет')).toBeNull()
  })
})

describe('authErrorText', () => {
  it('переводит частые ошибки Supabase', () => {
    expect(authErrorText({ code: 'signup_disabled' })).toMatch(/Регистрация новых пользователей выключена/)
    expect(authErrorText({ code: 'otp_expired' })).toMatch(/Неверный или устаревший код/)
    expect(authErrorText(new TypeError('Failed to fetch'))).toMatch(/Нет связи/)
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccountPanel, { authErrorText } from './AccountPanel'

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

    fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await vi.waitFor(() =>
      expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'me@example.com', token: '123456', type: 'email' }),
    )
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

describe('authErrorText', () => {
  it('переводит частые ошибки Supabase', () => {
    expect(authErrorText({ code: 'signup_disabled' })).toMatch(/Регистрация новых пользователей выключена/)
    expect(authErrorText({ code: 'otp_expired' })).toMatch(/Неверный или устаревший код/)
    expect(authErrorText(new TypeError('Failed to fetch'))).toMatch(/Нет связи/)
  })
})

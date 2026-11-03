import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db/db'

function mockMyMemory(translatedText: string) {
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ responseData: { translatedText }, responseStatus: 200, matches: [] }),
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function translateWord(text: string) {
  const input = screen.getByLabelText('Английское слово')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.submit(input.closest('form')!)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('рендерит заголовок на русском', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Словарь' })).toBeInTheDocument()
  })

  it('после перевода слово автоматически сохраняется, повтор не создаёт дубль и не ходит в сеть', async () => {
    const fetch = mockMyMemory('устойчивый')
    render(<App />)
    translateWord('resilient')
    expect(await screen.findByText('Сохранено в словарь')).toBeInTheDocument()
    expect(await db.words.where('word').equals('resilient').count()).toBe(1)

    translateWord('Resilient')
    expect(await screen.findByText('Уже в словаре')).toBeInTheDocument()
    expect(await db.words.count()).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('сохранённое слово видно на экране «Мои слова»', async () => {
    mockMyMemory('кошка')
    render(<App />)
    translateWord('cat')
    await screen.findByText('Сохранено в словарь')
    fireEvent.click(screen.getByRole('button', { name: 'Мои слова' }))
    expect(await screen.findByText('cat')).toBeInTheDocument()
  })
})

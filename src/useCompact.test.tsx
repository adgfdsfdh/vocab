import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db/db'
import { isCompact } from './useCompact'

const realWidth = window.innerWidth

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

afterEach(() => {
  setWidth(realWidth)
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})

describe('isCompact', () => {
  it('включается при ширине до 420 px', () => {
    expect(isCompact(360, '')).toBe(true)
    expect(isCompact(420, '')).toBe(true)
    expect(isCompact(421, '')).toBe(false)
  })

  it('?compact=1 включает, ?compact=0 выключает независимо от ширины', () => {
    expect(isCompact(1920, '?compact=1')).toBe(true)
    expect(isCompact(300, '?compact=0')).toBe(false)
  })
})

describe('мини-вид в приложении', () => {
  it('узкое окно → кнопки разделов внизу, заголовка нет; широкое → обычный вид', () => {
    setWidth(360)
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Разделы' })
    expect(nav).toHaveClass('bottom-nav')
    expect(screen.getByRole('button', { name: 'Слова' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Тренировка' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Словарь' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Английское слово')).toHaveFocus()

    act(() => setWidth(1200))
    expect(screen.getByRole('navigation', { name: 'Разделы' })).not.toHaveClass('bottom-nav')
    expect(screen.getByRole('heading', { name: 'Словарь' })).toBeInTheDocument()
  })

  it('?compact=1 включает мини-вид в широком окне', () => {
    setWidth(1200)
    window.history.replaceState(null, '', '/?compact=1')
    render(<App />)
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toHaveClass('bottom-nav')
  })

  it('Enter = перевести и сохранить; слово выделено, чтобы печатать следующее поверх', async () => {
    setWidth(360)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ responseData: { translatedText: 'дом' }, responseStatus: 200, matches: [] }),
      })),
    )
    render(<App />)
    const input = screen.getByLabelText('Английское слово') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'house' } })
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText('дом')).toBeInTheDocument()
    expect(await screen.findByText('Сохранено в словарь')).toBeInTheDocument()
    expect(await db.words.where('word').equals('house').count()).toBe(1)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5])
  })

  it('при возврате в окно курсор снова в поле ввода', () => {
    setWidth(360)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Слова' }))
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }))
    const input = screen.getByLabelText('Английское слово')
    input.blur()
    expect(input).not.toHaveFocus()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(input).toHaveFocus()
  })
})

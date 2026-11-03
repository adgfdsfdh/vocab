import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  applyOpacity,
  clampOpacity,
  isDesktop,
  OPACITY_EVENT,
  opacityToTransparency,
  SHOWN_EVENT,
  transparencyToOpacity,
} from './desktop'

type Win = { __TAURI_INTERNALS__?: unknown }

// Подделка окна Tauri: запоминаем вызовы команд, get_opacity отдаёт сохранённое значение.
function fakeTauri(saved = 0.8) {
  const invoke = vi.fn(async (cmd: string) => (cmd === 'get_opacity' ? saved : null))
  ;(window as Win).__TAURI_INTERNALS__ = { invoke }
  return invoke
}

afterEach(() => {
  delete (window as Win).__TAURI_INTERNALS__
  document.documentElement.style.opacity = ''
})

describe('прозрачность', () => {
  it('не меньше 30% непрозрачности, мусор → непрозрачно', () => {
    expect(clampOpacity(0.1)).toBe(0.3)
    expect(clampOpacity(2)).toBe(1)
    expect(clampOpacity(Number.NaN)).toBe(1)
    expect(opacityToTransparency(0.8)).toBe(20)
    expect(transparencyToOpacity(20)).toBeCloseTo(0.8)
    expect(transparencyToOpacity(95)).toBe(0.3)
  })

  it('applyOpacity меняет прозрачность всей страницы', () => {
    applyOpacity(0.6)
    expect(document.documentElement.style.opacity).toBe('0.6')
    applyOpacity(1)
    expect(document.documentElement.style.opacity).toBe('')
  })
})

describe('в обычном браузере', () => {
  it('полосы окна Tauri нет', () => {
    expect(isDesktop()).toBe(false)
    render(<App />)
    expect(screen.queryByLabelText('Прозрачность')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Спрятать окно' })).not.toBeInTheDocument()
  })
})

describe('в окне Tauri', () => {
  it('ползунок показывает сохранённую прозрачность и сохраняет новую', async () => {
    const invoke = fakeTauri(0.8)
    render(<App />)
    const slider = screen.getByLabelText<HTMLInputElement>('Прозрачность')
    await waitFor(() => expect(document.documentElement.style.opacity).toBe('0.8'))
    expect(slider.value).toBe('20')

    fireEvent.change(slider, { target: { value: '40' } })
    expect(invoke).toHaveBeenCalledWith('set_opacity', { value: 0.6 })
    expect(document.documentElement.style.opacity).toBe('0.6')
  })

  it('прозрачность, выбранная в трее, доходит до ползунка', async () => {
    fakeTauri(1)
    render(<App />)
    const slider = screen.getByLabelText<HTMLInputElement>('Прозрачность')
    act(() => {
      window.dispatchEvent(new CustomEvent(OPACITY_EVENT, { detail: 0.5 }))
    })
    expect(slider.value).toBe('50')
    expect(document.documentElement.style.opacity).toBe('0.5')
  })

  it('«Спрятать окно» и перетаскивание за полосу вызывают команды окна', () => {
    const invoke = fakeTauri()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Спрятать окно' }))
    expect(invoke).toHaveBeenCalledWith('hide_window', undefined)

    fireEvent.mouseDown(screen.getByText(/Словарь/, { selector: '.drag-grip' }), { button: 0 })
    expect(invoke).toHaveBeenCalledWith('start_drag', undefined)

    invoke.mockClear()
    fireEvent.mouseDown(screen.getByLabelText('Прозрачность'), { button: 0 })
    expect(invoke).not.toHaveBeenCalledWith('start_drag', undefined)
  })

  it('окно показали горячей клавишей → экран перевода, курсор в поле ввода', () => {
    fakeTauri()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Мои слова|Слова/ }))
    expect(screen.queryByRole('textbox', { name: /слово/i })).not.toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event(SHOWN_EVENT))
    })
    const input = screen.getAllByRole('textbox')[0]
    expect(input).toHaveFocus()
    expect(input).toHaveClass('translate-input')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TranslateForm from './TranslateForm'
import { TranslateError } from './translate'

function typeAndEnter(text: string) {
  const input = screen.getByLabelText('Английское слово')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.submit(input.closest('form')!)
}

describe('TranslateForm', () => {
  it('поле ввода сразу в фокусе', () => {
    render(<TranslateForm translateWord={vi.fn()} />)
    expect(screen.getByLabelText('Английское слово')).toHaveFocus()
  })

  it('Enter → перевод и варианты на экране', async () => {
    const translateWord = vi.fn(async () => ({
      word: 'resilient',
      translation: 'прочный',
      alternatives: ['Выносливость', 'Устойчивый'],
    }))
    render(<TranslateForm translateWord={translateWord} />)
    typeAndEnter('resilient')
    expect(await screen.findByText('прочный')).toBeInTheDocument()
    expect(screen.getByText('Выносливость, Устойчивый')).toBeInTheDocument()
    expect(translateWord).toHaveBeenCalledWith('resilient')
  })

  it('ошибка показывается по-русски', async () => {
    render(<TranslateForm translateWord={vi.fn(async () => Promise.reject(new TranslateError('not_found')))} />)
    typeAndEnter('qwzxqq')
    expect(await screen.findByRole('alert')).toHaveTextContent('Перевод не найден')
  })

  it('пустой ввод не отправляется', () => {
    const translateWord = vi.fn()
    render(<TranslateForm translateWord={translateWord} />)
    typeAndEnter('   ')
    expect(translateWord).not.toHaveBeenCalled()
  })
})

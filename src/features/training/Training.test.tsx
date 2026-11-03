import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { addWord } from '../../db/words'
import Training from './Training'

const WORDS: [string, string][] = [
  ['cat', 'кошка'],
  ['dog', 'собака'],
  ['house', 'дом'],
  ['tree', 'дерево'],
  ['sun', 'солнце'],
]

async function seed(n = WORDS.length) {
  for (const [word, translation] of WORDS.slice(0, n)) await addWord({ word, translation, alternatives: [] })
}

const translationOf = (word: string) => WORDS.find(([w]) => w === word)![1]
const currentWord = () => document.querySelector('.flash-word')!.textContent!

describe('Training', () => {
  it('без слов просит сначала добавить слова', async () => {
    render(<Training />)
    expect(await screen.findByText(/Сначала добавьте слова/)).toBeInTheDocument()
  })

  it('«4 варианта» недоступен, если слов меньше 4', async () => {
    await seed(3)
    render(<Training />)
    expect(await screen.findByRole('button', { name: '4 варианта' })).toBeDisabled()
    expect(screen.getByText(/минимум 4 слова/)).toBeInTheDocument()
  })

  it('карточки: показать перевод, оценка с клавиатуры, итог и сохранение результатов', async () => {
    await seed()
    render(<Training />)
    fireEvent.click(await screen.findByRole('button', { name: 'Карточки' }))
    for (let i = 0; i < WORDS.length; i++) {
      const word = await screen.findByText((_, el) => el?.classList.contains('flash-word') ?? false)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(await screen.findByText(translationOf(word.textContent!))).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '1. Не помню' })).toBeInTheDocument()
      fireEvent.keyDown(window, { key: i === 0 ? '1' : '3' })
      await screen.findByText(i + 1 < WORDS.length ? `Карточки · ${i + 2} из 5` : 'Готово!')
    }
    expect(screen.getByText('Слов: 5, верно: 4')).toBeInTheDocument()
    expect(await db.reviews.count()).toBe(5)
    expect((await db.reviews.toArray()).every((r) => r.dirty === 1)).toBe(true)
  })

  it('4 варианта: правильный ответ засчитывается, неправильный показывает верный', async () => {
    await seed()
    render(<Training />)
    fireEvent.click(await screen.findByRole('button', { name: '4 варианта' }))

    await screen.findByText(/4 варианта · 1 из 5/)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`\\. ${translationOf(currentWord())}$`) }))
    expect(screen.getByText('Верно!')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Далее (Enter)' }))

    await screen.findByText(/4 варианта · 2 из 5/)
    const right = translationOf(currentWord())
    const wrong = screen.getAllByRole('button').find((b) => b.classList.contains('choice') && !b.textContent!.endsWith(right))!
    fireEvent.click(wrong)
    expect(screen.getByText(`Неверно. Правильно: ${right}`)).toBeInTheDocument()
  })

  it('написание: подсказка первой буквой, проверка без учёта регистра', async () => {
    await seed(1)
    render(<Training />)
    fireEvent.click(await screen.findByRole('button', { name: 'Написание' }))
    expect(await screen.findByText('кошка')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подсказка' }))
    expect(screen.getByRole('button', { name: 'Первая буква: c' })).toBeInTheDocument()
    const input = screen.getByLabelText('Слово по-английски')
    fireEvent.change(input, { target: { value: ' CAT ' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByText('Верно!')).toBeInTheDocument()
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText('Слов: 1, верно: 1')).toBeInTheDocument()
    // Верно, но с подсказкой → «Трудно».
    expect((await db.reviews.toArray())[0].card.last_grade).toBe(2)
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { addWord } from '../../db/words'
import WordList from './WordList'

describe('WordList («Мои слова»)', () => {
  it('пустой словарь', async () => {
    render(<WordList />)
    expect(await screen.findByText('Пока нет сохранённых слов')).toBeInTheDocument()
  })

  it('показывает слова и ищет', async () => {
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] })
    await addWord({ word: 'dog', translation: 'собака', alternatives: [] })
    render(<WordList />)
    expect(await screen.findByText('Слов: 2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'соб' } })
    expect(await screen.findByText('Слов: 1')).toBeInTheDocument()
    expect(screen.getByText('dog')).toBeInTheDocument()
    expect(screen.queryByText('cat')).not.toBeInTheDocument()
  })

  it('правка перевода сохраняется в базе', async () => {
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] })
    render(<WordList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить cat' }))
    fireEvent.change(screen.getByLabelText('Перевод слова cat'), { target: { value: 'кот' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText(/— кот/)).toBeInTheDocument()
    expect((await db.words.get(record.id))?.translation).toBe('кот')
  })

  it('удаление после подтверждения', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] })
    render(<WordList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить cat' }))
    expect(await screen.findByText('Пока нет сохранённых слов')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledWith('Удалить «cat»?')
    confirm.mockRestore()
  })
})

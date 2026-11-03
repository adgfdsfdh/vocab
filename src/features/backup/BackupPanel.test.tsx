import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { addWord } from '../../db/words'
import BackupPanel from './BackupPanel'

const file = (text: string) => new File([text], 'vocab-2026-11-03.json', { type: 'application/json' })

describe('BackupPanel', () => {
  it('«Экспорт» скачивает JSON с именем по дате', async () => {
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^vocab-\d{4}-\d{2}-\d{2}\.json$/)
    })
    render(<BackupPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт' }))
    expect(await screen.findByText('Сохранено слов: 1')).toBeInTheDocument()
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })

  it('«Импорт» показывает итог', async () => {
    render(<BackupPanel />)
    const text = JSON.stringify({
      format: 'vocab-backup',
      version: 1,
      words: [{ word: 'dog', translation: 'собака', updated_at: '2026-11-01T10:00:00.000Z' }],
      reviews: [],
    })
    fireEvent.change(screen.getByLabelText('Файл резервной копии'), { target: { files: [file(text)] } })
    expect(await screen.findByRole('status')).toHaveTextContent('Новых слов: 1, обновлено: 0, уже были: 0')
    expect(await db.words.count()).toBe(1)
  })

  it('битый файл — понятная ошибка', async () => {
    render(<BackupPanel />)
    fireEvent.change(screen.getByLabelText('Файл резервной копии'), { target: { files: [file('{oops')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Файл повреждён: это не JSON')
  })
})

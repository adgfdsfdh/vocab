import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseBackup } from '../src/features/backup/backup'
import { backupFileName, buildBackup, logLine, rotate, scrub, writeBackup } from './backup-lib.mjs'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vocab-backup-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// Строки в том виде, в каком их отдаёт Supabase (deleted — boolean, время с +00:00).
const words = [
  { id: 'a', word: 'cat', translation: 'кошка', alternatives: ['кот'], note: '', created_at: '2026-11-01T10:00:00+00:00', updated_at: '2026-11-01T10:00:00+00:00', deleted: false },
  { id: 'b', word: 'dog', translation: 'собака', alternatives: [], note: '', created_at: '2026-11-01T10:00:00+00:00', updated_at: '2026-11-02T10:00:00+00:00', deleted: true },
]
const reviews = [
  { word_id: 'a', card: { reps: 1, lapses: 0, last_review: '2026-11-01T10:00:00.000Z', correct: 1, wrong: 0, last_grade: 3 }, updated_at: '2026-11-01T10:00:00+00:00', deleted: false },
  { word_id: 'b', card: { reps: 1, lapses: 0, last_review: '2026-11-01T10:00:00.000Z', correct: 1, wrong: 0, last_grade: 3 }, updated_at: '2026-11-01T10:00:00+00:00', deleted: false },
]

describe('scripts/backup', () => {
  it('файл бэкапа читается кнопкой «Импорт» в приложении', async () => {
    const name = backupFileName(new Date(2026, 10, 3))
    expect(name).toBe('vocab-2026-11-03.json')
    await writeBackup(dir, name, buildBackup(words, reviews))
    const parsed = parseBackup(await readFile(join(dir, name), 'utf8'))
    expect(parsed.words.map((w) => w.word)).toEqual(['cat'])
    expect(parsed.reviews).toHaveLength(1)
    expect(await readdir(dir)).toEqual([name]) // временный файл не остался
  })

  it('ротация оставляет 10 самых новых копий и не трогает чужие файлы', async () => {
    for (let d = 1; d <= 13; d++) await writeFile(join(dir, `vocab-2026-10-${String(d).padStart(2, '0')}.json`), '{}')
    await writeFile(join(dir, 'заметки.txt'), 'x')
    const removed = await rotate(dir, 10)
    expect(removed.sort()).toEqual(['vocab-2026-10-01.json', 'vocab-2026-10-02.json', 'vocab-2026-10-03.json'])
    const left = (await readdir(dir)).filter((f) => f.endsWith('.json'))
    expect(left).toHaveLength(10)
    expect(left).toContain('vocab-2026-10-13.json')
    expect(await readdir(dir)).toContain('заметки.txt')
    expect(await rotate(dir, 10)).toEqual([])
  })

  it('в лог не попадают ключ, адрес и путь', () => {
    const line = scrub('fetch failed for https://x.supabase.co with sb_secret_123 in G:\\Мой диск', [
      'sb_secret_123',
      'https://x.supabase.co',
      'G:\\Мой диск',
    ])
    expect(line).toBe('fetch failed for *** with *** in ***')
    expect(logLine(new Date(2026, 10, 3, 9, 5, 7), 'OK')).toBe('2026-11-03 09:05:07 OK\n')
  })
})

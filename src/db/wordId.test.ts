import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { VocabDB, type WordRecord } from './db'
import { wordId } from './wordId'

describe('wordId', () => {
  it('одинаковый для одного слова в любом регистре и с пробелами', () => {
    expect(wordId(' Cat ')).toBe(wordId('cat'))
  })

  it('разный для разных слов и в формате UUID', () => {
    expect(wordId('cat')).not.toBe(wordId('cats'))
    expect(wordId('cat')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('нет совпадений на 20 000 разных словах', () => {
    const ids = new Set(Array.from({ length: 20000 }, (_, i) => wordId(`word${i}`)))
    expect(ids.size).toBe(20000)
  })
})

describe('миграция базы v1 → v2', () => {
  it('пересчитывает случайные id старых слов в id из слова и помечает их для отправки', async () => {
    const name = `migration-test-${Math.random()}`
    // Создаём базу «как в F03» (версия 1, случайный id).
    const old = new Dexie(name)
    old.version(1).stores({ words: 'id, &word, created_at, updated_at, deleted, dirty' })
    const rec: WordRecord = {
      id: crypto.randomUUID(),
      word: 'cat',
      translation: 'кошка',
      alternatives: [],
      note: '',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
      deleted: 0,
      dirty: 0,
    }
    await old.table('words').add(rec)
    old.close()

    const upgraded = new VocabDB(name)
    const all = await upgraded.words.toArray()
    expect(all).toEqual([{ ...rec, id: wordId('cat'), dirty: 1 }])
    await upgraded.delete()
  })
})

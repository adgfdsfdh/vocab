import Dexie, { type EntityTable } from 'dexie'
import { wordId } from './wordId'

// Локальная база слов в IndexedDB. Она основная: приложение работает с ней всегда,
// а синхронизация с Supabase отправляет изменённые записи (dirty = 1).
export interface WordRecord {
  id: string // uuid, вычисляется из слова (wordId) — одинаковый на всех устройствах
  word: string // английское слово, нормализованное (нижний регистр)
  translation: string
  alternatives: string[]
  note: string
  created_at: string // ISO-время
  updated_at: string // ISO-время; при конфликте синхронизации побеждает более позднее
  deleted: 0 | 1 // мягкое удаление, чтобы удаление тоже синхронизировалось
  dirty: 0 | 1 // 1 = изменено локально и ещё не отправлено в облако
}

export class VocabDB extends Dexie {
  words!: EntityTable<WordRecord, 'id'>

  constructor(name = 'vocab') {
    super(name)
    // IndexedDB не индексирует boolean, поэтому deleted/dirty — числа 0/1.
    const schema = { words: 'id, &word, created_at, updated_at, deleted, dirty' }
    this.version(1).stores(schema)
    // v2: id больше не случайный, а вычисляется из слова — пересчитываем у уже сохранённых слов.
    this.version(2)
      .stores(schema)
      .upgrade(async (tx) => {
        const table = tx.table<WordRecord, string>('words')
        const all = await table.toArray()
        await table.clear()
        await table.bulkAdd(all.map((w) => ({ ...w, id: wordId(w.word), dirty: 1 })))
      })
  }
}

export const db = new VocabDB()

import Dexie, { type EntityTable } from 'dexie'

// Локальная база слов в IndexedDB. Она основная: приложение работает с ней всегда,
// а синхронизация с Supabase (F04) отправляет изменённые записи (dirty = 1).
export interface WordRecord {
  id: string // uuid, одинаковый на всех устройствах
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
    this.version(1).stores({
      words: 'id, &word, created_at, updated_at, deleted, dirty',
    })
  }
}

export const db = new VocabDB()

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

// Результаты тренировок по слову (таблица review_state в Supabase). Поле card — JSON:
// карточка FSRS (ts-fsrs) + счётчики ответов. Поля FSRS необязательны: у записей из F05 их нет.
export interface ReviewCard {
  due?: string // ISO-время, когда показать снова
  stability?: number
  difficulty?: number
  scheduled_days?: number
  learning_steps?: number
  state?: number // 0 New, 1 Learning, 2 Review, 3 Relearning
  reps: number // сколько раз отвечали
  lapses: number // сколько раз забыли выученное
  last_review: string // ISO-время
  correct: number
  wrong: number
  last_grade: number // 1 Не помню, 2 Трудно, 3 Помню, 4 Легко (как Rating в ts-fsrs)
  introduced_at?: string // когда слово впервые попало в тренировку (для лимита новых в день)
}

export interface ReviewRecord {
  word_id: string
  card: ReviewCard
  updated_at: string
  deleted: 0 | 1
  dirty: 0 | 1
}

export class VocabDB extends Dexie {
  words!: EntityTable<WordRecord, 'id'>
  reviews!: EntityTable<ReviewRecord, 'word_id'>

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
    // v3: результаты тренировок.
    this.version(3).stores({ ...schema, reviews: 'word_id, updated_at, dirty' })
  }
}

export const db = new VocabDB()

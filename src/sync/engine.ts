import type { Table } from 'dexie'
import type { ReviewCard, ReviewRecord, VocabDB, WordRecord } from '../db/db'

// Офлайн-first синхронизация: локальная база основная; в облако уходят изменённые записи (dirty = 1),
// из облака приходят записи, изменённые после последней синхронизации. Побеждает более позднее updated_at
// (то же правило проверяет триггер lww_guard в Supabase).

export type TableName = 'words' | 'review_state'

export interface RemoteWord {
  id: string
  word: string
  translation: string
  alternatives: string[]
  note: string
  created_at: string
  updated_at: string
  deleted: boolean
  server_updated_at: string
}

export interface RemoteReview {
  word_id: string
  card: ReviewCard
  updated_at: string
  deleted: boolean
  server_updated_at: string
}

export interface RemoteRows {
  words: RemoteWord
  review_state: RemoteReview
}

export type Outgoing<T extends TableName> = Omit<RemoteRows[T], 'server_updated_at'>
export type OutgoingWord = Outgoing<'words'>

export interface Remote {
  // Записи с server_updated_at > since (или все, если since = null), по возрастанию server_updated_at.
  pull<T extends TableName>(table: T, since: string | null, limit: number): Promise<RemoteRows[T][]>
  push<T extends TableName>(table: T, rows: Outgoing<T>[]): Promise<void>
}

export interface CursorStore {
  get(): string | null
  set(value: string): void
}

export interface SyncResult {
  pushed: number
  pulled: number
}

interface LocalRow {
  updated_at: string
  dirty: 0 | 1
}

interface Spec<T extends TableName, L extends LocalRow> {
  name: T
  table: (db: VocabDB) => Table<L, string, L>
  key: (row: L) => string
  toRemote: (row: L) => Outgoing<T>
  toLocal: (row: RemoteRows[T]) => L
  // Перед записью пришедшей строки (например, убрать дубль того же слова под другим id).
  beforePut?: (db: VocabDB, incoming: L) => Promise<void>
}

const PAGE = 1000
const PUSH_CHUNK = 500
// Перекрытие при загрузке: запись, сохранённая на сервере чуть раньше уже прочитанной, тоже будет получена.
const OVERLAP_MS = 2 * 60 * 1000

const time = (iso: string) => Date.parse(iso)
const iso = (value: string) => new Date(value).toISOString()

const wordsSpec: Spec<'words', WordRecord> = {
  name: 'words',
  table: (db) => db.words as unknown as Table<WordRecord, string, WordRecord>,
  key: (w) => w.id,
  toRemote: (w) => ({
    id: w.id,
    word: w.word,
    translation: w.translation,
    alternatives: w.alternatives,
    note: w.note,
    created_at: w.created_at,
    updated_at: w.updated_at,
    deleted: w.deleted === 1,
  }),
  toLocal: (r) => ({
    id: r.id,
    word: r.word,
    translation: r.translation,
    alternatives: Array.isArray(r.alternatives) ? r.alternatives : [],
    note: r.note ?? '',
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted: r.deleted ? 1 : 0,
    dirty: 0,
  }),
  async beforePut(db, incoming) {
    const sameWord = await db.words.where('word').equals(incoming.word).first()
    if (sameWord && sameWord.id !== incoming.id) await db.words.delete(sameWord.id)
  },
}

const reviewsSpec: Spec<'review_state', ReviewRecord> = {
  name: 'review_state',
  table: (db) => db.reviews as unknown as Table<ReviewRecord, string, ReviewRecord>,
  key: (r) => r.word_id,
  toRemote: (r) => ({ word_id: r.word_id, card: r.card, updated_at: r.updated_at, deleted: r.deleted === 1 }),
  toLocal: (r) => ({
    word_id: r.word_id,
    card: r.card,
    updated_at: iso(r.updated_at),
    deleted: r.deleted ? 1 : 0,
    dirty: 0,
  }),
}

async function push<T extends TableName, L extends LocalRow>(spec: Spec<T, L>, remote: Remote, db: VocabDB) {
  const table = spec.table(db)
  const dirty = await table.where('dirty').equals(1).toArray()
  for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
    const chunk = dirty.slice(i, i + PUSH_CHUNK)
    await remote.push(spec.name, chunk.map(spec.toRemote))
    // Снимаем флаг только если запись не изменилась, пока шла отправка.
    await db.transaction('rw', table, async () => {
      for (const sent of chunk) {
        const current = await table.get(spec.key(sent))
        if (current && current.dirty === 1 && current.updated_at === sent.updated_at) {
          await table.update(spec.key(sent), { dirty: 0 } as never)
        }
      }
    })
  }
  return dirty.length
}

async function merge<T extends TableName, L extends LocalRow>(
  spec: Spec<T, L>,
  rows: RemoteRows[T][],
  db: VocabDB,
) {
  const table = spec.table(db)
  await db.transaction('rw', table, async () => {
    for (const r of rows) {
      const incoming = spec.toLocal(r)
      const local = await table.get(spec.key(incoming))
      if (!local || time(incoming.updated_at) > time(local.updated_at)) {
        await spec.beforePut?.(db, incoming)
        await table.put(incoming)
      } else if (local.dirty === 1 && time(incoming.updated_at) === time(local.updated_at)) {
        await table.update(spec.key(local), { dirty: 0 } as never)
      }
    }
  })
}

async function pull<T extends TableName, L extends LocalRow>(
  spec: Spec<T, L>,
  remote: Remote,
  db: VocabDB,
  cursor: CursorStore,
) {
  const saved = cursor.get()
  let since = saved ? new Date(time(saved) - OVERLAP_MS).toISOString() : null
  let total = 0
  for (;;) {
    const rows = await remote.pull(spec.name, since, PAGE)
    if (rows.length === 0) break
    await merge(spec, rows, db)
    total += rows.length
    since = rows[rows.length - 1].server_updated_at
    cursor.set(since)
    if (rows.length < PAGE) break
  }
  return total
}

export async function mergeRemoteWords(rows: RemoteWord[], db: VocabDB): Promise<void> {
  await merge(wordsSpec, rows, db)
}

// Для каждой таблицы: сначала отправляем свои изменения, потом забираем чужие (и подтверждения своих).
export async function syncOnce(
  remote: Remote,
  db: VocabDB,
  cursorFor: (table: TableName) => CursorStore,
): Promise<SyncResult> {
  // Слова раньше результатов тренировок: результат без слова на другом устройстве бесполезен.
  const pushed = (await push(wordsSpec, remote, db)) + (await push(reviewsSpec, remote, db))
  const pulled =
    (await pull(wordsSpec, remote, db, cursorFor('words'))) +
    (await pull(reviewsSpec, remote, db, cursorFor('review_state')))
  return { pushed, pulled }
}

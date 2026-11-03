import type { VocabDB, WordRecord } from '../db/db'

// Офлайн-first синхронизация: локальная база основная; в облако уходят изменённые записи (dirty = 1),
// из облака приходят записи, изменённые после последней синхронизации. Побеждает более позднее updated_at
// (то же правило проверяет триггер lww_guard в Supabase).

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

export type OutgoingWord = Omit<RemoteWord, 'server_updated_at'>

export interface Remote {
  // Записи с server_updated_at > since (или все, если since = null), по возрастанию server_updated_at.
  pullWords(since: string | null, limit: number): Promise<RemoteWord[]>
  pushWords(rows: OutgoingWord[]): Promise<void>
}

export interface CursorStore {
  get(): string | null
  set(value: string): void
}

export interface SyncResult {
  pushed: number
  pulled: number
}

const PAGE = 1000
const PUSH_CHUNK = 500
// Перекрытие при загрузке: запись, сохранённая на сервере чуть раньше уже прочитанной, тоже будет получена.
const OVERLAP_MS = 2 * 60 * 1000

const time = (iso: string) => Date.parse(iso)
const iso = (value: string) => new Date(value).toISOString()

function toRemote(w: WordRecord): OutgoingWord {
  return {
    id: w.id,
    word: w.word,
    translation: w.translation,
    alternatives: w.alternatives,
    note: w.note,
    created_at: w.created_at,
    updated_at: w.updated_at,
    deleted: w.deleted === 1,
  }
}

function toLocal(r: RemoteWord): WordRecord {
  return {
    id: r.id,
    word: r.word,
    translation: r.translation,
    alternatives: Array.isArray(r.alternatives) ? r.alternatives : [],
    note: r.note ?? '',
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted: r.deleted ? 1 : 0,
    dirty: 0,
  }
}

async function push(remote: Remote, db: VocabDB): Promise<number> {
  const dirty = await db.words.where('dirty').equals(1).toArray()
  for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
    const chunk = dirty.slice(i, i + PUSH_CHUNK)
    await remote.pushWords(chunk.map(toRemote))
    // Снимаем флаг только если запись не изменилась, пока шла отправка.
    await db.transaction('rw', db.words, async () => {
      for (const sent of chunk) {
        const current = await db.words.get(sent.id)
        if (current && current.dirty === 1 && current.updated_at === sent.updated_at) {
          await db.words.update(sent.id, { dirty: 0 })
        }
      }
    })
  }
  return dirty.length
}

export async function mergeRemote(rows: RemoteWord[], db: VocabDB): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    for (const r of rows) {
      const incoming = toLocal(r)
      const local = await db.words.get(incoming.id)
      if (!local || time(incoming.updated_at) > time(local.updated_at)) {
        // То же слово могло остаться под другим id (старая запись) — убираем, чтобы не было дубля.
        const sameWord = await db.words.where('word').equals(incoming.word).first()
        if (sameWord && sameWord.id !== incoming.id) await db.words.delete(sameWord.id)
        await db.words.put(incoming)
      } else if (local.dirty === 1 && time(incoming.updated_at) === time(local.updated_at)) {
        await db.words.update(local.id, { dirty: 0 })
      }
    }
  })
}

async function pull(remote: Remote, db: VocabDB, cursor: CursorStore): Promise<number> {
  const saved = cursor.get()
  let since = saved ? new Date(time(saved) - OVERLAP_MS).toISOString() : null
  let total = 0
  for (;;) {
    const rows = await remote.pullWords(since, PAGE)
    if (rows.length === 0) break
    await mergeRemote(rows, db)
    total += rows.length
    since = rows[rows.length - 1].server_updated_at
    cursor.set(since)
    if (rows.length < PAGE) break
  }
  return total
}

// Сначала отправляем свои изменения, потом забираем чужие (и подтверждения своих).
export async function syncOnce(remote: Remote, db: VocabDB, cursor: CursorStore): Promise<SyncResult> {
  const pushed = await push(remote, db)
  const pulled = await pull(remote, db, cursor)
  return { pushed, pulled }
}

import { db as defaultDb, type ReviewCard, type ReviewRecord, type VocabDB, type WordRecord } from '../../db/db'
import { wordId } from '../../db/wordId'
import { normalizeWord } from '../translate/translate'

// Файл резервной копии. Тот же формат пишет scripts/backup.mjs, поэтому его бэкап можно импортировать
// в приложении. Поля — как в таблицах Supabase (deleted — boolean). Удалённые записи не выгружаются.
export const BACKUP_FORMAT = 'vocab-backup'
export const BACKUP_VERSION = 1

export interface BackupWord {
  id: string
  word: string
  translation: string
  alternatives: string[]
  note: string
  created_at: string
  updated_at: string
}

export interface BackupReview {
  word_id: string
  card: ReviewCard
  updated_at: string
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exported_at: string
  words: BackupWord[]
  reviews: BackupReview[]
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export function buildBackup(words: WordRecord[], reviews: ReviewRecord[], now = new Date()): Backup {
  const live = words.filter((w) => !w.deleted)
  const ids = new Set(live.map((w) => w.id))
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    words: live.map((w) => ({
      id: w.id,
      word: w.word,
      translation: w.translation,
      alternatives: w.alternatives,
      note: w.note,
      created_at: w.created_at,
      updated_at: w.updated_at,
    })),
    reviews: reviews
      .filter((r) => !r.deleted && ids.has(r.word_id))
      .map((r) => ({ word_id: r.word_id, card: r.card, updated_at: r.updated_at })),
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const iso = (v: string) => new Date(v).toISOString()

// Проверяет файл и приводит записи к единому виду. id слова пересчитывается из самого слова,
// чтобы один и тот же word всегда давал одну запись.
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('Файл повреждён: это не JSON')
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT) throw new BackupError('Это не файл резервной копии словаря')
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupError('Файл сделан более новой версией приложения. Обновите приложение')
  }
  if (!Array.isArray(data.words) || !Array.isArray(data.reviews)) throw new BackupError('В файле нет списка слов')

  const words = data.words.map((w, i): BackupWord => {
    const word = isObject(w) && typeof w.word === 'string' ? normalizeWord(w.word) : ''
    if (!isObject(w) || !word || typeof w.translation !== 'string' || !isTime(w.updated_at)) {
      throw new BackupError(`Файл повреждён: слово №${i + 1}`)
    }
    return {
      id: wordId(word),
      word,
      translation: w.translation,
      alternatives: Array.isArray(w.alternatives) ? w.alternatives.filter((a) => typeof a === 'string') : [],
      note: typeof w.note === 'string' ? w.note : '',
      created_at: iso(isTime(w.created_at) ? w.created_at : w.updated_at),
      updated_at: iso(w.updated_at),
    }
  })
  const reviews = data.reviews.map((r, i): BackupReview => {
    if (!isObject(r) || typeof r.word_id !== 'string' || !isObject(r.card) || !isTime(r.updated_at)) {
      throw new BackupError(`Файл повреждён: результат тренировки №${i + 1}`)
    }
    return { word_id: r.word_id, card: r.card as unknown as ReviewCard, updated_at: iso(r.updated_at) }
  })
  return {
    format: BACKUP_FORMAT,
    version: data.version,
    exported_at: isTime(data.exported_at) ? data.exported_at : '',
    words,
    reviews,
  }
}

export async function exportBackup(db: VocabDB = defaultDb, now = new Date()): Promise<Backup> {
  const [words, reviews] = await Promise.all([db.words.toArray(), db.reviews.toArray()])
  return buildBackup(words, reviews, now)
}

export interface ImportResult {
  added: number // новых слов
  updated: number // слов, у которых в файле более новая версия
  unchanged: number // слов, которые уже есть и не новее
  reviews: number // обновлённых результатов тренировок
}

// Слияние: новое слово добавляется, существующее заменяется только если в файле оно новее (updated_at).
// Изменённые записи помечаются dirty и уйдут в облако при следующей синхронизации.
export async function importBackup(backup: Backup, db: VocabDB = defaultDb): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0, reviews: 0 }
  await db.transaction('rw', db.words, db.reviews, async () => {
    for (const w of backup.words) {
      const existing = await db.words.where('word').equals(w.word).first()
      if (existing && Date.parse(existing.updated_at) >= Date.parse(w.updated_at)) {
        result.unchanged++
        continue
      }
      if (existing && existing.id !== w.id) await db.words.delete(existing.id)
      await db.words.put({ ...w, deleted: 0, dirty: 1 })
      if (existing) result.updated++
      else result.added++
    }
    const known = new Set(backup.words.map((w) => w.id))
    for (const r of backup.reviews) {
      if (!known.has(r.word_id)) continue
      const existing = await db.reviews.get(r.word_id)
      if (existing && Date.parse(existing.updated_at) >= Date.parse(r.updated_at)) continue
      await db.reviews.put({ ...r, deleted: 0, dirty: 1 })
      result.reviews++
    }
  })
  return result
}

export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `vocab-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

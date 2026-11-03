import { normalizeWord, type Translation } from '../features/translate/translate'
import { db as defaultDb, type VocabDB, type WordRecord } from './db'
import { wordId } from './wordId'

const now = () => new Date().toISOString()

export async function findWord(word: string, db: VocabDB = defaultDb): Promise<WordRecord | undefined> {
  const found = await db.words.where('word').equals(normalizeWord(word)).first()
  return found && !found.deleted ? found : undefined
}

// Сохраняет переведённое слово. Если слово уже есть — дубль не создаётся.
// Если слово было удалено — оно восстанавливается с новым переводом.
export async function addWord(
  t: Translation,
  db: VocabDB = defaultDb,
): Promise<{ record: WordRecord; created: boolean }> {
  const word = normalizeWord(t.word)
  return db.transaction('rw', db.words, async () => {
    const existing = await db.words.where('word').equals(word).first()
    if (existing && !existing.deleted) return { record: existing, created: false }

    const time = now()
    const record: WordRecord = existing
      ? { ...existing, translation: t.translation, alternatives: t.alternatives, deleted: 0, dirty: 1, updated_at: time }
      : {
          id: wordId(word),
          word,
          translation: t.translation,
          alternatives: t.alternatives,
          note: '',
          created_at: time,
          updated_at: time,
          deleted: 0,
          dirty: 1,
        }
    await db.words.put(record)
    return { record, created: true }
  })
}

// Слова для экрана «Мои слова»: без удалённых, новые сверху, поиск по слову, переводу, вариантам и заметке.
export async function listWords(query = '', db: VocabDB = defaultDb): Promise<WordRecord[]> {
  const q = query.trim().toLowerCase()
  const all = await db.words.orderBy('created_at').reverse().toArray()
  return all.filter(
    (w) =>
      !w.deleted &&
      (!q ||
        w.word.includes(q) ||
        w.translation.toLowerCase().includes(q) ||
        w.alternatives.some((a) => a.toLowerCase().includes(q)) ||
        w.note.toLowerCase().includes(q)),
  )
}

export async function updateWord(
  id: string,
  changes: Partial<Pick<WordRecord, 'translation' | 'note'>>,
  db: VocabDB = defaultDb,
): Promise<void> {
  const patch: Partial<WordRecord> = { updated_at: now(), dirty: 1 }
  if (changes.translation !== undefined) patch.translation = changes.translation.trim()
  if (changes.note !== undefined) patch.note = changes.note.trim()
  await db.words.update(id, patch)
}

export async function deleteWord(id: string, db: VocabDB = defaultDb): Promise<void> {
  await db.words.update(id, { deleted: 1, dirty: 1, updated_at: now() })
}

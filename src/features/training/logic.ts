import { db as defaultDb, type ReviewRecord, type VocabDB, type WordRecord } from '../../db/db'
import { schedule } from '../srs/srs'
import { normalizeWord } from '../translate/translate'

// Оценка ответа — те же числа, что Rating в ts-fsrs (F06): 1 Again, 2 Hard, 3 Good, 4 Easy.
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const
export type Grade = (typeof Grade)[keyof typeof Grade]

export const GRADE_LABELS: Record<Grade, string> = {
  1: 'Не помню',
  2: 'Трудно',
  3: 'Помню',
  4: 'Легко',
}

export type Mode = 'cards' | 'choice' | 'spelling'
export const MIN_WORDS_FOR_CHOICE = 4
export const SESSION_SIZE = 10

type Rng = () => number

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Случайные слова — для тренировки «вне расписания», когда на сегодня всё повторено.
export function pickSession(words: readonly WordRecord[], size = SESSION_SIZE, rng: Rng = Math.random): WordRecord[] {
  return shuffle(
    words.filter((w) => !w.deleted),
    rng,
  ).slice(0, size)
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Неправильные переводы для режима «4 варианта» — из других моих слов, без повторов и без правильного.
export function distractorPool(target: WordRecord, words: readonly WordRecord[]): string[] {
  const seen = new Set([target.translation.trim().toLowerCase()])
  const pool: string[] = []
  for (const w of words) {
    if (w.id === target.id || w.deleted) continue
    const key = w.translation.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    pool.push(w.translation)
  }
  return pool
}

export function canPlayChoice(words: readonly WordRecord[]): boolean {
  const translations = new Set(words.filter((w) => !w.deleted).map((w) => w.translation.trim().toLowerCase()))
  return translations.size >= MIN_WORDS_FOR_CHOICE
}

export function buildChoices(target: WordRecord, words: readonly WordRecord[], rng: Rng = Math.random): string[] {
  const wrong = shuffle(distractorPool(target, words), rng).slice(0, 3)
  return shuffle([target.translation, ...wrong], rng)
}

export function isChoiceCorrect(target: WordRecord, choice: string): boolean {
  return same(target.translation, choice)
}

export function checkSpelling(target: WordRecord, input: string): boolean {
  return normalizeWord(input) === target.word
}

export function spellingHint(target: WordRecord): string {
  return target.word.charAt(0)
}

// Карточки: оценку выбирает человек. В режимах с проверкой: неверно → «Не помню»,
// верно с подсказкой → «Трудно», верно → «Помню».
export function gradeForAnswer(correct: boolean, usedHint = false): Grade {
  if (!correct) return Grade.Again
  return usedHint ? Grade.Hard : Grade.Good
}

export const isRemembered = (g: Grade) => g >= Grade.Hard

// Сохраняет результат ответа в слово (таблица reviews) и пересчитывает расписание FSRS —
// дальше запись заберёт синхронизация.
export async function recordAnswer(wordId: string, grade: Grade, db: VocabDB = defaultDb): Promise<ReviewRecord> {
  return db.transaction('rw', db.reviews, async () => {
    const now = new Date()
    const prev = (await db.reviews.get(wordId))?.card
    const card = schedule(prev, grade, now)
    const record: ReviewRecord = { word_id: wordId, card, updated_at: now.toISOString(), deleted: 0, dirty: 1 }
    await db.reviews.put(record)
    return record
  })
}

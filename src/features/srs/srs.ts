import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade as FsrsGrade } from 'ts-fsrs'
import type { ReviewCard, ReviewRecord, WordRecord } from '../../db/db'

// Интервальное повторение по алгоритму FSRS (библиотека ts-fsrs, как в Anki).
// Карточка FSRS хранится в review_state.card вместе со счётчиками ответов и синхронизируется.

export const DEFAULT_NEW_PER_DAY = 20
export const SESSION_LIMIT = 20

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }))

const iso = (d: Date) => d.toISOString()

// Карточка ts-fsrs из сохранённого JSON. Нет карточки — новое слово: пустая карточка createEmptyCard.
export function toFsrsCard(card: ReviewCard | undefined, now: Date): Card {
  if (!card?.due) return createEmptyCard(now)
  return {
    due: new Date(card.due),
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 0,
    scheduled_days: card.scheduled_days ?? 0,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    state: (card.state ?? State.New) as State,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  }
}

// Новое состояние карточки после ответа с оценкой 1–4 (Не помню / Трудно / Помню / Легко).
export function schedule(prev: ReviewCard | undefined, grade: FsrsGrade, now: Date): ReviewCard {
  const { card } = scheduler.next(toFsrsCard(prev, now), now, grade)
  const remembered = grade >= 2
  return {
    due: iso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: iso(now),
    correct: (prev?.correct ?? 0) + (remembered ? 1 : 0),
    wrong: (prev?.wrong ?? 0) + (remembered ? 0 : 1),
    last_grade: grade,
    introduced_at: prev?.introduced_at ?? iso(now),
  }
}

export function startOfDay(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

export interface Queue {
  due: WordRecord[] // пора повторить, самые просроченные первыми
  fresh: WordRecord[] // новые на сегодня (с учётом дневного лимита)
}

export function buildQueue(
  words: readonly WordRecord[],
  reviews: readonly ReviewRecord[],
  now: Date,
  newPerDay = DEFAULT_NEW_PER_DAY,
): Queue {
  const byWord = new Map(reviews.filter((r) => !r.deleted).map((r) => [r.word_id, r]))
  const today = startOfDay(now).getTime()
  const live = words.filter((w) => !w.deleted)

  const due: { word: WordRecord; at: number }[] = []
  const unseen: WordRecord[] = []
  for (const w of live) {
    const r = byWord.get(w.id)
    if (!r) unseen.push(w)
    else {
      // Результаты из F05 без расписания считаем «пора повторить».
      const at = r.card.due ? Date.parse(r.card.due) : 0
      if (at <= now.getTime()) due.push({ word: w, at })
    }
  }

  const introducedToday = reviews.filter(
    (r) => r.card.introduced_at && Date.parse(r.card.introduced_at) >= today && byWord.has(r.word_id),
  ).length
  const freshLeft = Math.max(0, newPerDay - introducedToday)

  return {
    due: due.sort((a, b) => a.at - b.at).map((d) => d.word),
    fresh: unseen.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, freshLeft),
  }
}

// Ближайшее будущее повторение — чтобы сказать «следующее повторение …», когда на сегодня всё.
export function nextDue(reviews: readonly ReviewRecord[], now: Date): Date | undefined {
  const times = reviews
    .filter((r) => !r.deleted && r.card.due && Date.parse(r.card.due) > now.getTime())
    .map((r) => Date.parse(r.card.due!))
  return times.length ? new Date(Math.min(...times)) : undefined
}

const NEW_PER_DAY_KEY = 'vocab:newPerDay'

export function getNewPerDay(): number {
  try {
    const n = Number(localStorage.getItem(NEW_PER_DAY_KEY))
    return Number.isInteger(n) && n >= 0 && n <= 500 && localStorage.getItem(NEW_PER_DAY_KEY) !== null
      ? n
      : DEFAULT_NEW_PER_DAY
  } catch {
    return DEFAULT_NEW_PER_DAY
  }
}

export function setNewPerDay(n: number): void {
  try {
    localStorage.setItem(NEW_PER_DAY_KEY, String(Math.max(0, Math.min(500, Math.round(n)))))
  } catch {
    // не сохранилось — останется значение по умолчанию
  }
}

import { describe, expect, it } from 'vitest'
import type { ReviewRecord, WordRecord } from '../../db/db'
import { wordId } from '../../db/wordId'
import { buildQueue, nextDue, schedule, toFsrsCard } from './srs'

const NOW = new Date('2026-11-03T10:00:00Z')
const plus = (ms: number) => new Date(NOW.getTime() + ms)
const MIN = 60_000
const DAY = 24 * 60 * MIN

function word(w: string, created = '2026-11-01T00:00:00.000Z'): WordRecord {
  return { id: wordId(w), word: w, translation: w, alternatives: [], note: '', created_at: created, updated_at: created, deleted: 0, dirty: 0 }
}

function review(w: string, card: ReviewRecord['card']): ReviewRecord {
  return { word_id: wordId(w), card, updated_at: card.last_review, deleted: 0, dirty: 0 }
}

describe('schedule (FSRS)', () => {
  it('новое слово получает пустую карточку createEmptyCard', () => {
    const c = toFsrsCard(undefined, NOW)
    expect(c).toMatchObject({ state: 0, reps: 0, lapses: 0, stability: 0, due: NOW })
  })

  it('после «Не помню» следующий показ раньше, чем после «Трудно», «Помню» и «Легко»', () => {
    const due = [1, 2, 3, 4].map((g) => Date.parse(schedule(undefined, g as 1, NOW).due!))
    expect(due[0]).toBeLessThan(due[1])
    expect(due[1]).toBeLessThan(due[2])
    expect(due[2]).toBeLessThan(due[3])
    // «Не помню» — через минуты, «Легко» — через дни.
    expect(due[0] - NOW.getTime()).toBeLessThan(5 * MIN)
    expect(due[3] - NOW.getTime()).toBeGreaterThan(2 * DAY)
  })

  it('выученное слово уходит на всё более долгий срок, а забытое возвращается скоро', () => {
    let card = schedule(undefined, 3, NOW)
    let at = new Date(card.due!)
    card = schedule(card, 3, at) // выучено
    const firstInterval = Date.parse(card.due!) - at.getTime()
    at = new Date(card.due!)
    const remembered = schedule(card, 3, at)
    const forgotten = schedule(card, 1, at)
    expect(Date.parse(remembered.due!) - at.getTime()).toBeGreaterThan(firstInterval)
    expect(Date.parse(forgotten.due!)).toBeLessThan(Date.parse(remembered.due!))
    expect(forgotten.lapses).toBe(1)
  })

  it('хранит счётчики ответов и дату первого показа', () => {
    const a = schedule(undefined, 3, NOW)
    const b = schedule(a, 1, plus(10 * MIN))
    expect(b).toMatchObject({ reps: 2, correct: 1, wrong: 1, last_grade: 1, introduced_at: NOW.toISOString() })
  })

  it('продолжает расписание результатов из F05 (без полей FSRS)', () => {
    const legacy = { reps: 3, lapses: 1, correct: 2, wrong: 1, last_grade: 3, last_review: '2026-11-02T10:00:00.000Z' }
    const next = schedule(legacy, 3, NOW)
    expect(next.due).toBeDefined()
    expect(next.correct).toBe(3)
  })
})

describe('buildQueue', () => {
  const words = [word('new2', '2026-11-02T00:00:00.000Z'), word('new1'), word('late'), word('later'), word('future')]
  const reviews = [
    review('late', { ...schedule(undefined, 3, plus(-2 * DAY)), due: plus(-DAY).toISOString() }),
    review('later', { ...schedule(undefined, 3, plus(-2 * DAY)), due: plus(-MIN).toISOString() }),
    review('future', { ...schedule(undefined, 4, plus(-DAY)), due: plus(DAY).toISOString() }),
  ]

  it('сначала пора повторить (самые просроченные первыми), потом новые (старые первыми)', () => {
    const q = buildQueue(words, reviews, NOW)
    expect(q.due.map((w) => w.word)).toEqual(['late', 'later'])
    expect(q.fresh.map((w) => w.word)).toEqual(['new1', 'new2'])
  })

  it('слово с «Легко» не попадает в повторение сегодня', () => {
    const q = buildQueue(words, reviews, NOW)
    expect([...q.due, ...q.fresh].map((w) => w.word)).not.toContain('future')
  })

  it('лимит новых слов в день учитывает уже начатые сегодня', () => {
    const many = Array.from({ length: 30 }, (_, i) => word(`w${i}`))
    expect(buildQueue(many, [], NOW).fresh).toHaveLength(20)
    expect(buildQueue(many, [], NOW, 5).fresh).toHaveLength(5)
    const startedToday = many.slice(0, 18).map((w) => review(w.word, schedule(undefined, 3, NOW)))
    expect(buildQueue(many, startedToday, plus(MIN)).fresh).toHaveLength(2)
  })

  it('удалённые слова не попадают в очередь', () => {
    const q = buildQueue([{ ...word('gone'), deleted: 1 }], [], NOW)
    expect(q.fresh).toEqual([])
  })

  it('nextDue — ближайшее будущее повторение', () => {
    expect(nextDue(reviews, NOW)?.toISOString()).toBe(plus(DAY).toISOString())
  })
})

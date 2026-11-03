import { describe, expect, it, vi } from 'vitest'
import { db, type WordRecord } from '../../db/db'
import { wordId } from '../../db/wordId'
import {
  buildChoices,
  canPlayChoice,
  checkSpelling,
  distractorPool,
  Grade,
  gradeForAnswer,
  pickSession,
  recordAnswer,
  spellingHint,
} from './logic'

function w(word: string, translation: string, extra: Partial<WordRecord> = {}): WordRecord {
  return {
    id: wordId(word),
    word,
    translation,
    alternatives: [],
    note: '',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    deleted: 0,
    dirty: 0,
    ...extra,
  }
}

const cat = w('cat', 'кошка')
const words = [cat, w('dog', 'собака'), w('house', 'дом'), w('tree', 'дерево'), w('sun', 'солнце'), w('kitty', 'Кошка')]

describe('4 варианта', () => {
  it('один правильный + 3 неправильных из моих слов, без повторов', () => {
    for (let i = 0; i < 50; i++) {
      const choices = buildChoices(cat, words)
      expect(choices).toHaveLength(4)
      expect(new Set(choices.map((c) => c.toLowerCase())).size).toBe(4)
      expect(choices.filter((c) => c === 'кошка')).toHaveLength(1)
      expect(choices).not.toContain('Кошка') // тот же перевод у другого слова — не годится в неправильные
      for (const c of choices) expect(words.map((x) => x.translation)).toContain(c)
    }
  })

  it('порядок вариантов случайный', () => {
    const positions = new Set(Array.from({ length: 40 }, () => buildChoices(cat, words).indexOf('кошка')))
    expect(positions.size).toBeGreaterThan(1)
  })

  it('удалённые слова не попадают в неправильные варианты', () => {
    const pool = distractorPool(cat, [...words, w('ghost', 'призрак', { deleted: 1 })])
    expect(pool).not.toContain('призрак')
  })

  it('недоступен, если в словаре меньше 4 слов (с разными переводами)', () => {
    expect(canPlayChoice(words.slice(0, 3))).toBe(false)
    expect(canPlayChoice([cat, w('kitty', 'кошка'), w('dog', 'собака'), w('house', 'дом')])).toBe(false)
    expect(canPlayChoice(words.slice(0, 4))).toBe(true)
  })
})

describe('написание', () => {
  it('без учёта регистра и крайних пробелов', () => {
    expect(checkSpelling(cat, '  CaT ')).toBe(true)
    expect(checkSpelling(cat, 'cats')).toBe(false)
  })

  it('подсказка — первая буква', () => {
    expect(spellingHint(w('journey', 'поездка'))).toBe('j')
  })
})

describe('оценка ответа для FSRS', () => {
  it('неверно → Не помню, верно → Помню, верно с подсказкой → Трудно', () => {
    expect(gradeForAnswer(false)).toBe(Grade.Again)
    expect(gradeForAnswer(true)).toBe(Grade.Good)
    expect(gradeForAnswer(true, true)).toBe(Grade.Hard)
    expect(gradeForAnswer(false, true)).toBe(Grade.Again)
  })
})

describe('pickSession', () => {
  it('не больше 10 слов, без удалённых и без повторов', () => {
    const many = Array.from({ length: 30 }, (_, i) => w(`word${i}`, `слово${i}`, { deleted: i % 3 === 0 ? 1 : 0 }))
    const s = pickSession(many)
    expect(s).toHaveLength(10)
    expect(s.every((x) => !x.deleted)).toBe(true)
    expect(new Set(s.map((x) => x.id)).size).toBe(10)
  })
})

describe('recordAnswer', () => {
  it('сохраняет результат в слово и помечает его для синхронизации', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-03T10:00:00Z'))
      await recordAnswer(cat.id, Grade.Good)
      vi.setSystemTime(new Date('2026-11-03T10:01:00Z'))
      await recordAnswer(cat.id, Grade.Again)
    } finally {
      vi.useRealTimers()
    }
    const saved = await db.reviews.get(cat.id)
    expect(saved).toMatchObject({
      word_id: cat.id,
      card: {
        reps: 2,
        correct: 1,
        wrong: 1,
        last_grade: 1,
        last_review: '2026-11-03T10:01:00.000Z',
        introduced_at: '2026-11-03T10:00:00.000Z',
      },
      updated_at: '2026-11-03T10:01:00.000Z',
      deleted: 0,
      dirty: 1,
    })
    // Расписание FSRS пересчитано: после «Не помню» показать снова в ближайшие минуты.
    const due = Date.parse(saved!.card.due!)
    expect(due).toBeGreaterThan(Date.parse('2026-11-03T10:01:00Z'))
    expect(due).toBeLessThan(Date.parse('2026-11-03T10:10:00Z'))
  })
})

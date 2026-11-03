import { afterEach, describe, expect, it, vi } from 'vitest'
import { VocabDB } from '../db/db'
import { addWord, deleteWord, listWords, updateWord } from '../db/words'
import { Grade, recordAnswer } from '../features/training/logic'
import {
  syncOnce,
  type CursorStore,
  type Outgoing,
  type OutgoingWord,
  type Remote,
  type RemoteReview,
  type RemoteRows,
  type RemoteWord,
  type TableName,
} from './engine'

// Облако в памяти, ведёт себя как Supabase с триггером lww_guard.
class FakeRemote implements Remote {
  rows = new Map<string, RemoteWord>()
  reviews = new Map<string, RemoteReview>()
  private clock = Date.parse('2026-11-03T00:00:00Z')
  pullCalls: { table: TableName; since: string | null }[] = []
  beforePush?: () => Promise<void>
  failWith?: Error

  private store(table: TableName): Map<string, RemoteRows[TableName]> {
    return table === 'words' ? this.rows : this.reviews
  }

  async pull<T extends TableName>(table: T, since: string | null, limit: number) {
    if (this.failWith) throw this.failWith
    this.pullCalls.push({ table, since })
    return [...this.store(table).values()]
      .filter((r) => since === null || Date.parse(r.server_updated_at) > Date.parse(since))
      .sort((a, b) => Date.parse(a.server_updated_at) - Date.parse(b.server_updated_at))
      .slice(0, limit) as RemoteRows[T][]
  }

  async push<T extends TableName>(table: T, rows: Outgoing<T>[]) {
    if (this.failWith) throw this.failWith
    await this.beforePush?.()
    const store = this.store(table)
    for (const r of rows) {
      const row = r as Outgoing<'words'> | Outgoing<'review_state'>
      const key = 'id' in row ? row.id : row.word_id
      const old = store.get(key)
      if (old && Date.parse(row.updated_at) <= Date.parse(old.updated_at)) continue
      this.clock += 1000
      store.set(key, { ...row, server_updated_at: new Date(this.clock).toISOString() } as RemoteRows[TableName])
    }
  }
}

function memoryCursor(): CursorStore & { value: string | null } {
  return {
    value: null,
    get() {
      return this.value
    },
    set(v) {
      this.value = v
    },
  }
}

const devices: VocabDB[] = []
function device(name: string) {
  const db = new VocabDB(`sync-test-${name}-${Math.random()}`)
  devices.push(db)
  const cursors = { words: memoryCursor(), review_state: memoryCursor() }
  return { db, cursors, cursor: (t: TableName) => cursors[t] }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(devices.splice(0).map((d) => d.delete()))
})

const at = (iso: string) => vi.setSystemTime(new Date(iso))
const words = async (db: VocabDB) => (await listWords('', db)).map((w) => `${w.word}=${w.translation}`).sort()

describe('syncOnce', () => {
  it('отправляет локальные изменения и снимает флаг dirty', async () => {
    const remote = new FakeRemote()
    const pc = device('pc')
    await addWord({ word: 'cat', translation: 'кошка', alternatives: ['кот'] }, pc.db)
    const res = await syncOnce(remote, pc.db, pc.cursor)
    expect(res.pushed).toBe(1)
    expect([...remote.rows.values()][0]).toMatchObject({ word: 'cat', translation: 'кошка', alternatives: ['кот'], deleted: false })
    expect(await pc.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('слово с ПК появляется на планшете', async () => {
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)
    expect(await words(pad.db)).toEqual(['cat=кошка'])
    expect(await pad.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('работает офлайн: изменения копятся и уходят, когда сеть появилась', async () => {
    const remote = new FakeRemote()
    const pc = device('pc')
    remote.failWith = new TypeError('Failed to fetch')
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await expect(syncOnce(remote, pc.db, pc.cursor)).rejects.toThrow()
    expect(await words(pc.db)).toEqual(['cat=кошка'])
    expect(await pc.db.words.where('dirty').equals(1).count()).toBe(1)

    remote.failWith = undefined
    await syncOnce(remote, pc.db, pc.cursor)
    expect(remote.rows.size).toBe(1)
    expect(await pc.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('конфликт: побеждает более позднее изменение, на обоих устройствах одинаково', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    at('2026-11-03T08:00:00Z')
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)

    // Оба офлайн правят одно слово; на планшете правка позже.
    at('2026-11-03T09:00:00Z')
    await updateWord(record.id, { translation: 'кот (ПК)' }, pc.db)
    at('2026-11-03T10:00:00Z')
    await updateWord(record.id, { translation: 'котик (планшет)' }, pad.db)

    // Планшет синхронизируется первым, ПК — потом со своей более старой правкой.
    await syncOnce(remote, pad.db, pad.cursor)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)

    expect(await words(pc.db)).toEqual(['cat=котик (планшет)'])
    expect(await words(pad.db)).toEqual(['cat=котик (планшет)'])
    expect(remote.rows.get(record.id)?.translation).toBe('котик (планшет)')
    expect(await pc.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('удаление синхронизируется', async () => {
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)
    await deleteWord(record.id, pad.db)
    await syncOnce(remote, pad.db, pad.cursor)
    await syncOnce(remote, pc.db, pc.cursor)
    expect(await words(pc.db)).toEqual([])
    expect(remote.rows.get(record.id)?.deleted).toBe(true)
  })

  it('одно слово, добавленное офлайн на двух устройствах, не становится дублем', async () => {
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await addWord({ word: 'Cat', translation: 'кот', alternatives: [] }, pad.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)
    await syncOnce(remote, pc.db, pc.cursor)
    expect(remote.rows.size).toBe(1)
    expect(await pc.db.words.count()).toBe(1)
    expect(await pad.db.words.count()).toBe(1)
    expect(await words(pc.db)).toEqual(await words(pad.db))
  })

  it('правки одного слова в одну и ту же миллисекунду на двух устройствах сходятся к версии облака', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    at('2026-11-03T08:00:00Z')
    await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await addWord({ word: 'Cat', translation: 'кот', alternatives: [] }, pad.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)
    await syncOnce(remote, pc.db, pc.cursor)
    expect(await words(pc.db)).toEqual(['cat=кошка'])
    expect(await words(pad.db)).toEqual(['cat=кошка'])
    expect(await pad.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('правка во время отправки не теряется: остаётся dirty и уйдёт в следующий раз', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const remote = new FakeRemote()
    const pc = device('pc')
    at('2026-11-03T08:00:00Z')
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    remote.beforePush = async () => {
      remote.beforePush = undefined
      at('2026-11-03T08:00:05Z')
      await updateWord(record.id, { translation: 'кот' }, pc.db)
    }
    await syncOnce(remote, pc.db, pc.cursor)
    expect((await pc.db.words.get(record.id))?.translation).toBe('кот')
    await syncOnce(remote, pc.db, pc.cursor)
    expect(remote.rows.get(record.id)?.translation).toBe('кот')
    expect(await pc.db.words.where('dirty').equals(1).count()).toBe(0)
  })

  it('загружает больше 1000 записей постранично и потом берёт только новое', async () => {
    const remote = new FakeRemote()
    const pad = device('pad')
    const batch: OutgoingWord[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `00000000-0000-8000-8000-${String(i).padStart(12, '0')}`,
      word: `word${i}`,
      translation: `слово${i}`,
      alternatives: [],
      note: '',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
      deleted: false,
    }))
    await remote.push('words', batch)
    const first = await syncOnce(remote, pad.db, pad.cursor)
    expect(first.pulled).toBe(2500)
    expect(await pad.db.words.count()).toBe(2500)
    expect(pad.cursors.words.value).not.toBeNull()

    // Повторно читаются только записи из 2-минутного перекрытия (в фейке — 1 запись в секунду), не вся база.
    const second = await syncOnce(remote, pad.db, pad.cursor)
    expect(second.pulled).toBeLessThanOrEqual(121)
    expect(remote.pullCalls.filter((c) => c.table === 'words').at(-1)?.since).not.toBeNull()
    expect(await pad.db.words.count()).toBe(2500)
    expect(await pad.db.words.where('dirty').equals(1).count()).toBe(0)
  })
})

describe('синхронизация результатов тренировок', () => {
  it('результат с ПК появляется на планшете; побеждает более поздний', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const remote = new FakeRemote()
    const pc = device('pc')
    const pad = device('pad')
    at('2026-11-03T08:00:00Z')
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] }, pc.db)
    await recordAnswer(record.id, Grade.Good, pc.db)
    await syncOnce(remote, pc.db, pc.cursor)
    await syncOnce(remote, pad.db, pad.cursor)
    expect((await pad.db.reviews.get(record.id))?.card).toMatchObject({ reps: 1, last_grade: Grade.Good })

    at('2026-11-03T09:00:00Z')
    await recordAnswer(record.id, Grade.Again, pad.db)
    await syncOnce(remote, pad.db, pad.cursor)
    await syncOnce(remote, pc.db, pc.cursor)
    expect((await pc.db.reviews.get(record.id))?.card).toMatchObject({ reps: 2, wrong: 1, last_grade: Grade.Again })
    expect(await pc.db.reviews.where('dirty').equals(1).count()).toBe(0)
  })
})

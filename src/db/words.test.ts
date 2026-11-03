import { describe, expect, it, vi } from 'vitest'
import { db, VocabDB } from './db'
import { addWord, deleteWord, findWord, listWords, updateWord } from './words'

const cat = { word: 'cat', translation: 'кошка', alternatives: ['кот'] }
const dog = { word: 'dog', translation: 'собака', alternatives: ['пёс'] }

describe('addWord', () => {
  it('сохраняет слово со всеми полями', async () => {
    const { record, created } = await addWord(cat)
    expect(created).toBe(true)
    expect(record).toMatchObject({ word: 'cat', translation: 'кошка', alternatives: ['кот'], note: '', deleted: 0, dirty: 1 })
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.created_at).toBe(record.updated_at)
    expect(await db.words.get(record.id)).toEqual(record)
  })

  it('повторное слово (в любом регистре) не создаёт дубликат', async () => {
    const first = await addWord(cat)
    const second = await addWord({ ...cat, word: '  CAT ', translation: 'другое' })
    expect(second.created).toBe(false)
    expect(second.record.id).toBe(first.record.id)
    expect(second.record.translation).toBe('кошка')
    expect(await db.words.count()).toBe(1)
  })

  it('удалённое слово при повторном добавлении восстанавливается, а не дублируется', async () => {
    const { record } = await addWord(cat)
    await deleteWord(record.id)
    const again = await addWord({ ...cat, translation: 'котик' })
    expect(again.created).toBe(true)
    expect(again.record.id).toBe(record.id)
    expect(again.record).toMatchObject({ deleted: 0, translation: 'котик' })
    expect(await db.words.count()).toBe(1)
  })
})

describe('findWord', () => {
  it('находит сохранённое слово и не находит удалённое', async () => {
    const { record } = await addWord(cat)
    expect((await findWord(' Cat '))?.id).toBe(record.id)
    await deleteWord(record.id)
    expect(await findWord('cat')).toBeUndefined()
  })
})

describe('listWords', () => {
  it('новые слова сверху', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
      await addWord(cat)
      vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
      await addWord(dog)
    } finally {
      vi.useRealTimers()
    }
    expect((await listWords()).map((w) => w.word)).toEqual(['dog', 'cat'])
  })

  it('ищет по слову, переводу и вариантам без учёта регистра', async () => {
    await addWord(cat)
    await addWord(dog)
    expect((await listWords('DO')).map((w) => w.word)).toEqual(['dog'])
    expect((await listWords('кош')).map((w) => w.word)).toEqual(['cat'])
    expect((await listWords('пёс')).map((w) => w.word)).toEqual(['dog'])
    expect(await listWords('zzz')).toEqual([])
  })

  it('не показывает удалённые', async () => {
    const { record } = await addWord(cat)
    await addWord(dog)
    await deleteWord(record.id)
    expect((await listWords()).map((w) => w.word)).toEqual(['dog'])
  })
})

describe('updateWord', () => {
  it('меняет перевод и заметку, обновляет updated_at и dirty', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let id: string
    try {
      vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
      id = (await addWord(cat)).record.id
      await db.words.update(id, { dirty: 0 })
      vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
      await updateWord(id, { translation: '  кошечка ', note: 'домашнее животное' })
    } finally {
      vi.useRealTimers()
    }
    expect(await db.words.get(id)).toMatchObject({
      translation: 'кошечка',
      note: 'домашнее животное',
      updated_at: '2026-11-02T10:00:00.000Z',
      created_at: '2026-11-01T10:00:00.000Z',
      dirty: 1,
    })
  })
})

describe('deleteWord', () => {
  it('удаление мягкое: запись остаётся с deleted=1 для синхронизации', async () => {
    const { record } = await addWord(cat)
    await deleteWord(record.id)
    expect(await db.words.get(record.id)).toMatchObject({ deleted: 1, dirty: 1 })
  })
})

describe('сохранность данных', () => {
  it('данные остаются после закрытия и повторного открытия базы (как после F5)', async () => {
    const name = 'vocab-reopen-test'
    const first = new VocabDB(name)
    await addWord(cat, first)
    first.close()
    const second = new VocabDB(name)
    expect((await listWords('', second)).map((w) => w.word)).toEqual(['cat'])
    await second.delete()
  })
})

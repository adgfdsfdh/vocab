import { describe, expect, it } from 'vitest'
import { db, VocabDB, type ReviewCard } from '../../db/db'
import { addWord, deleteWord, listWords } from '../../db/words'
import { wordId } from '../../db/wordId'
import { backupFileName, BackupError, buildBackup, exportBackup, importBackup, parseBackup } from './backup'

const card: ReviewCard = { reps: 2, lapses: 0, last_review: '2026-11-01T10:00:00.000Z', correct: 2, wrong: 0, last_grade: 3, due: '2026-11-05T10:00:00.000Z', state: 2 }

async function seed() {
  const cat = (await addWord({ word: 'cat', translation: 'кошка', alternatives: ['кот'] })).record
  const dog = (await addWord({ word: 'dog', translation: 'собака', alternatives: [] })).record
  await db.reviews.put({ word_id: cat.id, card, updated_at: '2026-11-01T10:00:00.000Z', deleted: 0, dirty: 0 })
  return { cat, dog }
}

function errorOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(BackupError)
    return (e as Error).message
  }
  throw new Error('ожидалась ошибка')
}

describe('экспорт', () => {
  it('формат: версия, все слова и карточки, без служебных полей и удалённых слов', async () => {
    await seed()
    const bird = (await addWord({ word: 'bird', translation: 'птица', alternatives: [] })).record
    await deleteWord(bird.id)
    const b = await exportBackup(db, new Date('2026-11-03T12:00:00Z'))
    expect(b.format).toBe('vocab-backup')
    expect(b.version).toBe(1)
    expect(b.exported_at).toBe('2026-11-03T12:00:00.000Z')
    expect(b.words.map((w) => w.word).sort()).toEqual(['cat', 'dog'])
    expect(b.words[0]).not.toHaveProperty('dirty')
    expect(b.words[0]).not.toHaveProperty('deleted')
    expect(b.reviews).toEqual([{ word_id: wordId('cat'), card, updated_at: '2026-11-01T10:00:00.000Z' }])
  })

  it('имя файла vocab-ГГГГ-ММ-ДД.json', () => {
    expect(backupFileName(new Date(2026, 0, 7))).toBe('vocab-2026-01-07.json')
  })
})

describe('импорт', () => {
  it('экспорт → импорт в чистую базу восстанавливает всё без потерь', async () => {
    await seed()
    const text = JSON.stringify(await exportBackup())
    const clean = new VocabDB('restore-test')
    const r = await importBackup(parseBackup(text), clean)
    expect(r).toEqual({ added: 2, updated: 0, unchanged: 0, reviews: 1 })
    expect(buildBackup(await clean.words.toArray(), await clean.reviews.toArray()).words).toEqual(
      JSON.parse(text).words,
    )
    expect((await clean.reviews.get(wordId('cat')))?.card).toEqual(card)
    // Восстановленное уйдёт в облако при синхронизации.
    expect((await clean.words.toArray()).every((w) => w.dirty === 1)).toBe(true)
    await clean.delete()
  })

  it('повторный импорт того же файла не создаёт дублей', async () => {
    await seed()
    const backup = parseBackup(JSON.stringify(await exportBackup()))
    expect(await importBackup(backup)).toEqual({ added: 0, updated: 0, unchanged: 2, reviews: 0 })
    expect(await importBackup(backup)).toEqual({ added: 0, updated: 0, unchanged: 2, reviews: 0 })
    expect(await db.words.count()).toBe(2)
  })

  it('слияние по updated_at: более новое из файла заменяет, более старое — нет', async () => {
    const { cat, dog } = await seed()
    const raw = await exportBackup()
    raw.words.find((w) => w.word === 'cat')!.translation = 'котик'
    raw.words.find((w) => w.word === 'cat')!.updated_at = '2099-01-01T00:00:00.000Z'
    raw.words.find((w) => w.word === 'dog')!.translation = 'пёс' // та же дата — не новее
    raw.words.push({ ...raw.words[0], id: 'x', word: 'Fox ', translation: 'лиса' })
    const r = await importBackup(parseBackup(JSON.stringify(raw)))
    expect(r).toEqual({ added: 1, updated: 1, unchanged: 1, reviews: 0 })
    expect((await db.words.get(cat.id))?.translation).toBe('котик')
    expect((await db.words.get(dog.id))?.translation).toBe('собака')
    expect((await listWords()).map((w) => w.word).sort()).toEqual(['cat', 'dog', 'fox'])
  })

  it('восстанавливает слово, удалённое раньше, чем сделана копия', async () => {
    const backup = parseBackup(
      JSON.stringify({
        format: 'vocab-backup',
        version: 1,
        exported_at: '2099-01-01T00:00:00.000Z',
        words: [{ id: wordId('cat'), word: 'cat', translation: 'кошка', alternatives: [], note: '', created_at: '2099-01-01T00:00:00.000Z', updated_at: '2099-01-01T00:00:00.000Z' }],
        reviews: [],
      }),
    )
    const { record } = await addWord({ word: 'cat', translation: 'кошка', alternatives: [] })
    await deleteWord(record.id)
    expect((await importBackup(backup)).updated).toBe(1)
    expect((await listWords()).map((w) => w.word)).toEqual(['cat'])
  })
})

describe('проверка файла', () => {
  it('битый JSON', () => {
    expect(errorOf(() => parseBackup('{"format": "vocab-ba'))).toBe('Файл повреждён: это не JSON')
  })

  it('чужой файл', () => {
    expect(errorOf(() => parseBackup('{"hello": 1}'))).toBe('Это не файл резервной копии словаря')
    expect(errorOf(() => parseBackup('[]'))).toBe('Это не файл резервной копии словаря')
  })

  it('файл более новой версии', () => {
    expect(errorOf(() => parseBackup('{"format":"vocab-backup","version":2,"words":[],"reviews":[]}'))).toMatch(
      /Обновите приложение/,
    )
  })

  it('повреждённое слово — ничего не импортируется', async () => {
    const text = JSON.stringify({
      format: 'vocab-backup',
      version: 1,
      words: [
        { word: 'cat', translation: 'кошка', updated_at: '2026-11-01T10:00:00.000Z' },
        { word: 'dog', updated_at: 'не дата' },
      ],
      reviews: [],
    })
    expect(errorOf(() => parseBackup(text))).toBe('Файл повреждён: слово №2')
    expect(await db.words.count()).toBe(0)
  })
})

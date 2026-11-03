import { describe, expect, it, vi } from 'vitest'
import { createLocalStorageCache, normalizeWord, translate, TranslateError, type Translation } from './translate'

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

// Реальный ответ MyMemory для «resilient» (сокращён).
const RESILIENT = {
  responseData: { translatedText: 'прочный ', match: 1 },
  responseStatus: 200,
  quotaFinished: false,
  matches: [
    { segment: 'resilient ', translation: 'прочный ' },
    { segment: 'Resilient', translation: 'Выносливость' },
    { segment: 'Resilient', translation: 'Устойчивый' },
    { segment: 'Resilient', translation: 'устойчивый' },
    { segment: 'Resilient', translation: 'resilient' },
  ],
}

function memoryCache() {
  const map = new Map<string, Translation>()
  return { get: (w: string) => map.get(w), set: (w: string, v: Translation) => void map.set(w, v), map }
}

async function errorCode(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(TranslateError)
    return { code: (e as TranslateError).code, message: (e as TranslateError).message }
  }
  throw new Error('ожидалась ошибка')
}

describe('normalizeWord', () => {
  it('обрезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeWord('  ResiLIENT  ')).toBe('resilient')
    expect(normalizeWord(' Take   Off ')).toBe('take off')
  })
})

describe('translate', () => {
  it('возвращает перевод и варианты без дублей и без английских строк', async () => {
    const fetch = vi.fn(async (_url: string) => fakeResponse(RESILIENT))
    const r = await translate('  Resilient ', { fetch: fetch as unknown as typeof globalThis.fetch })
    expect(r).toEqual({ word: 'resilient', translation: 'прочный', alternatives: ['Выносливость', 'Устойчивый'] })
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0][0])).toBe(
      'https://api.mymemory.translated.net/get?q=resilient&langpair=en|ru',
    )
  })

  it('пропускает варианты для другого исходного фрагмента (реальный ответ для «journey»)', async () => {
    const fetch = vi.fn(async () =>
      fakeResponse({
        responseData: { translatedText: 'поездка' },
        responseStatus: 200,
        matches: [
          { segment: 'journey', translation: 'поездка' },
          { segment: 'journey. ', translation: 'пациента. ' },
          { segment: 'Journey', translation: 'Полет' },
        ],
      }),
    )
    expect((await translate('journey', { fetch })).alternatives).toEqual(['Полет'])
  })

  it('сомнительный основной перевод из «Public Web» заменяется надёжным (реальный ответ для «garden»)', async () => {
    const fetch = vi.fn(async () =>
      fakeResponse({
        responseData: { translatedText: 'посмотреть прочитать и сопоставить', match: 1 },
        responseStatus: 200,
        matches: [
          { segment: 'garden', translation: 'посмотреть прочитать и сопоставить', 'created-by': 'Public Web' },
          { segment: 'garden', translation: 'сад', 'created-by': 'MateCat' },
          { segment: 'garden.', translation: '4.', 'created-by': 'Public_Corpora' },
        ],
      }),
    )
    expect(await translate('garden', { fetch })).toEqual({ word: 'garden', translation: 'сад', alternatives: [] })
  })

  it('сомнительный перевод остаётся, если надёжного нет', async () => {
    const fetch = vi.fn(async () =>
      fakeResponse({
        responseData: { translatedText: 'очень длинный странный перевод' },
        responseStatus: 200,
        matches: [{ segment: 'word', translation: 'очень длинный странный перевод', 'created-by': 'Public Web' }],
      }),
    )
    expect((await translate('word', { fetch })).translation).toBe('очень длинный странный перевод')
  })

  it('ограничивает варианты пятью', async () => {
    const matches = ['а', 'б', 'в', 'г', 'д', 'е', 'ж'].map((t) => ({ translation: `слово${t}` }))
    const fetch = vi.fn(async () =>
      fakeResponse({ responseData: { translatedText: 'главное' }, responseStatus: 200, matches }),
    )
    const r = await translate('word', { fetch })
    expect(r.alternatives).toHaveLength(5)
  })

  it('не отправляет пустой ввод', async () => {
    const fetch = vi.fn()
    expect((await errorCode(translate('   ', { fetch }))).code).toBe('empty')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('«qwzxqq» → «Перевод не найден» (MyMemory вернул исходное слово)', async () => {
    const fetch = vi.fn(async () =>
      fakeResponse({
        responseData: { translatedText: 'qwzxqq', match: 0.85 },
        responseStatus: 200,
        matches: [{ translation: 'qwzxqq' }],
      }),
    )
    expect(await errorCode(translate('qwzxqq', { fetch }))).toEqual({ code: 'not_found', message: 'Перевод не найден' })
  })

  it('ошибка сети → понятное сообщение', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const e = await errorCode(translate('cat', { fetch }))
    expect(e.code).toBe('network')
    expect(e.message).toMatch(/Нет связи/)
  })

  it('исчерпан бесплатный лимит (флаг quotaFinished) → сообщение про лимит', async () => {
    const fetch = vi.fn(async () =>
      fakeResponse({
        responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' },
        responseStatus: 429,
        quotaFinished: true,
      }),
    )
    const e = await errorCode(translate('cat', { fetch }))
    expect(e.code).toBe('limit')
    expect(e.message).toMatch(/лимит/)
  })

  it('HTTP 429 → сообщение про лимит', async () => {
    const fetch = vi.fn(async () => fakeResponse({}, 429))
    expect((await errorCode(translate('cat', { fetch }))).code).toBe('limit')
  })

  it('ошибка сервиса (HTTP 500 или битый JSON) → понятное сообщение', async () => {
    expect((await errorCode(translate('cat', { fetch: vi.fn(async () => fakeResponse({}, 500)) }))).code).toBe('api')
    const broken = { ok: true, status: 200, json: async () => JSON.parse('<html>') } as Response
    expect((await errorCode(translate('cat', { fetch: vi.fn(async () => broken) }))).code).toBe('api')
  })

  it('повторный запрос того же слова берётся из кэша без сети', async () => {
    const cache = memoryCache()
    const fetch = vi.fn(async () => fakeResponse(RESILIENT))
    const first = await translate('resilient', { fetch, cache })
    const failing = vi.fn(async () => {
      throw new TypeError('offline')
    })
    const second = await translate(' RESILIENT ', { fetch: failing, cache })
    expect(second).toEqual(first)
    expect(failing).not.toHaveBeenCalled()
  })

  it('ошибки не кэшируются', async () => {
    const cache = memoryCache()
    await errorCode(translate('cat', { fetch: vi.fn(async () => fakeResponse({}, 500)), cache }))
    expect(cache.map.size).toBe(0)
  })
})

describe('createLocalStorageCache', () => {
  it('сохраняет и читает перевод', () => {
    const cache = createLocalStorageCache('test:')
    const value = { word: 'cat', translation: 'кошка', alternatives: [] }
    cache.set('cat', value)
    expect(cache.get('cat')).toEqual(value)
    expect(cache.get('dog')).toBeUndefined()
  })
})

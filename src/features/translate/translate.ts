// Перевод EN → RU через бесплатный MyMemory API (без ключа, ~5000 символов в день).
// https://mymemory.translated.net/doc/spec.php

export interface Translation {
  word: string
  translation: string
  alternatives: string[]
}

export type TranslateErrorCode = 'empty' | 'not_found' | 'network' | 'limit' | 'api'

const MESSAGES: Record<TranslateErrorCode, string> = {
  empty: 'Введите английское слово',
  not_found: 'Перевод не найден',
  network: 'Нет связи с сервисом перевода. Проверьте интернет и попробуйте ещё раз',
  limit: 'Бесплатный лимит переводов на сегодня исчерпан. Попробуйте завтра',
  api: 'Сервис перевода ответил ошибкой. Попробуйте позже',
}

export class TranslateError extends Error {
  readonly code: TranslateErrorCode
  constructor(code: TranslateErrorCode) {
    super(MESSAGES[code])
    this.name = 'TranslateError'
    this.code = code
  }
}

export interface TranslationCache {
  get(word: string): Translation | undefined
  set(word: string, value: Translation): void
}

export interface TranslateOptions {
  fetch?: typeof fetch
  cache?: TranslationCache
  timeoutMs?: number
}

const API_URL = 'https://api.mymemory.translated.net/get'
const MAX_ALTERNATIVES = 5
const CYRILLIC = /[а-яё]/i

export function normalizeWord(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase()
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string }
  responseStatus?: number | string
  quotaFinished?: boolean
  matches?: { segment?: string; translation?: string; 'created-by'?: string }[]
}

const clean = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')
const wordCount = (s: string) => s.split(' ').filter(Boolean).length

// «Public Web» / «Public_Corpora» — случайные тексты из интернета; для «garden» оттуда пришло
// «посмотреть прочитать и сопоставить». Подозрителен и перевод намного длиннее исходного слова.
function isSuspicious(translation: string, createdBy: string | undefined, source: string): boolean {
  return /^public/i.test(createdBy ?? '') || wordCount(translation) > wordCount(source) + 2
}

export async function translate(input: string, options: TranslateOptions = {}): Promise<Translation> {
  const word = normalizeWord(input)
  if (!word) throw new TranslateError('empty')

  const cached = options.cache?.get(word)
  if (cached) return cached

  const doFetch = options.fetch ?? fetch
  const url = `${API_URL}?q=${encodeURIComponent(word)}&langpair=en|ru`

  let res: Response
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) })
  } catch {
    throw new TranslateError('network')
  }
  if (res.status === 429) throw new TranslateError('limit')
  if (!res.ok) throw new TranslateError('api')

  let data: MyMemoryResponse
  try {
    data = (await res.json()) as MyMemoryResponse
  } catch {
    throw new TranslateError('api')
  }

  let main = clean(data.responseData?.translatedText)
  if (data.quotaFinished || Number(data.responseStatus) === 429 || main.startsWith('MYMEMORY WARNING')) {
    throw new TranslateError('limit')
  }
  if (Number(data.responseStatus) !== 200) throw new TranslateError('api')
  // MyMemory возвращает исходное слово, если перевода нет: нет русских букв — значит, не найдено.
  if (!CYRILLIC.test(main)) throw new TranslateError('not_found')

  // Варианты для того же слова (для другого фрагмента — «journey.», кусок предложения — часто мусор).
  const candidates = (data.matches ?? [])
    .filter((m) => m.segment === undefined || normalizeWord(m.segment) === word)
    .map((m) => ({ t: clean(m.translation), by: m['created-by'] }))
    .filter((c) => CYRILLIC.test(c.t))

  // Основной перевод сомнительный, а есть надёжный вариант — берём надёжный.
  const mainMatch = candidates.find((c) => c.t.toLowerCase() === main.toLowerCase())
  if (isSuspicious(main, mainMatch?.by, word)) {
    const better = candidates.find((c) => !isSuspicious(c.t, c.by, word))
    if (better) main = better.t
  }

  const seen = new Set([main.toLowerCase()])
  const alternatives: string[] = []
  for (const c of candidates) {
    if (seen.has(c.t.toLowerCase()) || isSuspicious(c.t, c.by, word)) continue
    seen.add(c.t.toLowerCase())
    alternatives.push(c.t)
    if (alternatives.length === MAX_ALTERNATIVES) break
  }

  const result: Translation = { word, translation: main, alternatives }
  options.cache?.set(word, result)
  return result
}

// Кэш в localStorage: повторный запрос того же слова не идёт в сеть.
// Если хранилище недоступно (приватный режим и т.п.) — просто работаем без кэша.
export function createLocalStorageCache(prefix = 'vocab:translation:'): TranslationCache {
  return {
    get(word) {
      try {
        const raw = localStorage.getItem(prefix + word)
        return raw ? (JSON.parse(raw) as Translation) : undefined
      } catch {
        return undefined
      }
    },
    set(word, value) {
      try {
        localStorage.setItem(prefix + word, JSON.stringify(value))
      } catch {
        // нет места или хранилище запрещено — не критично
      }
    },
  }
}

import { useRef, useState, type FormEvent } from 'react'
import { createLocalStorageCache, translate, TranslateError, type Translation } from './translate'

const defaultCache = createLocalStorageCache()
const defaultTranslate = (word: string) => translate(word, { cache: defaultCache })

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: Translation; status?: string }
  | { kind: 'error'; message: string }

interface Props {
  translateWord?: (word: string) => Promise<Translation>
  // Вызывается после успешного перевода (например, чтобы сохранить слово); возвращает строку статуса.
  onTranslated?: (result: Translation) => Promise<string | void>
}

export default function TranslateForm({ translateWord = defaultTranslate, onTranslated }: Props) {
  const [text, setText] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const requestId = useRef(0)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    const id = ++requestId.current
    setState({ kind: 'loading' })
    try {
      const result = await translateWord(text)
      if (id !== requestId.current) return
      setState({ kind: 'done', result })
      if (onTranslated) {
        let status: string
        try {
          status = (await onTranslated(result)) ?? ''
        } catch {
          status = 'Не удалось сохранить слово'
        }
        if (id === requestId.current) setState({ kind: 'done', result, status })
      }
    } catch (err) {
      if (id !== requestId.current) return
      const message = err instanceof TranslateError ? err.message : 'Что-то пошло не так. Попробуйте ещё раз'
      setState({ kind: 'error', message })
    }
  }

  return (
    <section className="translate">
      <form onSubmit={onSubmit}>
        <input
          className="translate-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Английское слово"
          aria-label="Английское слово"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          lang="en"
          enterKeyHint="search"
        />
      </form>
      <div className="translate-output" aria-live="polite">
        {state.kind === 'loading' && <p className="muted">Перевожу…</p>}
        {state.kind === 'error' && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === 'done' && (
          <div className="translate-result">
            <p className="translation">{state.result.translation}</p>
            {state.result.alternatives.length > 0 && (
              <p className="muted">{state.result.alternatives.join(', ')}</p>
            )}
            {state.status && <p className="status">{state.status}</p>}
          </div>
        )}
      </div>
    </section>
  )
}

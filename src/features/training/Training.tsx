import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { WordRecord } from '../../db/db'
import { listWords } from '../../db/words'
import {
  buildChoices,
  canPlayChoice,
  checkSpelling,
  Grade,
  GRADE_LABELS,
  gradeForAnswer,
  isChoiceCorrect,
  isRemembered,
  pickSession,
  recordAnswer,
  spellingHint,
  type Mode,
} from './logic'

const MODE_LABELS: Record<Mode, string> = {
  cards: 'Карточки',
  choice: '4 варианта',
  spelling: 'Написание',
}

// Нажатия клавиш на странице (кроме полей ввода) — для управления с клавиатуры.
function useKeys(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      ref.current(e)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

interface StepProps {
  word: WordRecord
  words: WordRecord[]
  onAnswer: (grade: Grade) => void
}

export default function Training() {
  const words = useLiveQuery(() => listWords(), [])
  const [mode, setMode] = useState<Mode | null>(null)
  const [session, setSession] = useState<WordRecord[]>([])
  const [index, setIndex] = useState(0)
  const [grades, setGrades] = useState<Grade[]>([])
  const busy = useRef(false)

  if (words === undefined) return <p className="muted">Загрузка…</p>

  function start(m: Mode) {
    setMode(m)
    setSession(pickSession(words!))
    setIndex(0)
    setGrades([])
  }

  async function answer(grade: Grade) {
    if (busy.current) return
    busy.current = true
    try {
      await recordAnswer(session[index].id, grade)
      setGrades((g) => [...g, grade])
      setIndex((i) => i + 1)
    } finally {
      busy.current = false
    }
  }

  if (!mode) {
    const choiceOk = canPlayChoice(words)
    return (
      <section className="training">
        {words.length === 0 ? (
          <p className="muted">Сначала добавьте слова на вкладке «Перевод».</p>
        ) : (
          <>
            <p className="muted">Выберите режим. Слов в словаре: {words.length}</p>
            <div className="mode-list">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <button key={m} type="button" onClick={() => start(m)} disabled={m === 'choice' && !choiceOk}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {!choiceOk && (
              <p className="muted">«4 варианта» откроется, когда в словаре будет минимум 4 слова с разными переводами.</p>
            )}
          </>
        )}
      </section>
    )
  }

  if (index >= session.length) {
    const right = grades.filter(isRemembered).length
    return (
      <section className="training">
        <h2>Готово!</h2>
        <p>
          Слов: {grades.length}, верно: {right}
        </p>
        <div className="actions">
          <button type="button" onClick={() => start(mode)}>
            Ещё раз
          </button>
          <button type="button" className="secondary" onClick={() => setMode(null)}>
            Другой режим
          </button>
        </div>
      </section>
    )
  }

  const word = session[index]
  const Step = mode === 'cards' ? CardStep : mode === 'choice' ? ChoiceStep : SpellingStep
  return (
    <section className="training">
      <div className="training-top">
        <span className="muted">
          {MODE_LABELS[mode]} · {index + 1} из {session.length}
        </span>
        <button type="button" className="secondary" onClick={() => setMode(null)}>
          Закончить
        </button>
      </div>
      <Step key={word.id} word={word} words={words} onAnswer={(g) => void answer(g)} />
    </section>
  )
}

function CardStep({ word, onAnswer }: StepProps) {
  const [revealed, setRevealed] = useState(false)
  useKeys((e) => {
    if (!revealed && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      setRevealed(true)
    } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
      onAnswer(Number(e.key) as Grade)
    }
  })

  return (
    <div className="card-step">
      <button type="button" className="flashcard" onClick={() => setRevealed(true)} aria-label="Карточка">
        <span className="flash-word">{word.word}</span>
        {revealed ? (
          <span className="flash-translation">{word.translation}</span>
        ) : (
          <span className="muted">Нажмите, чтобы показать перевод (Enter)</span>
        )}
      </button>
      {revealed && (
        <div className="grade-buttons">
          {([Grade.Again, Grade.Hard, Grade.Good, Grade.Easy] as Grade[]).map((g) => (
            <button key={g} type="button" className={`grade-${g}`} onClick={() => onAnswer(g)}>
              {g}. {GRADE_LABELS[g]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChoiceStep({ word, words, onAnswer }: StepProps) {
  const choices = useMemo(() => buildChoices(word, words), [word, words])
  const [picked, setPicked] = useState<string | null>(null)
  const correct = picked !== null && isChoiceCorrect(word, picked)

  const next = () => picked !== null && onAnswer(gradeForAnswer(correct))
  useKeys((e) => {
    const n = Number(e.key)
    if (picked === null && n >= 1 && n <= choices.length) setPicked(choices[n - 1])
    else if (picked !== null && e.key === 'Enter') next()
  })

  return (
    <div className="choice-step">
      <p className="flash-word">{word.word}</p>
      <div className="choices">
        {choices.map((c, i) => {
          const state = picked === null ? '' : isChoiceCorrect(word, c) ? 'right' : c === picked ? 'wrong' : ''
          return (
            <button
              key={c}
              type="button"
              className={`choice secondary ${state}`}
              disabled={picked !== null}
              onClick={() => setPicked(c)}
            >
              {i + 1}. {c}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className="feedback">
          <p className={correct ? 'right-text' : 'error'}>{correct ? 'Верно!' : `Неверно. Правильно: ${word.translation}`}</p>
          <button type="button" onClick={next} autoFocus>
            Далее (Enter)
          </button>
        </div>
      )}
    </div>
  )
}

function SpellingStep({ word, onAnswer }: StepProps) {
  const [text, setText] = useState('')
  const [hint, setHint] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (result !== null) {
      onAnswer(gradeForAnswer(result, hint))
      return
    }
    if (!text.trim()) return
    setResult(checkSpelling(word, text))
  }

  return (
    <form className="spelling-step" onSubmit={submit}>
      <p className="flash-translation">{word.translation}</p>
      <input
        className="text-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={hint ? `${spellingHint(word)}…` : 'Напишите по-английски'}
        aria-label="Слово по-английски"
        autoFocus
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        lang="en"
        readOnly={result !== null}
      />
      {result === null ? (
        <div className="actions">
          <button type="submit">Проверить (Enter)</button>
          <button type="button" className="secondary" onClick={() => setHint(true)} disabled={hint}>
            {hint ? `Первая буква: ${spellingHint(word)}` : 'Подсказка'}
          </button>
        </div>
      ) : (
        <div className="feedback">
          <p className={result ? 'right-text' : 'error'}>{result ? 'Верно!' : `Неверно. Правильно: ${word.word}`}</p>
          <button type="submit">Далее (Enter)</button>
        </div>
      )}
    </form>
  )
}

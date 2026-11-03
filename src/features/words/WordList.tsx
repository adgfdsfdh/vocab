import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { WordRecord } from '../../db/db'
import { deleteWord, listWords, updateWord } from '../../db/words'

export default function WordList() {
  const [query, setQuery] = useState('')
  const words = useLiveQuery(() => listWords(query), [query])

  return (
    <section className="words">
      <input
        className="text-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по словам и переводам"
        aria-label="Поиск"
      />
      {words === undefined ? (
        <p className="muted">Загрузка…</p>
      ) : words.length === 0 ? (
        <p className="muted">{query.trim() ? 'Ничего не найдено' : 'Пока нет сохранённых слов'}</p>
      ) : (
        <>
          <p className="muted">Слов: {words.length}</p>
          <ul className="word-list">
            {words.map((w) => (
              <WordItem key={w.id} word={w} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function WordItem({ word }: { word: WordRecord }) {
  const [editing, setEditing] = useState(false)
  const [translation, setTranslation] = useState(word.translation)
  const [note, setNote] = useState(word.note)

  async function save() {
    if (!translation.trim()) return
    await updateWord(word.id, { translation, note })
    setEditing(false)
  }

  function cancel() {
    setTranslation(word.translation)
    setNote(word.note)
    setEditing(false)
  }

  async function remove() {
    if (window.confirm(`Удалить «${word.word}»?`)) await deleteWord(word.id)
  }

  if (editing) {
    return (
      <li className="word-item editing">
        <strong>{word.word}</strong>
        <input
          className="text-input"
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
          aria-label={`Перевод слова ${word.word}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') cancel()
          }}
        />
        <input
          className="text-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Заметка (необязательно)"
          aria-label={`Заметка к слову ${word.word}`}
        />
        <div className="actions">
          <button type="button" onClick={() => void save()} disabled={!translation.trim()}>
            Сохранить
          </button>
          <button type="button" className="secondary" onClick={cancel}>
            Отмена
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="word-item">
      <div className="word-text">
        <strong>{word.word}</strong> — {word.translation}
        {word.note && <div className="muted">{word.note}</div>}
      </div>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => setEditing(true)} aria-label={`Изменить ${word.word}`}>
          Изменить
        </button>
        <button type="button" className="secondary danger" onClick={() => void remove()} aria-label={`Удалить ${word.word}`}>
          Удалить
        </button>
      </div>
    </li>
  )
}

import { useState } from 'react'
import type { WordRecord } from './db/db'
import { addWord, findWord } from './db/words'
import TranslateForm from './features/translate/TranslateForm'
import { createLocalStorageCache, translate, type Translation } from './features/translate/translate'
import WordList from './features/words/WordList'

const cache = createLocalStorageCache()

const toTranslation = (w: WordRecord): Translation => ({
  word: w.word,
  translation: w.translation,
  alternatives: w.alternatives,
})

// Сначала ищем слово в своём словаре (там может быть исправленный вручную перевод), потом — в сети.
async function lookup(word: string): Promise<Translation> {
  const saved = await findWord(word)
  return saved ? toTranslation(saved) : translate(word, { cache })
}

async function save(t: Translation): Promise<string> {
  const { created } = await addWord(t)
  return created ? 'Сохранено в словарь' : 'Уже в словаре'
}

type Screen = 'translate' | 'words'

export default function App() {
  const [screen, setScreen] = useState<Screen>('translate')

  return (
    <main className="app">
      <header className="app-header">
        <h1>Словарь</h1>
        <nav className="tabs">
          <button type="button" aria-pressed={screen === 'translate'} onClick={() => setScreen('translate')}>
            Перевод
          </button>
          <button type="button" aria-pressed={screen === 'words'} onClick={() => setScreen('words')}>
            Мои слова
          </button>
        </nav>
      </header>
      {screen === 'translate' ? <TranslateForm translateWord={lookup} onTranslated={save} /> : <WordList />}
    </main>
  )
}

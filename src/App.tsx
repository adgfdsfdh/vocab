import { useState, useSyncExternalStore } from 'react'
import type { WordRecord } from './db/db'
import { addWord, findWord } from './db/words'
import AccountPanel, { STATUS_TEXT } from './features/account/AccountPanel'
import TodayCounts from './features/srs/TodayCounts'
import TranslateForm from './features/translate/TranslateForm'
import { createLocalStorageCache, translate, type Translation } from './features/translate/translate'
import Training from './features/training/Training'
import WordList from './features/words/WordList'
import { syncStore } from './sync/manager'

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

type Screen = 'translate' | 'words' | 'training' | 'account'

const TABS: [Screen, string][] = [
  ['translate', 'Перевод'],
  ['words', 'Мои слова'],
  ['training', 'Тренировка'],
  ['account', 'Аккаунт'],
]

export default function App() {
  const [screen, setScreen] = useState<Screen>('translate')
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot)

  return (
    <main className="app">
      <header className="app-header">
        <h1>Словарь</h1>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={screen === id} onClick={() => setScreen(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <p className={`sync-status ${sync.status}`} aria-live="polite">
        {STATUS_TEXT[sync.status]}
      </p>
      {screen === 'translate' && (
        <>
          <TodayCounts />
          <TranslateForm translateWord={lookup} onTranslated={save} />
        </>
      )}
      {screen === 'words' && <WordList />}
      {screen === 'training' && <Training />}
      {screen === 'account' && <AccountPanel />}
    </main>
  )
}

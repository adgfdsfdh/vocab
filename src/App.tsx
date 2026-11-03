import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WordRecord } from './db/db'
import { addWord, findWord } from './db/words'
import DesktopBar from './desktop/DesktopBar'
import { isDesktop, SHOWN_EVENT } from './desktop/desktop'
import AccountPanel, { STATUS_TEXT } from './features/account/AccountPanel'
import TodayCounts from './features/srs/TodayCounts'
import TranslateForm from './features/translate/TranslateForm'
import { createLocalStorageCache, translate, type Translation } from './features/translate/translate'
import Training from './features/training/Training'
import WordList from './features/words/WordList'
import { syncStore } from './sync/manager'
import { useCompact } from './useCompact'

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

// В мини-виде подписи короче, кнопки — внизу.
const COMPACT_LABELS: Record<Screen, string> = {
  translate: 'Перевод',
  words: 'Слова',
  training: 'Тренировка',
  account: 'Аккаунт',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('translate')
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot)
  const compact = useCompact()
  const desktop = isDesktop()

  // Окно Tauri показали горячей клавишей — сразу к вводу слова (тренировку не прерываем).
  useEffect(() => {
    const onShown = () => setScreen((s) => (s === 'training' ? s : 'translate'))
    window.addEventListener(SHOWN_EVENT, onShown)
    return () => window.removeEventListener(SHOWN_EVENT, onShown)
  }, [])

  const nav = (
    <nav className={compact ? 'tabs bottom-nav' : 'tabs'} aria-label="Разделы">
      {TABS.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={screen === id} onClick={() => setScreen(id)}>
          {compact ? COMPACT_LABELS[id] : label}
        </button>
      ))}
    </nav>
  )

  return (
    <main className={compact ? 'app compact' : 'app'}>
      {desktop && <DesktopBar />}
      {compact ? null : (
        <header className="app-header">
          <h1>Словарь</h1>
          {nav}
        </header>
      )}
      <p className={`sync-status ${sync.status}`} aria-live="polite">
        {STATUS_TEXT[sync.status]}
      </p>
      <div className="content">
        {screen === 'translate' && (
          <>
            <TodayCounts />
            <TranslateForm translateWord={lookup} onTranslated={save} />
          </>
        )}
        {screen === 'words' && <WordList />}
        {screen === 'training' && <Training />}
        {screen === 'account' && <AccountPanel />}
      </div>
      {compact && nav}
    </main>
  )
}

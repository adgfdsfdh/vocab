import { useRef, useState } from 'react'
import { backupFileName, BackupError, exportBackup, importBackup, parseBackup } from './backup'

// Кнопки «Экспорт» и «Импорт» во вкладке «Аккаунт». Работают и без входа, и без интернета.
export default function BackupPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function onExport() {
    setError('')
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName()
    a.click()
    URL.revokeObjectURL(url)
    setMessage(`Сохранено слов: ${backup.words.length}`)
  }

  async function onImport(file: File) {
    setMessage('')
    setError('')
    try {
      const r = await importBackup(parseBackup(await file.text()))
      setMessage(`Импорт готов. Новых слов: ${r.added}, обновлено: ${r.updated}, уже были: ${r.unchanged}`)
    } catch (e) {
      setError(e instanceof BackupError ? e.message : 'Не получилось прочитать файл')
    }
  }

  return (
    <section className="account backup">
      <h2>Резервная копия</h2>
      <div className="actions">
        <button type="button" onClick={() => void onExport()}>
          Экспорт
        </button>
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
          Импорт
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          aria-label="Файл резервной копии"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onImport(file)
          }}
        />
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted">Импорт не создаёт дублей: из файла берутся только новые слова и более свежие изменения.</p>
    </section>
  )
}

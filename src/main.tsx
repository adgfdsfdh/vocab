import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { startSync } from './sync/manager'

// Просим браузер не удалять локальную базу при нехватке места (бесплатно, может молча отказать).
void navigator.storage?.persist?.().catch(() => {})

startSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

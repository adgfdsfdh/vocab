import type { SupabaseClient } from '@supabase/supabase-js'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { signOut, syncNow, syncStore, type SyncState } from '../../sync/manager'
import { supabase } from '../../sync/supabase'

export const STATUS_TEXT: Record<SyncState['status'], string> = {
  disabled: 'Синхронизация не настроена',
  signed_out: 'Не выполнен вход',
  syncing: 'Синхронизация…',
  synced: 'Синхронизировано',
  offline: 'Нет сети — изменения сохранены на устройстве',
  error: 'Ошибка синхронизации',
}

export function authErrorText(e: unknown): string {
  const err = (e ?? {}) as { code?: string; status?: number; message?: string }
  if (err.code === 'over_email_send_rate_limit' || err.status === 429)
    return 'Слишком много писем подряд. Подождите немного и попробуйте снова'
  if (err.code === 'signup_disabled' || err.code === 'otp_disabled' || /signups? not allowed/i.test(err.message ?? ''))
    return 'Регистрация новых пользователей выключена. Войти можно только с уже зарегистрированного адреса'
  if (err.code === 'otp_expired' || /token has expired|invalid/i.test(err.message ?? ''))
    return 'Неверный или устаревший код. Запросите новое письмо'
  if (err.code === 'email_address_invalid' || err.code === 'validation_failed') return 'Проверьте адрес почты'
  if (e instanceof TypeError) return 'Нет связи с сервером. Проверьте интернет'
  return 'Не получилось. Попробуйте ещё раз'
}

const LINK_TYPES = ['magiclink', 'signup', 'email', 'invite'] as const
type LinkType = (typeof LINK_TYPES)[number]

// Без своего SMTP Supabase не даёт добавить код в письмо, поэтому принимаем и саму ссылку из письма
// (…/auth/v1/verify?token=…&type=magiclink): её токен подтверждается без перехода по ссылке —
// так можно войти и в окне, где ссылка не открывается (Tauri, другое устройство).
export function parseEmailCredential(
  input: string,
): { token_hash: string; type: LinkType } | { token: string } | null {
  const text = input.trim()
  if (/^\d{6,10}$/.test(text.replace(/\s/g, ''))) return { token: text.replace(/\s/g, '') }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  // Почтовые сервисы иногда оборачивают ссылку: …?url=<настоящая ссылка>
  for (const key of ['url', 'q', 'u']) {
    const inner = url.searchParams.get(key)
    if (inner?.startsWith('http')) return parseEmailCredential(inner)
  }
  const token = url.searchParams.get('token')
  if (!token) return null
  const type = url.searchParams.get('type') as LinkType | null
  return { token_hash: token, type: type && LINK_TYPES.includes(type) ? type : 'email' }
}

interface Props {
  client?: SupabaseClient | null
}

export default function AccountPanel({ client = supabase }: Props) {
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot)

  if (!client) {
    return (
      <section className="account">
        <p>{STATUS_TEXT.disabled}.</p>
        <p className="muted">
          Слова сохраняются только на этом устройстве. Чтобы включить общую базу, нужны ключи Supabase в файле
          .env.local (см. инструкцию в журнале проекта).
        </p>
      </section>
    )
  }

  if (sync.status === 'signed_out' || !sync.email) return <SignIn client={client} />

  return (
    <section className="account">
      <p>
        Вы вошли: <strong>{sync.email}</strong>
      </p>
      <p className={sync.status === 'error' ? 'error' : 'muted'}>
        {STATUS_TEXT[sync.status]}
        {sync.status === 'synced' && sync.lastSyncedAt && ` в ${new Date(sync.lastSyncedAt).toLocaleTimeString('ru-RU')}`}
      </p>
      {sync.status === 'error' && sync.error && <p className="muted">{sync.error}</p>}
      <div className="actions">
        <button type="button" onClick={() => void syncNow(client)} disabled={sync.status === 'syncing'}>
          Синхронизировать сейчас
        </button>
        <button type="button" className="secondary" onClick={() => void signOut(client)}>
          Выйти
        </button>
      </div>
      <p className="muted">После выхода слова остаются на этом устройстве.</p>
    </section>
  )
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendEmail(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setError('')
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      })
      if (error) throw error
      setSent(true)
    } catch (err) {
      setError(authErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    const credential = parseEmailCredential(code)
    if (!credential) {
      setError('Вставьте ссылку из письма целиком (правый клик по ссылке «Sign in» → «Копировать адрес ссылки»)')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error } = await client.auth.verifyOtp(
        'token_hash' in credential ? credential : { email: email.trim(), token: credential.token, type: 'email' },
      )
      if (error) throw error
    } catch (err) {
      setError(authErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account">
      <p>Войдите, чтобы слова были общими на ПК и планшете.</p>
      {!sent ? (
        <form onSubmit={sendEmail} className="stack">
          <input
            className="text-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ваш email"
            aria-label="Email"
            autoComplete="email"
            required
          />
          <button type="submit" disabled={busy}>
            Получить письмо для входа
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p className="muted">
            Письмо отправлено на {email.trim()}. Нажмите ссылку «Sign in» в письме. Если письмо открыто в другом
            браузере или устройстве — скопируйте ссылку (правый клик → «Копировать адрес ссылки») и вставьте сюда.
          </p>
          <input
            className="text-input"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Ссылка или код из письма"
            aria-label="Ссылка или код из письма"
          />
          <div className="actions">
            <button type="submit" disabled={busy}>
              Войти
            </button>
            <button type="button" className="secondary" onClick={() => setSent(false)}>
              Другой email
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

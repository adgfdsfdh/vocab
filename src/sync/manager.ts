import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { liveQuery } from 'dexie'
import { db } from '../db/db'
import { syncOnce } from './engine'
import { localCursor, supabase, supabaseRemote } from './supabase'

// Когда синхронизироваться: при входе, при появлении сети, при возврате в приложение,
// через пару секунд после локального изменения и раз в 2 минуты, пока приложение открыто.

export type SyncStatus = 'disabled' | 'signed_out' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  email?: string
  lastSyncedAt?: string
  error?: string
}

const AFTER_CHANGE_MS = 2000
const PERIODIC_MS = 2 * 60 * 1000

let state: SyncState = { status: supabase ? 'signed_out' : 'disabled' }
const listeners = new Set<() => void>()

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const syncStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => state,
}

let session: Session | null = null
let running = false
let again = false
let changeTimer: ReturnType<typeof setTimeout> | undefined

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export async function syncNow(client: SupabaseClient | null = supabase): Promise<void> {
  if (!client || !session) return
  if (running) {
    again = true
    return
  }
  if (!navigator.onLine) {
    setState({ status: 'offline' })
    return
  }
  running = true
  setState({ status: 'syncing', error: undefined })
  try {
    const userId = session.user.id
    await syncOnce(supabaseRemote(client, userId), db, (table) => localCursor(`vocab:sync:cursor:${table}:${userId}`))
    setState({ status: 'synced', lastSyncedAt: new Date().toISOString() })
  } catch (e) {
    setState(navigator.onLine ? { status: 'error', error: errorText(e) } : { status: 'offline' })
  } finally {
    running = false
    if (again) {
      again = false
      void syncNow(client)
    }
  }
}

function scheduleSoon() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => void syncNow(), AFTER_CHANGE_MS)
}

let started = false

export function startSync(client: SupabaseClient | null = supabase): void {
  if (!client || started) return
  started = true

  client.auth.onAuthStateChange((_event, s) => {
    const wasSignedIn = Boolean(session)
    session = s
    if (s) {
      setState({ email: s.user.email, status: state.status === 'signed_out' ? 'synced' : state.status })
      if (!wasSignedIn) void syncNow(client)
    } else {
      setState({ status: 'signed_out', email: undefined, lastSyncedAt: undefined })
    }
  })

  window.addEventListener('online', () => void syncNow(client))
  window.addEventListener('offline', () => setState({ status: session ? 'offline' : state.status }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow(client)
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow(client)
  }, PERIODIC_MS)

  // Любое локальное изменение (dirty = 1) — отправить через пару секунд.
  const dirtyCount = async () =>
    (await db.words.where('dirty').equals(1).count()) + (await db.reviews.where('dirty').equals(1).count())
  liveQuery(dirtyCount).subscribe((count) => {
    if (count > 0 && session) scheduleSoon()
  })
}

export async function signOut(client: SupabaseClient | null = supabase): Promise<void> {
  await client?.auth.signOut()
}

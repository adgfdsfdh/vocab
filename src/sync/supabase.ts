import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CursorStore, OutgoingWord, Remote, RemoteWord } from './engine'

// В браузер попадают только URL проекта и публичный anon (publishable) key — их защищает RLS.
// service_role key здесь не используется никогда.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        // implicit: ссылка из письма срабатывает в любом браузере, где её открыли.
        auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null

const WORD_COLUMNS = 'id,word,translation,alternatives,note,created_at,updated_at,deleted,server_updated_at'

export function supabaseRemote(client: SupabaseClient, userId: string): Remote {
  return {
    async pullWords(since, limit) {
      let q = client.from('words').select(WORD_COLUMNS).order('server_updated_at').limit(limit)
      if (since) q = q.gt('server_updated_at', since)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as RemoteWord[]
    },
    async pushWords(rows: OutgoingWord[]) {
      const { error } = await client
        .from('words')
        .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,id' })
      if (error) throw error
    },
  }
}

export function localCursor(key: string): CursorStore {
  return {
    get() {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // без курсора просто загрузим всё ещё раз — не страшно
      }
    },
  }
}

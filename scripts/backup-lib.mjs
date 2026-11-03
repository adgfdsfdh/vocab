// Части скрипта бэкапа без сети — их проверяют тесты (scripts/backup.test.ts).
import { readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const KEEP = 10
const FILE_RE = /^vocab-\d{4}-\d{2}-\d{2}\.json$/

// Тот же формат, что у кнопки «Экспорт» (src/features/backup/backup.ts), — файл можно импортировать в приложении.
export function buildBackup(words, reviews, now = new Date()) {
  const live = words.filter((w) => !w.deleted)
  const ids = new Set(live.map((w) => w.id))
  return {
    format: 'vocab-backup',
    version: 1,
    exported_at: now.toISOString(),
    words: live.map((w) => ({
      id: w.id,
      word: w.word,
      translation: w.translation,
      alternatives: Array.isArray(w.alternatives) ? w.alternatives : [],
      note: w.note ?? '',
      created_at: new Date(w.created_at).toISOString(),
      updated_at: new Date(w.updated_at).toISOString(),
    })),
    reviews: reviews
      .filter((r) => !r.deleted && ids.has(r.word_id))
      .map((r) => ({ word_id: r.word_id, card: r.card, updated_at: new Date(r.updated_at).toISOString() })),
  }
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `vocab-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

// Запись через временный файл: если что-то прервётся, старая копия за сегодня не испортится.
export async function writeBackup(dir, name, backup) {
  const tmp = join(dir, `${name}.tmp`)
  await writeFile(tmp, JSON.stringify(backup, null, 2), 'utf8')
  await rename(tmp, join(dir, name))
}

// Оставляет `keep` самых новых копий (по дате в имени), остальные удаляет. Чужие файлы не трогает.
export async function rotate(dir, keep = KEEP) {
  const files = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort().reverse()
  const old = files.slice(keep)
  for (const f of old) await rm(join(dir, f))
  return old
}

// В лог не должны попасть ключ, адрес проекта и путь к папке.
export function scrub(text, secrets) {
  let out = String(text)
  for (const s of secrets) if (s) out = out.split(s).join('***')
  return out
}

export function logLine(now, text) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return `${stamp} ${text}\n`
}

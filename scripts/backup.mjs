// Бэкап словаря: все слова и результаты тренировок из Supabase → JSON в папку на ПК, не чаще раза в сутки.
// Запуск: node scripts/backup.mjs [--force] (задачу в Планировщике ставит scripts/install-backup-task.ps1).
// Настройки — в .env.local: VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_DIR. Лог: backups/backup.log.
// Заодно ежедневный запрос не даёт бесплатному проекту Supabase уснуть.
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { backupFileName, buildBackup, hasBackup, KEEP, logLine, rotate, scrub, writeBackup } from './backup-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const logFile = join(root, 'backups', 'backup.log')
const PAGE = 1000

async function fetchAll(client, table, columns) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).order('server_updated_at').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

async function log(text) {
  await mkdir(dirname(logFile), { recursive: true })
  await appendFile(logFile, logLine(new Date(), text), 'utf8')
}

async function main() {
  try {
    process.loadEnvFile(join(root, '.env.local'))
  } catch {
    throw new Error('нет файла .env.local')
  }
  const { VITE_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, BACKUP_DIR: dir } = process.env
  const secrets = [key, url, dir]
  try {
    if (!url || !key || !dir) throw new Error('в .env.local не заданы VITE_SUPABASE_URL, SUPABASE_SECRET_KEY или BACKUP_DIR')
    const name = backupFileName()
    // Задача запускается при каждом входе в Windows, а копия нужна не чаще раза в сутки.
    if (!process.argv.includes('--force') && (await hasBackup(dir, name))) {
      await log(`пропуск: копия за сегодня уже есть (${name})`)
      return
    }
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const words = await fetchAll(client, 'words', 'id,word,translation,alternatives,note,created_at,updated_at,deleted')
    const reviews = await fetchAll(client, 'review_state', 'word_id,card,updated_at,deleted')
    const backup = buildBackup(words, reviews)

    await mkdir(dir, { recursive: true })
    await writeBackup(dir, name, backup)
    const removed = await rotate(dir, KEEP)
    const text = `OK слов: ${backup.words.length}, результатов тренировок: ${backup.reviews.length}, файл: ${name}, удалено старых копий: ${removed.length}`
    await log(text)
    console.log(text)
  } catch (e) {
    const text = `ОШИБКА: ${scrub(e instanceof Error ? e.message : e, secrets)}`
    await log(text)
    console.error(text)
    process.exitCode = 1
  }
}

await main().catch(async (e) => {
  await log(`ОШИБКА: ${e.message}`)
  console.error(`ОШИБКА: ${e.message}`)
  process.exitCode = 1
})

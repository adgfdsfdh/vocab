import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { db } from '../db/db'

// Без globals: true Testing Library не убирает отрисованное само — чистим после каждого теста.
afterEach(async () => {
  cleanup()
  localStorage.clear()
  await db.words.clear()
})

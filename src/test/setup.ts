import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Без globals: true Testing Library не убирает отрисованное само — чистим после каждого теста.
afterEach(() => {
  cleanup()
  localStorage.clear()
})

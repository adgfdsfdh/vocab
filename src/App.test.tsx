import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('рендерит заголовок на русском', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Словарь' })).toBeInTheDocument()
  })
})

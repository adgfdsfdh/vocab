import { useEffect, useState } from 'react'

// Компактный мини-вид — для узкого окна (плавающее окно на планшете, виджет на ПК)
// или принудительно по адресу ?compact=1 (так будет открывать окно Tauri в F09).
export const COMPACT_MAX_WIDTH = 420

export function isCompact(width: number, search: string): boolean {
  const param = new URLSearchParams(search).get('compact')
  if (param === '1') return true
  if (param === '0') return false
  return width <= COMPACT_MAX_WIDTH
}

export function useCompact(): boolean {
  const read = () => isCompact(window.innerWidth, window.location.search)
  const [compact, setCompact] = useState(read)
  useEffect(() => {
    const update = () => setCompact(read())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return compact
}

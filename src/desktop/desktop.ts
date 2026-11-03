// Связь с окном Tauri (F09). В обычном браузере и на планшете всего этого нет — isDesktop() = false.
// Tauri сам добавляет на страницу window.__TAURI_INTERNALS__; пакет @tauri-apps/api не нужен.

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

function internals(): TauriInternals | undefined {
  return (window as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
}

export const isDesktop = (): boolean => internals() !== undefined

export function callDesktop<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = internals()
  if (!tauri) return Promise.reject(new Error('Не в окне Tauri'))
  return tauri.invoke(cmd, args) as Promise<T>
}

// События, которые присылает окно Tauri (через window.dispatchEvent).
export const OPACITY_EVENT = 'vocab:opacity' // detail: непрозрачность 0.3…1 (выбрали в трее)
export const SHOWN_EVENT = 'vocab:shown' // окно показали горячей клавишей или из трея

// Прозрачность в интерфейсе — в процентах (0 = непрозрачно), окну передаём непрозрачность 0.3…1.
export const MAX_TRANSPARENCY = 70
const MIN_OPACITY = 0.3

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(MIN_OPACITY, value))
}

export const opacityToTransparency = (opacity: number) => Math.round((1 - clampOpacity(opacity)) * 100)
export const transparencyToOpacity = (percent: number) => clampOpacity((100 - percent) / 100)

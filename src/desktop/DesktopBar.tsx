import { useEffect, useState, type MouseEvent } from 'react'
import {
  callDesktop,
  MAX_TRANSPARENCY,
  OPACITY_EVENT,
  opacityToTransparency,
  transparencyToOpacity,
} from './desktop'

// Полоса сверху окна Tauri: за неё окно таскают мышью, тут же ползунок прозрачности и кнопка «спрятать».
// Прозрачность делает и запоминает само окно (средствами Windows); страница только передаёт значение.
export default function DesktopBar() {
  const [transparency, setTransparency] = useState(0)

  useEffect(() => {
    callDesktop<number>('get_opacity')
      .then((value) => setTransparency(opacityToTransparency(value)))
      .catch(() => {})
    const onOpacity = (e: Event) => setTransparency(opacityToTransparency(Number((e as CustomEvent).detail)))
    window.addEventListener(OPACITY_EVENT, onOpacity)
    return () => window.removeEventListener(OPACITY_EVENT, onOpacity)
  }, [])

  function onDrag(e: MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input, button')) return
    e.preventDefault()
    void callDesktop('start_drag').catch(() => {})
  }

  function onSlide(percent: number) {
    setTransparency(percent)
    void callDesktop('set_opacity', { value: transparencyToOpacity(percent) }).catch(() => {})
  }

  return (
    <div className="desktop-bar" onMouseDown={onDrag} title="Перетащите, чтобы передвинуть окно">
      <span className="drag-grip" aria-hidden="true">
        ⠿ Словарь
      </span>
      <input
        type="range"
        className="opacity-slider"
        min={0}
        max={MAX_TRANSPARENCY}
        step={5}
        value={transparency}
        aria-label="Прозрачность"
        title={`Прозрачность ${transparency}%`}
        onChange={(e) => onSlide(Number(e.target.value))}
      />
      <button
        type="button"
        className="secondary hide-window"
        aria-label="Спрятать окно"
        title="Спрятать (Ctrl+Shift+Space — показать снова)"
        onClick={() => void callDesktop('hide_window').catch(() => {})}
      >
        —
      </button>
    </div>
  )
}

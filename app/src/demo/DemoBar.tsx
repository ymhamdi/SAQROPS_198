// Narration and controls of the self-playing demo. The caption is always readable; the buttons appear when the pointer
// or a key moves, then fade out so that the HUD stays clean on camera. Space pauses, R starts again.

import { useEffect, useState } from 'react'
import { captionOf } from './captions'
import type { DemoScene } from './script'
import './demo.css'

/** How long the controls stay visible after the last movement, ms (interface timing, not a safety value). */
const AWAKE_MS = 3500

interface Props {
  scene: DemoScene
  /** the story includes the rehearsal (two more steps) */
  rehearsal: boolean
  done: boolean
  playing: boolean
  onToggle: () => void
  onRestart: () => void
  /** the HUD keeps its alert at the top: the bar sits lower there */
  view: 'tablet' | 'hud' | 'twin'
}

export function DemoBar({ scene, rehearsal, done, playing, onToggle, onRestart, view }: Props) {
  const [awake, setAwake] = useState(true)
  const caption = captionOf(scene, rehearsal)

  useEffect(() => {
    let timer = window.setTimeout(() => setAwake(false), AWAKE_MS)
    const wake = () => {
      setAwake(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setAwake(false), AWAKE_MS)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return
      if (e.key === ' ') {
        e.preventDefault()
        onToggle()
        setAwake(true)
      } else if (e.key === 'r' || e.key === 'R') {
        onRestart()
        setAwake(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle, onRestart])

  return (
    <aside className={`demo-bar is-${view}${awake ? ' is-awake' : ''}`} aria-label="Démonstration automatique">
      <p className="demo-caption" role="status" aria-live="polite">
        <span className="demo-step">
          Étape {caption.step}/{caption.steps}
        </span>
        {caption.text}
      </p>
      <div className="demo-dots" aria-hidden="true">
        {Array.from({ length: caption.steps }, (_, i) => (
          <span key={i} className={i + 1 < caption.step ? 'is-past' : i + 1 === caption.step ? 'is-now' : ''} />
        ))}
      </div>
      <div className="demo-controls">
        {!done && (
          <button type="button" onClick={onToggle}>
            {playing ? 'Pause' : 'Reprendre'}
          </button>
        )}
        <button type="button" className={done ? 'is-primary' : ''} onClick={onRestart}>
          Recommencer
        </button>
        <small>Espace : pause · R : recommencer · simulation (SIMULATED)</small>
      </div>
    </aside>
  )
}

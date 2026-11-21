import { useEffect, useRef, useState } from 'react'

export const PLAYBACK_SPEEDS = [60, 300, 900]
/** Clock tick while playing, ms (~30 updates a second). */
const TICK_MS = 33

/** The EVA clock for demoing a walk: play at a speed-up, pause, or scrub. Shared by the tablet and the HUD. */
export function usePlayback(totalS: number) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(300)
  const last = useRef<number | null>(null)

  // A timer, not animation frames: browsers pause animation frames in a window hidden behind another one, and the
  // crew's window must keep walking while mission control is in front. Each tick adds the real time elapsed.
  useEffect(() => {
    if (!playing) return
    last.current = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = (now - last.current!) / 1000
      last.current = now
      setT((v) => {
        const next = v + dt * speed
        if (next >= totalS) setPlaying(false)
        return Math.min(next, totalS)
      })
    }, TICK_MS)
    return () => {
      clearInterval(id)
      last.current = null
    }
  }, [playing, speed, totalS])

  const done = t >= totalS
  return {
    t,
    playing,
    speed,
    done,
    setSpeed,
    /** jump to an EVA time and stop playing */
    seek: (s: number) => {
      setPlaying(false)
      setT(Math.max(0, Math.min(totalS, s)))
    },
    toggle: () => {
      if (done) {
        setT(0)
        setPlaying(true)
      } else setPlaying((v) => !v)
    },
    pause: () => setPlaying(false),
  }
}

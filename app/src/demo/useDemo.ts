// Plays the demo script on a simulation: reacts to every snapshot, sends the operator's actions and sets the speed.

import { useCallback, useEffect, useRef, useState } from 'react'
import { H, v } from '../config'
import type { SimControls } from '../sim/client'
import type { Site } from '../site/site'
import { demoStep, initialDemo, type DemoScene, type DemoState } from './script'

export interface DemoControls {
  scene: DemoScene
  done: boolean
  /** start again from a fresh simulation */
  restart: () => void
}

export function useDemo(sim: SimControls, site: Site, enabled: boolean): DemoControls {
  const simRef = useRef(sim)
  const state = useRef<DemoState>(initialDemo())
  // Until the clock is seen at zero after a reset, snapshots of the previous run may still be in flight: ignore them.
  const armed = useRef(false)
  const lastT = useRef(-1)
  const lastSpeed = useRef(0)
  const [shown, setShown] = useState<{ scene: DemoScene; done: boolean }>({ scene: 'fire', done: false })

  useEffect(() => {
    simRef.current = sim
  })

  // The run starts paused and only plays once the fresh simulation has answered at t = 0, so that the script never
  // misses the first second whatever the speed.
  const restart = useCallback(() => {
    const s = simRef.current
    state.current = initialDemo()
    armed.current = false
    lastT.current = -1
    lastSpeed.current = v(H.demo.paceFastX)
    setShown({ scene: 'fire', done: false })
    s.setPlaying(false)
    s.setSpeed(lastSpeed.current)
    s.reset()
  }, [])

  useEffect(() => {
    if (enabled) restart()
  }, [enabled, restart])

  useEffect(() => {
    const snap = sim.snap
    if (!enabled || !snap) return
    if (!armed.current) {
      if (snap.t !== 0) return
      armed.current = true
      simRef.current.setPlaying(true)
    } else if (snap.t < lastT.current) {
      // The clock went back: the operator pressed « Réinitialiser ». Start the script over on a fresh simulation.
      restart()
      return
    }
    lastT.current = snap.t
    if (state.current.done) return
    const s = simRef.current
    const step = demoStep(site, snap, state.current)
    state.current = step.state
    for (const a of step.act) s.act(a)
    if (step.speed !== lastSpeed.current) {
      lastSpeed.current = step.speed
      s.setSpeed(step.speed)
    }
    setShown((p) => (p.scene === step.scene && p.done === step.done ? p : { scene: step.scene, done: step.done }))
    if (step.done) s.setPlaying(false)
  }, [sim.snap, enabled, site, restart])

  return { scene: shown.scene, done: shown.done, restart }
}

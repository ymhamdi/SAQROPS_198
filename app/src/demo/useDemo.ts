// Plays the demo script on a simulation: reacts to every snapshot, sends the operator's actions and sets the speed.
// With the rehearsal, it also holds the simulation while the screens that show the rehearsal replay it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { H, v } from '../config'
import type { RehearsalPlan } from '../rehearsal/engine'
import type { SimControls } from '../sim/client'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { DEFAULT_OPTIONS, demoStep, initialDemo, type DemoOptions, type DemoScene, type DemoState } from './script'

export interface DemoControls {
  scene: DemoScene
  done: boolean
  /** the plan PNR rehearsed, once it has (the PC shows it, the twin replays it) */
  plan: RehearsalPlan | null
  /** the story includes the rehearsal */
  rehearsal: boolean
  /** start again from a fresh simulation */
  restart: () => void
}

interface Shown {
  scene: DemoScene
  done: boolean
  plan: RehearsalPlan | null
}

const START: Shown = { scene: 'fire', done: false, plan: null }

export function useDemo(sim: SimControls, site: Site, enabled: boolean, opts: DemoOptions = DEFAULT_OPTIONS): DemoControls {
  const simRef = useRef(sim)
  const optsRef = useRef(opts)
  const state = useRef<DemoState>(initialDemo())
  // Until the clock is seen at zero after a reset, snapshots of the previous run may still be in flight: ignore them.
  const armed = useRef(false)
  const lastT = useRef(-1)
  const lastSpeed = useRef(0)
  const lastSnap = useRef<Snapshot | null>(null)
  const holdTimer = useRef<number | null>(null)
  const processRef = useRef<(snap: Snapshot) => void>(() => {})
  const [shown, setShown] = useState<Shown>(START)

  useEffect(() => {
    simRef.current = sim
    optsRef.current = opts
  })

  // One decision for one snapshot: the actions, the speed, and a hold while the rehearsal is shown.
  useEffect(() => {
    processRef.current = (snap: Snapshot) => {
      if (state.current.done) return
      const s = simRef.current
      lastSnap.current = snap
      const step = demoStep(site, snap, state.current, optsRef.current)
      state.current = step.state
      for (const a of step.act) s.act(a)
      if (step.speed !== lastSpeed.current) {
        lastSpeed.current = step.speed
        s.setSpeed(step.speed)
      }
      setShown((p) => (p.scene === step.scene && p.done === step.done && p.plan === step.state.plan ? p : { scene: step.scene, done: step.done, plan: step.state.plan }))
      if (step.done) s.setPlaying(false)
      else if (step.hold) {
        // The simulation waits while the rehearsal replays; then the COS validates the plan and the team goes in.
        s.setPlaying(false)
        if (holdTimer.current === null) {
          holdTimer.current = window.setTimeout(() => {
            holdTimer.current = null
            state.current = { ...state.current, released: true }
            simRef.current.setPlaying(true)
            if (lastSnap.current) processRef.current(lastSnap.current)
          }, v(H.demo.rehearsalHoldS) * 1000)
        }
      }
    }
  }, [site])

  // The run starts paused and only plays once the fresh simulation has answered at t = 0, so that the script never
  // misses the first second whatever the speed.
  const restart = useCallback(() => {
    const s = simRef.current
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    state.current = initialDemo()
    armed.current = false
    lastT.current = -1
    lastSnap.current = null
    lastSpeed.current = v(H.demo.paceFastX)
    setShown(START)
    s.setPlaying(false)
    s.setSpeed(lastSpeed.current)
    s.reset()
  }, [])

  useEffect(() => {
    if (enabled) restart()
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
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
    // While the simulation is held, the snapshots of the actions just sent come back at the same time: the hold decides.
    if (holdTimer.current !== null) return
    processRef.current(snap)
  }, [sim.snap, enabled, restart])

  return { scene: shown.scene, done: shown.done, plan: shown.plan, rehearsal: opts.rehearsal, restart }
}

// The rehearsal, seen as the team would see it: the HUD's first-person synthetic view, fed by the rehearsal's projected state
// instead of the live detectors, the camera following the planned route, a time slider, the air and the point of no return
// over it, and a top-down mini-map. Everything here is a SIMULATION (R12): framed, labelled twice, and never on the live HUD.

import { useEffect, useMemo, useRef, useState } from 'react'
import { H, v } from '../config'
import { clock } from '../panels/clock'
import { ReasonList } from '../panels/ReasonList'
import { Scene } from '../scene/Scene'
import type { Site } from '../site/site'
import { DECISION_COS, verdictLine } from '../stats/verdict'
import { CELL } from '../types'
import { Num } from '../ui/Num'
import { barAt, pointAt, type KnownInput, type RehearsalPlan } from './engine'
import { REHEARSAL_BANNER, RehearsalFrame } from './RehearsalBanner'
import { RehearsalMap } from './RehearsalMap'
import { sceneAt } from './sceneState'

export function RehearsalView({ site, input, plan, autoPlay = false }: { site: Site; input: KnownInput; plan: RehearsalPlan; autoPlay?: boolean }) {
  const duration = plan.track[plan.track.length - 1].arriveS
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const tRef = useRef(0)

  // The replay is fast forward: the whole mission in playbackS seconds of the wall clock.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const rate = duration / v(H.rehearsal.playbackS)
    const frame = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      tRef.current = Math.min(duration, tRef.current + dt * rate)
      setT(tRef.current)
      if (tRef.current >= duration) setPlaying(false)
      else raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const seek = (value: number) => {
    tRef.current = value
    setT(value)
  }
  const restart = () => {
    seek(0)
    setPlaying(true)
  }

  // What the plan knows of the world: the rack the drone found is drawn as an obstacle, as it would be on the plan.
  const blocked = input.known.blockedCells
  const viewSite = useMemo(() => {
    if (blocked.length === 0) return site
    const kind = new Uint8Array(site.kind)
    for (const c of blocked) kind[c] = CELL.OBSTACLE
    return { ...site, kind }
  }, [site, blocked])
  const scene = useMemo(() => sceneAt(input, plan, t), [input, plan, t])
  const here = pointAt(plan, t)
  const phase = plan.phases.find((p) => here >= p.from && here <= p.to) ?? plan.phases[plan.phases.length - 1]
  const bar = barAt(plan, t)
  const margin = plan.marginBar[here]

  return (
    <RehearsalFrame className="rehearsal-view">
      <div className="rehearsal-stage">
        <Scene className="rehearsal-scene" site={viewSite} snap={scene} />
        <p className="rehearsal-scene-tag">
          {REHEARSAL_BANNER} · vue synthétique
        </p>
        <div className="rehearsal-readout" aria-label="Air et point de non-retour répétés">
          <span>
            T+ <strong>{clock(t).slice(2)}</strong>
          </span>
          <span>
            AIR <Num value={Math.round(bar)} unit="bar" status={plan.status} />
          </span>
          <span>
            PNR <Num value={Math.round(Math.max(0, margin))} unit="bar" status={plan.status} />
          </span>
        </div>
        <RehearsalMap className="rehearsal-minimap" site={site} input={input} plan={plan} tS={t} blocked={blocked} />
      </div>

      <div className="rehearsal-controls">
        <button type="button" onClick={() => (t >= duration ? restart() : setPlaying(!playing))}>
          {playing ? 'Pause' : t >= duration ? 'Rejouer' : 'Lecture'}
        </button>
        <button type="button" onClick={restart}>
          Depuis le début
        </button>
        <input type="range" min={0} max={Math.round(duration)} step={1} value={Math.round(t)} onChange={(e) => seek(Number(e.target.value))} aria-label="Temps de la répétition" />
        <span className="rehearsal-time">
          {clock(t)} / {clock(duration)}
        </span>
      </div>

      <div className={`rehearsal-verdict is-${phase.verdict === 'GO' ? 'go' : 'nogo'}`}>
        <strong>{phase.verdict}</strong>
        <span>
          {phase.label} · {DECISION_COS}
        </span>
      </div>
      <ReasonList reasons={phase.reasons.filter((r) => r.severity !== 'info')} />

      <ol className="rehearsal-timeline">
        {plan.timeline.map((e, k) => (
          <li key={k} className={e.tS <= t ? 'is-past' : ''}>
            <time>{clock(e.tS)}</time> {e.label}
            {e.bar !== null && <Num value={Math.round(e.bar)} unit="bar" status={plan.status} />}
          </li>
        ))}
      </ol>
      <p className="pc-note">{verdictLine({ verdict: plan.verdict, reasons: plan.reasons }, 'pc')}</p>
    </RehearsalFrame>
  )
}

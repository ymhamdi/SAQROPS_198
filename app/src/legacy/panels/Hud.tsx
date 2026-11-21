import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CopilotLive } from '../copilot/useCopilot'
import { useCrewReport, type CrewPosition } from '../live/useCrewReport'
import { marsClockAt } from '../stats/card'
import { compassPoint, initialBearingDeg, positionAt } from '../stats/eva'
import { formatDistance, formatDuration } from '../stats/format'
import { evaDoseMSv, type EvaParams, type Reason } from '../stats/goNoGo'
import { liveWarnings, type LiveWarning } from '../stats/live'
import { safetyS, sphericalDistanceM, type RouteStats, type TrackPoint } from '../stats/stats'
import type { Conditions, Waypoint } from '../types'
import { AlertSlot } from '../ui/AlertSlot'
import { takesOver, walkAlerts } from '../ui/alerts'
import { AlertIcon, CloseIcon, WarningIcon } from '../ui/icons'
import { StatusBadge } from '../ui/StatusBadge'
import type { RiskTools } from './RunningLate'
import { PLAYBACK_SPEEDS, usePlayback } from './usePlayback'
import { useVisorBackdrop } from './useVisorBackdrop'
import './visor.css'

/** Fastest way from the crew's position to the nearer safe haven. */
export interface AbortPlan {
  haven: string
  timeS: number
  distanceM: number
  points: { lat: number; lon: number }[]
}

interface Props {
  stats: RouteStats
  /** [habitat, ...stops, habitat] */
  stations: Waypoint[]
  /** seconds to the nearest safe haven (habitat or staged rover) from every cell */
  walkHome: Float32Array
  params: EvaParams
  /** the plan's own cautions and no-go reasons */
  alerts: Reason[]
  /** fastest way to the nearer safe haven from a cell; `rover` = where the rover is parked on a rover-assisted plan */
  planAbort: (cell: number, rover?: number) => AbortPlan | null
  onExit: () => void
  /** EVA start (ISO UTC) and the conditions series, for the live warnings and Mars local time */
  startTime?: string
  conditions?: Conditions[]
  /** the simulated solar-storm drill is on: its alerts are labelled SIMULATED */
  drill?: boolean
  /** optional what-if copilot, given the walk clock and this view's abort */
  copilot?: (live: CopilotLive) => ReactNode
  /** running late: the spare time at the stop is shown under the leave countdown */
  risk?: RiskTools | null
  /** the crew's position, for mission control in another window */
  onLive?: (p: CrewPosition) => void
}

const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
/** The arrows point along the route (or the escape path) this far ahead, in path cells, not as the crow flies. */
const LOOK_AHEAD_CELLS = 15

/** A small north-up bearing dial: ring, north tick, arrow. Symbology, not decoration. */
function Bearing({ deg, label }: { deg: number; label: string }) {
  return (
    <svg className="visor-dial" viewBox="-30 -30 60 60" role="img" aria-label={label}>
      <circle r="26" className="visor-dial-ring" />
      <path d="M0,-29 L0,-21" className="visor-dial-north" />
      <g transform={`rotate(${deg})`}>
        <path d="M0,-18 L8,10 L0,4 L-8,10 Z" className="visor-dial-arrow" />
      </g>
    </svg>
  )
}

/** Index of the last track point of every leg (the stop it ends at). */
function legEnds(track: TrackPoint[]): number[] {
  const out: number[] = []
  track.forEach((p, i) => (out[p.leg] = i))
  return out
}

type GaugeState = 'ok' | 'caution' | 'warning'

function Gauge({ label, value, state = 'ok', badge }: { label: string; value: string; state?: GaugeState; badge?: ReactNode }) {
  return (
    <div className={`visor-gauge is-${state}`}>
      <span className="visor-label">
        {label}
        {badge}
      </span>
      <strong className="visor-number">{value}</strong>
      {state !== 'ok' && (
        <span className="visor-state">
          {state === 'warning' ? <WarningIcon size={16} /> : <AlertIcon size={16} />}
          {state === 'warning' ? 'Warning' : 'Caution'}
        </span>
      )}
    </div>
  )
}

function gaugeState(live: LiveWarning[], codes: LiveWarning['code'][]): GaugeState {
  const hit = live.filter((w) => codes.includes(w.code))
  if (hit.some((w) => w.severity === 'no-go')) return 'warning'
  return hit.length ? 'caution' : 'ok'
}

/**
 * Helmet-visor view: what a suited astronaut needs at a glance, in fixed slots at the edges of the visor so the
 * centre stays clear. One alert slot (a live warning takes over), life support at the bottom left, the copilot at the
 * bottom right. Composited over a real Navcam frame near the destination, so legibility over terrain is visible.
 * The EVA plays on the plan's clock (or is scrubbed by hand) for the demo; Abort switches to the escape path.
 */
export function Hud({ stats, stations, walkHome, params, alerts, planAbort, onExit, startTime, conditions = [], drill = false, copilot, risk, onLive }: Props) {
  const clock = usePlayback(stats.totalS)
  const { t, playing, speed, done } = clock
  const [abort, setAbort] = useState<{ atT: number; plan: AbortPlan | null } | null>(null)
  const ends = useMemo(() => legEnds(stats.track), [stats])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onExit()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  const pos = positionAt(stats.track, abort ? abort.atT : t)
  useCrewReport(onLive, { t, lat: pos.lat, lon: pos.lon, index: pos.index, atStop: pos.atStop, nextStation: pos.nextStation, abort: !!abort, playing: clock.playing, speed: clock.speed, onDetour: false, planOffsetS: 0 })
  const cell = stats.track[pos.index].cell
  const o2Left = params.o2DurationS - t
  const usable = params.o2DurationS - params.o2ReserveS
  const home = params.walkHomeContingency * safetyS(walkHome, stats.track[pos.index])
  const margin = usable - (t + home)
  const startMs = startTime ? Date.parse(startTime) : null
  const lonEast = stations[0]?.lon ?? 0
  const marsNow = startMs !== null ? marsClockAt(startMs, abort ? abort.atT : t, lonEast) : null

  // Where the route goes next: look ahead along the planned path within the current leg.
  const nextIndex = Math.min(pos.nextStation, stations.length - 1)
  const next = stations[nextIndex]
  const legEnd = ends[Math.max(0, nextIndex - 1)] ?? stats.track.length - 1
  const ahead = stats.track[Math.min(pos.index + LOOK_AHEAD_CELLS, legEnd)]
  const routeBearing = initialBearingDeg(pos, ahead.cell === stats.track[pos.index].cell ? next : ahead)
  const along = stats.track[legEnd].distanceM - (stats.track[pos.index].distanceM + sphericalDistanceM(stats.track[pos.index], pos))
  const leaveInS = pos.atStop ? stats.track[pos.index].departS - t : 0
  const planGo = !alerts.some((a) => a.severity === 'no-go')
  const stopIndex = pos.atStop && nextIndex < stations.length - 1 ? nextIndex - 1 : -1
  const spare = useMemo(() => (risk && stopIndex >= 0 && planGo ? risk.spareAt(stopIndex) : null), [risk, stopIndex, planGo])

  const backdrop = useVisorBackdrop(abort ? null : next, routeBearing)
  const live = startTime ? liveWarnings({ t, startTime, emergencyHomeS: home, conditions, params }) : []
  const list = walkAlerts(live, alerts, { marginS: margin, o2LeftS: o2Left }, drill)
  const takeover = takesOver(list)

  const credit = backdrop && (
    <p className="visor-credit">
      View: Curiosity {backdrop.camera}, sol {backdrop.sol}, {formatDistance(backdrop.distanceM)} from {next.name}{' '}
      <StatusBadge status={backdrop.status} /> <span>stands in for the view through the visor</span>
    </p>
  )

  const clockSlot = (
    <div className="visor-slot visor-clock">
      <div className="visor-clock-time">
        <span className="visor-label">EVA clock</span>
        <strong className="visor-number">{elapsed(abort ? abort.atT : t)}</strong>
        {marsNow && <span className="visor-sub">{marsNow} Mars local</span>}
      </div>
      <button type="button" className="visor-btn visor-exit" onClick={onExit}>
        <CloseIcon size={20} /> Exit
      </button>
      {drill && (
        <p className="visor-drill">
          Storm drill <StatusBadge status="SIMULATED" />
        </p>
      )}
    </div>
  )

  if (abort) {
    const plan = abort.plan
    const escapeAhead = plan ? plan.points[Math.min(LOOK_AHEAD_CELLS, plan.points.length - 1)] : null
    const bearing = plan && escapeAhead ? initialBearingDeg(pos, escapeAhead) : 0
    const worstCase = plan ? params.walkHomeContingency * plan.timeS : Infinity
    const spare = usable - (abort.atT + worstCase)
    return (
      <div className="visor is-abort" role="dialog" aria-modal="true" aria-label="Helmet HUD: abort">
        <section className="visor-slot visor-route" aria-label="Escape route">
          <p className="visor-route-head">
            <span className="visor-state is-warning">
              <WarningIcon size={18} /> Abort
            </span>
            {plan ? `Head to ${plan.haven}` : 'No walkable way to a safe haven'}
          </p>
          {plan ? (
            <div className="visor-route-main">
              <Bearing deg={bearing} label={`Escape path ${compassPoint(bearing)} ${Math.round(bearing)} degrees`} />
              <strong className="visor-number is-hero">{formatDistance(plan.distanceM)}</strong>
              <span className="visor-sub">
                {compassPoint(bearing)} {Math.round(bearing)}° · follow the escape path
              </span>
            </div>
          ) : (
            <p className="visor-sub">Call the habitat and hold position.</p>
          )}
        </section>
        <div className="visor-alert-area" />
        {clockSlot}
        <section className="visor-slot visor-life" aria-label="Life support during the abort">
          <Gauge label="Time to safety" value={plan ? formatDuration(plan.timeS) : '—'} />
          <Gauge label="O₂ left" value={formatDuration(params.o2DurationS - abort.atT)} state={params.o2DurationS - abort.atT < params.o2ReserveS ? 'warning' : 'ok'} />
          <Gauge
            label="Spare O₂ at arrival, slow pace"
            value={plan ? (spare < 0 ? `Short ${formatDuration(-spare)}` : formatDuration(spare)) : '—'}
            state={spare < 0 ? 'warning' : spare < 1800 ? 'caution' : 'ok'}
          />
        </section>
        <div className="visor-demo">
          <button type="button" className="visor-btn" onClick={() => setAbort(null)}>
            Cancel abort, resume plan
          </button>
          <span className="visor-sub">Aborted at {elapsed(abort.atT)}</span>
        </div>
      </div>
    )
  }

  const state = done ? 'Walk complete' : pos.atStop ? 'At stop' : 'Next'
  const number = pos.nextStation >= stations.length - 1 ? null : pos.nextStation

  return (
    <div
      className={`visor${takeover ? ' is-takeover' : ''}${backdrop ? ' has-view' : ''}`}
      style={backdrop ? { backgroundImage: `url("${backdrop.url}")` } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Helmet HUD view"
    >
      <section className="visor-slot visor-route" aria-label="Route">
        <p className="visor-route-head">
          <span className="visor-state">{state}</span>
          {number !== null && !done && <span className="visor-stopnum">{number}</span>}
          {done ? 'Back at the habitat' : next.name}
        </p>
        {done ? (
          <div className="visor-route-main">
            <strong className="visor-number is-hero">{formatDuration(o2Left)}</strong>
            <span className="visor-sub">of O₂ left on return</span>
          </div>
        ) : pos.atStop ? (
          <div className="visor-route-main">
            <strong className="visor-number is-hero">{leaveInS > 0 ? formatDuration(leaveInS) : 'Now'}</strong>
            <span className="visor-sub">
              {leaveInS > 0 ? 'until you leave this stop' : 'time to leave this stop'}
              {spare && ` · ${spare.limit ? `${spare.minutes} min` : `over ${formatDuration(spare.minutes * 60)}`} spare`}
            </span>
          </div>
        ) : (
          <div className="visor-route-main">
            <Bearing deg={routeBearing} label={`Route ${compassPoint(routeBearing)} ${Math.round(routeBearing)} degrees`} />
            <strong className="visor-number is-hero">{formatDistance(Math.max(0, along))}</strong>
            <span className="visor-sub">
              {compassPoint(routeBearing)} {Math.round(routeBearing)}° · along the route
            </span>
          </div>
        )}
      </section>

      <div className="visor-alert-area">
        <AlertSlot alerts={list} variant="visor" />
      </div>

      {clockSlot}

      <section className="visor-slot visor-life" aria-label="Life support">
        <Gauge label="O₂ left" value={formatDuration(o2Left)} state={gaugeState(live, ['O2_LOW'])} />
        <Gauge label="Point of no return" value={margin < 0 ? 'Passed' : `in ${formatDuration(margin)}`} state={gaugeState(live, ['NO_RETURN', 'MARGIN_LOW'])} />
        <Gauge label="EVA dose" value={`${evaDoseMSv(t).toFixed(2)} mSv`} badge={<StatusBadge status="MODELED" />} />
        <button
          type="button"
          className="visor-btn visor-abort"
          onClick={() => {
            clock.pause()
            setAbort({ atT: t, plan: planAbort(cell, stats.track[pos.index].roverCell) })
          }}
        >
          <WarningIcon size={20} /> Abort · return to safety
        </button>
      </section>

      <div className="visor-demo" aria-label="Demo playback">
        <span className="visor-demo-label">Demo playback</span>
        <button type="button" className="visor-btn" onClick={clock.toggle}>
          {playing ? 'Pause' : done ? 'Replay' : 'Play walk'}
        </button>
        <input type="range" min={0} max={stats.totalS} step={10} value={t} aria-label="Marswalk time" onChange={(e) => clock.seek(Number(e.target.value))} />
        <select className="visor-btn" value={speed} aria-label="Playback speed" onChange={(e) => clock.setSpeed(Number(e.target.value))}>
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}× speed
            </option>
          ))}
        </select>
        {credit}
      </div>

      {copilot?.({ t, index: pos.index, cell, drill, onAbort: () => (clock.pause(), setAbort({ atT: t, plan: planAbort(cell, stats.track[pos.index].roverCell) })) })}
    </div>
  )
}

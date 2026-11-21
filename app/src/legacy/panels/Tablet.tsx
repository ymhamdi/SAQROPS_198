import L from 'leaflet'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CopilotLive } from '../copilot/useCopilot'
import { useCrewReport, type CrewPosition } from '../live/useCrewReport'
import { planDetour, walkStateAt, walkTotalS, withDetour, type Detour } from '../localize/detour'
import { getRealPosition } from '../localize/getRealPosition'
import { MARS_CRS } from '../map/crs'
import { INK } from '../map/overlays'
import type { PreparedGrid } from '../route/cost'
import { compassPoint, currentLegEnd, initialBearingDeg, isRouteChangePoint } from '../stats/eva'
import { formatDistance, formatDuration, shortReason } from '../stats/format'
import type { EvaParams, Reason } from '../stats/goNoGo'
import { liveWarnings } from '../stats/live'
import { safetyS, sphericalDistanceM, type RouteStats } from '../stats/stats'
import type { Conditions, DataConfig, Waypoint } from '../types'
import { AlertSlot } from '../ui/AlertSlot'
import { walkAlerts } from '../ui/alerts'
import { AlertIcon, CheckIcon, CloseIcon, LocateIcon, WarningIcon } from '../ui/icons'
import { StatusBadge } from '../ui/StatusBadge'
import type { AbortPlan } from './Hud'
import { RunningLate, type RiskTools } from './RunningLate'
import { PLAYBACK_SPEEDS, usePlayback } from './usePlayback'

interface Props {
  config: DataConfig
  /** the terrain the walk runs on, for re-planning back to the route after a position fix */
  prepared: PreparedGrid
  stats: RouteStats
  /** [habitat, ...stops, habitat] */
  stations: Waypoint[]
  /** seconds to the nearest safe haven from every cell */
  walkHome: Float32Array
  params: EvaParams
  /** the plan's own cautions and no-go reasons */
  planReasons: Reason[]
  conditions: Conditions[]
  startTime: string
  /** fastest way to the nearer safe haven from a cell; `rover` = where the rover is parked on a rover-assisted plan */
  planAbort: (cell: number, rover?: number) => AbortPlan | null
  onExit: () => void
  /** the simulated solar-storm drill is on: its alerts are labelled SIMULATED */
  drill?: boolean
  /** optional what-if copilot, given the walk clock and this view's abort */
  copilot?: (live: CopilotLive) => ReactNode
  /** running late: spare time, stay longer, and which stops to drop when the rest no longer fits */
  risk?: RiskTools | null
  /** the crew's position, for mission control in another window */
  onLive?: (p: CrewPosition) => void
  /** a change mission control sent, until the crew dismisses it */
  note?: { text: string; onDismiss: () => void } | null
}

/** Zoom levels the tablet map may go past the deepest base-map tiles, to show a position fix up close. */
const FIX_OVERZOOM = 2

const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** Arrival and departure times at each station (index into stations). */
function stationTimes(stats: RouteStats): { arriveS: number; departS: number }[] {
  const out = [{ arriveS: 0, departS: 0 }]
  for (const p of stats.track) out[p.leg + 1] = { arriveS: p.arriveS, departS: p.departS }
  return out
}

/**
 * The crew's map: follows them along the route, walked part grey, abort path in red. After a position fix: the jump
 * from the planned to the fixed position dashed grey, and the way back onto the route in pink.
 */
function TabletMap(props: {
  config: DataConfig
  stats: RouteStats
  stations: Waypoint[]
  index: number
  crew: { lat: number; lon: number }
  abort: AbortPlan | null
  follow: boolean
  detour: Detour | null
  onDetour: boolean
}) {
  const { config, stats, stations, index, crew, abort, follow, detour, onDetour } = props
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const parts = useRef<{
    walked: L.Polyline
    ahead: L.Polyline
    aheadCasing: L.Polyline
    later: L.Polyline
    crew: L.CircleMarker
    abort: L.Polyline
    rejoinCasing: L.Polyline
    rejoin: L.Polyline
    correction: L.Polyline
    correctionCasing: L.Polyline
    fix: L.CircleMarker
  } | null>(null)

  useEffect(() => {
    // Two levels past the deepest tiles (upscaled) so a position fix tens of metres off the route is legible.
    const maxZoom = config.site.zoom.max + FIX_OVERZOOM
    const m = L.map(box.current!, { crs: MARS_CRS, minZoom: config.site.zoom.min, maxZoom, zoomSnap: 1, zoomControl: false, attributionControl: false })
    for (const layer of config.layers.filter((l) => l.tileUrl && config.initialLayers.includes(l.id))) {
      L.tileLayer(layer.tileUrl!, { maxZoom, maxNativeZoom: config.site.zoom.max }).addTo(m)
    }
    const pts = stats.track.map((p) => L.latLng(p.lat, p.lon))
    const line = { lineCap: 'round', lineJoin: 'round', interactive: false } as const
    // The leg being walked (to the next stop) bold; the legs after it thinner and faded; the walked part grey.
    L.polyline(pts, { ...line, color: INK.white, weight: 9 }).addTo(m)
    const later = L.polyline([], { ...line, color: INK.blue, weight: 4, opacity: 0.55 }).addTo(m)
    const walked = L.polyline([], { ...line, color: INK.walked, weight: 6 }).addTo(m)
    const aheadCasing = L.polyline([], { ...line, color: INK.white, weight: 14 }).addTo(m)
    const ahead = L.polyline(pts, { ...line, color: INK.blue, weight: 8 }).addTo(m)
    const correctionCasing = L.polyline([], { ...line, color: INK.white, weight: 7 }).addTo(m)
    const correction = L.polyline([], { ...line, color: INK.correction, weight: 3, dashArray: '4 8' }).addTo(m)
    const rejoinCasing = L.polyline([], { ...line, color: INK.white, weight: 12 }).addTo(m)
    const rejoin = L.polyline([], { ...line, color: INK.rejoin, weight: 7 }).addTo(m)
    const fix = L.circleMarker([0, 0], { radius: 9, color: INK.rejoin, weight: 4, fillColor: INK.white, fillOpacity: 1, interactive: true })
      .bindTooltip('<strong>Position fix</strong><span>Simulated (demo)</span>', { direction: 'top', offset: [0, -10], className: 'map-tip' })
    const abortLine = L.polyline([], { ...line, color: INK.red, weight: 7, dashArray: '2 12' }).addTo(m)
    stations.forEach((s, i) => {
      if (i === stations.length - 1 || isRouteChangePoint(s)) return
      const home = i === 0
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: `map-mark ${home ? 'mark-home' : 'mark-stop'}`, html: home ? '' : String(i), iconSize: [30, 30], iconAnchor: [15, 15] }),
        keyboard: false,
        interactive: false,
      }).addTo(m)
    })
    m.createPane('crew').style.zIndex = '650' // above the stop pins, so the crew stays visible while working at a stop
    const crewDot = L.circleMarker([stats.track[0].lat, stats.track[0].lon], { pane: 'crew', radius: 10, color: INK.white, weight: 4, fillColor: INK.green, fillOpacity: 1, className: 'crew-dot', interactive: false }).addTo(m)
    m.setView([stats.track[0].lat, stats.track[0].lon], config.site.zoom.max - 1)
    map.current = m
    parts.current = { walked, ahead, aheadCasing, later, crew: crewDot, abort: abortLine, rejoinCasing, rejoin, correction, correctionCasing, fix }
    return () => {
      m.remove()
      map.current = null
      parts.current = null
    }
  }, [config, stats, stations])

  useEffect(() => {
    const p = parts.current
    if (!p) return
    const pts = stats.track.map((q) => L.latLng(q.lat, q.lon))
    const here = L.latLng(crew.lat, crew.lon)
    const end = currentLegEnd(stats.track, index, (leg) => stations[leg + 1]?.kind !== 'via') // the next stop
    p.later.setLatLngs(pts.slice(end))
    if (!detour) {
      p.walked.setLatLngs([...pts.slice(0, index + 1), here])
      p.ahead.setLatLngs([here, ...pts.slice(index + 1, end + 1)])
      p.rejoin.setLatLngs([])
      p.rejoinCasing.setLatLngs([])
      p.correction.setLatLngs([])
      p.correctionCasing.setLatLngs([])
      p.fix.remove()
    } else {
      // Walked as believed up to the fix; then the way back (pink); then the plan from where it was rejoined.
      const way = detour.points.map((q) => L.latLng(q.lat, q.lon))
      const believed = [...pts.slice(0, detour.estimateIndex + 1), L.latLng(detour.estimate.lat, detour.estimate.lon)]
      p.walked.setLatLngs(onDetour ? [believed] : [believed, [...pts.slice(detour.rejoinIndex, index + 1), here]])
      p.ahead.setLatLngs(onDetour ? pts.slice(detour.rejoinIndex, end + 1) : [here, ...pts.slice(index + 1, end + 1)])
      p.rejoin.setLatLngs(way)
      p.rejoinCasing.setLatLngs(way)
      const jump = [L.latLng(detour.estimate.lat, detour.estimate.lon), way[0]]
      p.correction.setLatLngs(jump)
      p.correctionCasing.setLatLngs(jump)
      p.fix.setLatLng(way[0]).addTo(map.current!)
    }
    p.aheadCasing.setLatLngs(p.ahead.getLatLngs() as L.LatLng[])
    p.crew.setLatLng(here)
    p.abort.setLatLngs(abort ? abort.points.map((q) => L.latLng(q.lat, q.lon)) : [])
    if (follow) map.current!.panTo(here, { animate: false })
  }, [stats, index, crew.lat, crew.lon, abort, follow, detour, onDetour])

  // A new fix: zoom to the correction and the way back (tens of metres; too small to see at the walking zoom).
  useEffect(() => {
    if (!detour || !map.current) return
    const area = L.latLngBounds([detour.estimate, ...detour.points].map((q) => L.latLng(q.lat, q.lon)))
    map.current.fitBounds(area.pad(0.8), { maxZoom: config.site.zoom.max + FIX_OVERZOOM, animate: false })
  }, [detour, config])

  // Back on the route: return to the walking zoom.
  const wasOnDetour = useRef(false)
  useEffect(() => {
    if (wasOnDetour.current && !onDetour && map.current) map.current.setZoom(config.site.zoom.max - 1, { animate: false })
    wasOnDetour.current = onDetour
  }, [onDetour, config])

  // .map shares the main map's marker, zoom and tooltip styles.
  return <div ref={box} className="map tablet-map" />
}

/**
 * The tablet a crew member carries on the walk: where am I going next, what is wrong right now, what comes after.
 * High contrast for daylight, large targets for gloved hands. Plays the EVA on the plan's clock for the demo.
 */
export function Tablet({ config, prepared, stats, stations, walkHome, params, planReasons, conditions, startTime, planAbort, onExit, drill = false, copilot, risk, onLive, note }: Props) {
  /** position fixes taken on this walk, each with its way back onto the route (in EVA-time order) */
  const [detours, setDetours] = useState<Detour[]>([])
  // A new set of stops (mission control changed the route): earlier fixes were made against the old route.
  const stopsKey = stations.map((s) => s.id).join('|')
  useEffect(() => setDetours([]), [stopsKey])
  const [locating, setLocating] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const clock = usePlayback(walkTotalS(stats.totalS, detours))
  const { t } = clock
  const [follow, setFollow] = useState(true)
  const [abort, setAbort] = useState<{ atT: number; plan: AbortPlan | null } | null>(null)
  const times = useMemo(() => stationTimes(stats), [stats])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onExit()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  const pos = walkStateAt(stats.track, detours, abort ? abort.atT : t)
  const cell = pos.cell
  const detour = pos.detour
  // After a fix, everything from the rejoin point on runs earlier or later by the detour's shift.
  const shift = (planS: number) => planS + (detour && planS >= detour.rejoinPlanS ? detour.shiftS : 0)
  // The next stop to announce: mission control's route-change point (a few metres ahead) is passed, not announced.
  let nextIndex = Math.min(pos.nextStation, stations.length - 1)
  while (nextIndex < stations.length - 1 && isRouteChangePoint(stations[nextIndex])) nextIndex++
  const next = stations[nextIndex]
  const isHomeNext = nextIndex === stations.length - 1
  const bearing = initialBearingDeg(pos, next)
  const distance = sphericalDistanceM(pos, next)
  const emergencyHomeS = params.walkHomeContingency * safetyS(walkHome, stats.track[pos.index])
  const margin = params.o2DurationS - params.o2ReserveS - (t + emergencyHomeS)
  const live = liveWarnings({ t, startTime, emergencyHomeS, conditions, params })
  const o2Left = params.o2DurationS - t
  const alerts = walkAlerts(live, planReasons, { marginS: margin, o2LeftS: o2Left }, drill)
  const liveAlerts = alerts.filter((a) => a.live)
  const planNotes = alerts.filter((a) => !a.live)
  const gauge = (codes: string[]) => {
    const hit = live.filter((w) => codes.includes(w.code))
    return hit.some((w) => w.severity === 'no-go') ? 'warning' : hit.length ? 'caution' : 'ok'
  }
  const o2State = gauge(['O2_LOW'])
  const pnrState = gauge(['NO_RETURN', 'MARGIN_LOW'])
  const done = t >= walkTotalS(stats.totalS, detours)
  useCrewReport(onLive, { t, lat: pos.lat, lon: pos.lon, index: pos.index, atStop: pos.atStop, nextStation: pos.nextStation, abort: !!abort, playing: clock.playing, speed: clock.speed, onDetour: pos.onDetour, planOffsetS: detour && !pos.onDetour ? detour.atT + detour.timeS - detour.rejoinPlanS : 0 })

  /** Get the crew's real position (SIMULATED, see localize/getRealPosition.ts) and re-plan back onto the route. */
  async function locate() {
    clock.pause()
    setLocating(true)
    setFixError(null)
    const atT = t
    const state = walkStateAt(stats.track, detours, atT)
    // Walking direction: toward a point ~20 m further along the plan (for the sideways simulated drift).
    const track = stats.track
    const ahead = track[Math.min(state.index + 10, track.length - 1)]
    const headingDeg = ahead.cell === track[state.index].cell ? undefined : initialBearingDeg(state, ahead)
    try {
      // Only accept a position from which the route ahead can be reached on foot.
      const fix = await getRealPosition({ prepared, estimate: state, headingDeg, accept: (c) => planDetour(prepared, track, state, atT, { cell: c }) !== null })
      const d = planDetour(prepared, stats.track, state, atT, fix)
      if (!d) throw new Error('No walkable way back to the route from the fixed position.')
      setDetours((all) => withDetour(all, d))
    } catch (e) {
      setFixError(e instanceof Error ? e.message : String(e))
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="tablet" role="dialog" aria-modal="true" aria-label="Tablet view for the walk">
      <TabletMap config={config} stats={stats} stations={stations} index={pos.index} crew={pos} abort={abort?.plan ?? null} follow={follow} detour={detour} onDetour={pos.onDetour} />

      <aside className="tablet-side">
        <header className="tablet-head">
          <div>
            <span className="tablet-kick">Marswalk clock</span>
            <strong>{elapsed(abort ? abort.atT : t)}</strong>
          </div>
          <button type="button" className="tablet-btn" onClick={onExit}>
            <CloseIcon size={20} /> Exit
          </button>
        </header>

        {drill && (
          <p className="tablet-drill">
            Storm drill running <StatusBadge status="SIMULATED" />
          </p>
        )}

        {note && (
          <section className="tablet-fix is-control" aria-live="assertive">
            <span className="tablet-kick">Message from mission control</span>
            <p>{note.text}</p>
            <button type="button" className="tablet-btn" onClick={note.onDismiss}>
              OK
            </button>
          </section>
        )}

        {abort ? (
          <section className="tablet-next is-abort" aria-live="assertive">
            <h2>
              <span className="tablet-state">
                <WarningIcon size={18} /> Abort
              </span>
              {abort.plan ? `Head to ${abort.plan.haven}` : 'No walkable way to a safe haven'}
            </h2>
            {abort.plan && (
              <p>
                {formatDistance(abort.plan.distanceM)} along the red path · {formatDuration(abort.plan.timeS)} (
                {formatDuration(params.walkHomeContingency * abort.plan.timeS)} at the slow pace)
              </p>
            )}
            <button type="button" className="tablet-btn" onClick={() => setAbort(null)}>
              Cancel abort
            </button>
          </section>
        ) : (
          <section className="tablet-next" aria-live="polite">
            <h2>
              <span className="tablet-state">{done ? 'Done' : pos.atStop ? 'At stop' : 'Next'}</span>
              {!isHomeNext && !done && <span className="tablet-num">{nextIndex}</span>}
              {done ? 'Back at the habitat' : next.name}
            </h2>
            {!done && (
              <p>
                {pos.atStop
                  ? `Leave at ${elapsed(shift(times[nextIndex]?.departS ?? 0))}`
                  : `${formatDistance(distance)} straight line · ${compassPoint(bearing)} ${Math.round(bearing)}° · arrive ${elapsed(shift(times[nextIndex]?.arriveS ?? 0))}`}
              </p>
            )}
            {risk && !done && !isHomeNext && (
              <RunningLate risk={risk} at={nextIndex - 1} atStop={pos.atStop} planGo={!planReasons.some((r) => r.severity === 'no-go')} />
            )}
          </section>
        )}

        {locating && (
          <section className="tablet-fix" aria-live="polite">
            <span className="tablet-kick">Position fix</span>
            <h2>Getting the crew's real position…</h2>
          </section>
        )}
        {!locating && fixError && (
          <section className="tablet-fix is-error" aria-live="assertive">
            <span className="tablet-kick">Position fix failed</span>
            <p>{fixError}</p>
            <button type="button" className="tablet-btn" onClick={() => setFixError(null)}>
              Dismiss
            </button>
          </section>
        )}
        {!locating && !fixError && detour && (
          <section className="tablet-fix" aria-live="polite">
            <div className="tablet-fix-head">
              <span className="tablet-kick">Position fix at {elapsed(detour.atT)}</span>
              <StatusBadge status={detour.fix.status} />
            </div>
            <h2>{pos.onDetour ? 'Off the planned route: follow the pink path back' : 'Back on the planned route'}</h2>
            <p>
              The fix puts the crew {formatDistance(detour.fix.offsetM)} {compassPoint(detour.fix.bearingDeg)} of where the plan had them (±{detour.fix.accuracyM} m).
              {detour.timeS > 0
                ? ` Way back: ${formatDistance(detour.distanceM)}, ${formatDuration(detour.timeS)}; the rest of the plan runs ${formatDuration(Math.abs(detour.shiftS))} ${detour.shiftS >= 0 ? 'later' : 'earlier'}.`
                : ' Already on the route: carry on.'}
            </p>
            <div className="tablet-fix-key" aria-hidden="true">
              <span>
                <i className="key-correction" /> correction
              </span>
              <span>
                <i className="key-rejoin" /> way back
              </span>
              <span>
                <i className="key-plan" /> planned route
              </span>
            </div>
            <button type="button" className="tablet-btn" onClick={() => setDetours([])}>
              Clear fixes
            </button>
          </section>
        )}

        <div className="tablet-gauges">
          <div className={`is-${o2State}`}>
            <span>O₂ left</span>
            <strong>{formatDuration(o2Left)}</strong>
            {o2State !== 'ok' && <em className="tablet-gauge-state">{o2State === 'warning' ? 'Warning' : 'Caution'}</em>}
          </div>
          <div className={`is-${pnrState}`}>
            <span>Point of no return</span>
            <strong>{margin < 0 ? 'Passed' : `in ${formatDuration(margin)}`}</strong>
            {pnrState !== 'ok' && <em className="tablet-gauge-state">{pnrState === 'warning' ? 'Warning' : 'Caution'}</em>}
          </div>
        </div>

        <section className="tablet-warnings" aria-label="Warnings">
          <h3>Right now</h3>
          {liveAlerts.length === 0 ? (
            <p className="tablet-ok">
              <CheckIcon size={20} /> All clear right now.
            </p>
          ) : (
            <AlertSlot alerts={liveAlerts} variant="tablet" />
          )}
          {planNotes.length > 0 && (
            <>
              <h3 className="tablet-plan-head">Plan notes</h3>
              <ul className="tablet-plan">
                {planNotes.map((a) => (
                  <li key={a.key} className={`is-${a.level}`} title={a.detail}>
                    {a.level === 'warning' ? <WarningIcon size={18} /> : <AlertIcon size={18} />}
                    <span>
                      <strong>{a.level === 'warning' ? 'No-go' : 'Caution'}:</strong> {shortReason(a.detail)}
                    </span>
                    {a.drill && <StatusBadge status="SIMULATED" />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="tablet-upcoming" aria-label="Upcoming stops">
          <h3>Coming up</h3>
          <ol>
            {stations.slice(nextIndex + 1).map((s, k) => {
              const i = nextIndex + 1 + k
              const home = i === stations.length - 1
              return (
                <li key={`${s.id}-${i}`}>
                  {home ? <span className="pin pin-home" aria-hidden="true" /> : <span className="pin">{i}</span>}
                  <span>{s.name}</span>
                  <span className="tablet-eta">{elapsed(shift(times[i]?.arriveS ?? 0))}</span>
                </li>
              )
            })}
          </ol>
        </section>

        <footer className="tablet-controls">
          <button type="button" className="tablet-btn is-primary" onClick={clock.toggle} disabled={!!abort || locating}>
            {clock.playing ? 'Pause' : done ? 'Replay' : 'Play walk'}
          </button>
          <input
            type="range"
            min={0}
            max={walkTotalS(stats.totalS, detours)}
            step={10}
            value={t}
            aria-label="Marswalk time"
            disabled={!!abort || locating}
            onChange={(e) => clock.seek(Number(e.target.value))}
          />
          <select value={clock.speed} aria-label="Playback speed" onChange={(e) => clock.setSpeed(Number(e.target.value))}>
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
          <button type="button" className="tablet-btn" aria-pressed={follow} onClick={() => setFollow((v) => !v)}>
            {follow ? 'Following crew' : 'Follow crew'}
          </button>
          <button
            type="button"
            className="tablet-btn is-locate"
            disabled={!!abort || locating || done}
            title="Get the crew's real position and a way back to the planned route (simulated for the demo)"
            onClick={locate}
          >
            <LocateIcon size={18} /> {locating ? 'Locating…' : 'Get real position'}
          </button>
          <button
            type="button"
            className="tablet-btn is-danger"
            disabled={!!abort}
            onClick={() => {
              clock.pause()
              setAbort({ atT: t, plan: planAbort(cell, stats.track[pos.index].roverCell) })
            }}
          >
            <WarningIcon size={20} /> Abort
          </button>
        </footer>
      </aside>
      {!abort && copilot?.({ t, index: pos.index, cell, drill, onAbort: () => (clock.pause(), setAbort({ atT: t, plan: planAbort(cell, stats.track[pos.index].roverCell) })) })}
    </div>
  )
}

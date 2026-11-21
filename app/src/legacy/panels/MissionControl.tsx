// Mission control: the habitat's view of a Marswalk under way. Where the crew is now (live from the crew's tablet or
// HUD in another window, or a simulated walk), how they are doing, and the rest of the walk, which can be changed
// while they walk: drop or reorder stops, add a science target, send them through a point first, or call them back.
// Every change is judged with the planner's own GO / NO-GO before it is sent.

import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CrewReport } from '../live/link'
import { MARS_CRS } from '../map/crs'
import { INK } from '../map/overlays'
import type { CrewAt } from '../route/reroute'
import type { RouteResult } from '../route/route'
import { compassPoint, currentLegEnd, initialBearingDeg, isRouteChangePoint, positionAt } from '../stats/eva'
import { formatDistance, formatDuration, shortReason } from '../stats/format'
import type { EvaParams, EvaVerdict, Reason } from '../stats/goNoGo'
import { liveWarnings } from '../stats/live'
import { safetyS, sphericalDistanceM, type RouteStats } from '../stats/stats'
import type { Conditions, DataConfig, ScienceTarget, Waypoint } from '../types'
import { AlertSlot } from '../ui/AlertSlot'
import { walkAlerts } from '../ui/alerts'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, TabletIcon, WarningIcon } from '../ui/icons'
import { StatusBadge } from '../ui/StatusBadge'
import { PLAYBACK_SPEEDS, usePlayback } from './usePlayback'
import './control.css'

/** A change to the rest of the walk, planned from the crew's position and judged. */
export interface Draft {
  stops: Waypoint[]
  route: Extract<RouteResult, { ok: true }>
  verdict: EvaVerdict
}

interface Props {
  config: DataConfig
  stats: RouteStats
  /** [habitat, ...stops, habitat] */
  stations: Waypoint[]
  stops: Waypoint[]
  targets: ScienceTarget[]
  walkHome: Float32Array
  params: EvaParams
  planReasons: Reason[]
  conditions: Conditions[]
  startTime: string
  drill: boolean
  /** the latest report from the crew's walk view in another window, on this plan; null when none */
  crew: (CrewReport & { receivedAt: number }) | null
  /** plans `ahead` (the stops after the cut) from the crew's position and judges the whole walk */
  replan: (ahead: Waypoint[], at: CrewAt) => Promise<Draft | { error: string }>
  /** puts the change on the plan and sends it to the crew */
  onSend: (d: Draft, note: string) => void
  /** a via point at a clicked spot, or why it cannot be one */
  makeVia: (lat: number, lon: number) => Waypoint | string
  /** a change the crew made on their side (e.g. dropped a stop), until dismissed */
  note: { text: string; onDismiss: () => void } | null
  onOpenCrew: () => void
  onExit: () => void
}

/** A crew report older than this means the crew's window is gone, ms. */
const LIVE_TIMEOUT_MS = 3000

const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** The overview map: route walked and ahead, the crew, the stops, targets to add, and the drafted change. */
function ControlMap(props: {
  config: DataConfig
  stats: RouteStats
  stations: Waypoint[]
  targets: ScienceTarget[]
  crew: { lat: number; lon: number; index: number }
  draft: Draft | null
  /** stops of the draft that are not on the plan yet */
  added: Waypoint[]
  editable: boolean
  onTarget: (t: ScienceTarget) => void
  onMapClick: (lat: number, lon: number) => void
  centre: number
}) {
  const { config, stats, stations, targets, crew, draft, added, editable, onTarget, onMapClick, centre } = props
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const crewDot = useRef<L.CircleMarker | null>(null)
  const lines = useRef<{ walked: L.Polyline; ahead: L.Polyline; aheadCasing: L.Polyline; later: L.Polyline } | null>(null)
  const cb = useRef({ onTarget, onMapClick, editable })
  cb.current = { onTarget, onMapClick, editable }
  const trackPts = useMemo(() => stats.track.map((p) => L.latLng(p.lat, p.lon)), [stats])
  const fromIndex = useRef(crew.index)
  fromIndex.current = crew.index

  useEffect(() => {
    const m = L.map(box.current!, { crs: MARS_CRS, minZoom: config.site.zoom.min, maxZoom: config.site.zoom.max, zoomSnap: 1, attributionControl: false })
    for (const layer of config.layers.filter((l) => l.tileUrl && config.initialLayers.includes(l.id))) L.tileLayer(layer.tileUrl!, { maxZoom: config.site.zoom.max }).addTo(m)
    m.createPane('pins').style.zIndex = '620'
    m.createPane('crew').style.zIndex = '650'
    crewDot.current = L.circleMarker([0, 0], { pane: 'crew', radius: 10, color: INK.white, weight: 4, fillColor: INK.green, fillOpacity: 1, className: 'crew-dot', interactive: false }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => cb.current.editable && cb.current.onMapClick(e.latlng.lat, e.latlng.lng))
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [config])

  // The plan: casing, walked part grey, the rest blue; numbered stops; targets that can be added.
  useEffect(() => {
    const m = map.current!
    const g = L.layerGroup().addTo(m)
    const pts = stats.track.map((p) => L.latLng(p.lat, p.lon))
    const line = { lineCap: 'round', lineJoin: 'round', interactive: false } as const
    // The leg being walked (to the next stop) bold; the legs after it thinner and faded; the walked part grey.
    L.polyline(pts, { ...line, color: INK.white, weight: 8 }).addTo(g)
    const later = L.polyline(pts, { ...line, color: INK.blue, weight: 4, opacity: 0.55 }).addTo(g)
    const walked = L.polyline([], { ...line, color: INK.walked, weight: 5 }).addTo(g)
    const aheadCasing = L.polyline([], { ...line, color: INK.white, weight: 12 }).addTo(g)
    const ahead = L.polyline([], { ...line, color: INK.blue, weight: 7 }).addTo(g)
    lines.current = { walked, ahead, aheadCasing, later }
    const mark = (cls: string, html: string, size: number) => L.divIcon({ className: `map-mark ${cls}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
    for (const t of targets) {
      if (stations.some((s) => s.id === t.id) || added.some((s) => s.id === t.id)) continue
      L.marker([t.lat, t.lon], { pane: 'pins', icon: mark('mark-target', '', 18), title: `Add ${t.name}` })
        .bindTooltip(`<strong>${t.name.replace(/</g, '&lt;')}</strong><span>Click to add to the rest of the walk</span>`, { direction: 'top', offset: [0, -13], className: 'map-tip' })
        .on('click', () => cb.current.editable && cb.current.onTarget(t))
        .addTo(g)
    }
    stations.forEach((s, i) => {
      if (i === stations.length - 1 || isRouteChangePoint(s)) return
      L.marker([s.lat, s.lon], { pane: 'pins', icon: mark(i === 0 ? 'mark-home' : 'mark-stop', i === 0 ? '' : String(i), i === 0 ? 28 : 26), keyboard: false, interactive: false }).addTo(g)
    })
    return () => {
      g.remove()
      lines.current = null
    }
  }, [stats, stations, targets, added])

  // The drafted change, dashed, with its new stops ringed.
  useEffect(() => {
    if (!draft) return
    const g = L.layerGroup().addTo(map.current!)
    // Only the changed part: the new plan is the old one up to the crew.
    const pts = (draft.verdict.stats?.track ?? []).slice(fromIndex.current).map((p) => L.latLng(p.lat, p.lon))
    const line = { lineCap: 'round', lineJoin: 'round', interactive: false } as const
    L.polyline(pts, { ...line, color: INK.white, weight: 9 }).addTo(g)
    L.polyline(pts, { ...line, color: INK.draft, weight: 5, dashArray: '10 8' }).addTo(g)
    for (const s of added)
      L.marker([s.lat, s.lon], { pane: 'pins', icon: L.divIcon({ className: 'map-mark mark-draft', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(g)
    return () => {
      g.remove()
    }
  }, [draft, added, stats])

  // The crew, and the walked part up to them.
  useEffect(() => {
    const here = L.latLng(crew.lat, crew.lon)
    crewDot.current?.setLatLng(here)
    const l = lines.current
    if (!l) return
    const end = currentLegEnd(stats.track, crew.index, (leg) => stations[leg + 1]?.kind !== 'via') // the next stop
    const current = [here, ...trackPts.slice(crew.index + 1, end + 1)]
    l.walked.setLatLngs([...trackPts.slice(0, crew.index + 1), here])
    l.ahead.setLatLngs(current)
    l.aheadCasing.setLatLngs(current)
    l.later.setLatLngs(trackPts.slice(end))
  }, [crew.lat, crew.lon, crew.index, trackPts, stats, stations])

  // Fit the whole walk at the start; "Centre on crew" re-centres (centre is a counter).
  useEffect(() => {
    const m = map.current!
    m.fitBounds(L.latLngBounds(stats.track.map((p) => L.latLng(p.lat, p.lon))).pad(0.15), { animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (centre > 0) map.current?.panTo([crew.lat, crew.lon])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre])

  // Toggled on the element: re-rendering className would wipe the classes Leaflet adds to its container.
  useEffect(() => {
    map.current?.getContainer().classList.toggle('is-editable', editable)
  }, [editable])

  return <div ref={box} className="map tablet-map control-map" />
}

export function MissionControl(props: Props) {
  const { config, stats, stations, stops, targets, walkHome, params, planReasons, conditions, startTime, drill, crew, replan, onSend, makeVia, note, onOpenCrew, onExit } = props
  const clock = usePlayback(stats.totalS)
  const [now, setNow] = useState(() => Date.now())
  const moving = crew !== null && crew.playing
  // While the crew walks, redraw every frame (this window is the one in front): their position is carried forward
  // between reports. Otherwise once a second, to notice a crew window that has gone quiet.
  useEffect(() => {
    if (!moving) {
      const id = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(id)
    }
    let raf = 0
    const frame = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [moving])
  const live = crew !== null && now - crew.receivedAt < LIVE_TIMEOUT_MS
  // When the crew's window goes quiet, the simulated walk carries on from where they were last heard.
  const lastLiveT = useRef<number | null>(null)
  useEffect(() => {
    if (live) lastLiveT.current = crew!.t
    else if (lastLiveT.current !== null) {
      clock.seek(lastLiveT.current)
      lastLiveT.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, crew?.t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onExit()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  // Live: the last report, moved on at the crew's playback speed for the time since it arrived (a hidden or busy crew
  // window reports less often; each report corrects the estimate). Off the route after a fix: the report as it is.
  const t = !live ? clock.t : crew!.playing ? Math.min(stats.totalS, crew!.t + (Math.max(0, now - crew!.at) / 1000) * crew!.speed) : crew!.t
  const pos =
    live && crew!.onDetour
      ? { lat: crew!.lat, lon: crew!.lon, index: Math.min(crew!.index, stats.track.length - 1), atStop: crew!.atStop, nextStation: crew!.nextStation }
      : positionAt(stats.track, live ? t - crew!.planOffsetS : t)
  const done = t >= stats.totalS
  let nextIndex = Math.min(pos.nextStation, stations.length - 1)
  while (nextIndex < stations.length - 1 && isRouteChangePoint(stations[nextIndex])) nextIndex++
  const next = stations[nextIndex]
  const emergencyHomeS = params.walkHomeContingency * safetyS(walkHome, stats.track[pos.index])
  const margin = params.o2DurationS - params.o2ReserveS - (t + emergencyHomeS)
  const o2Left = params.o2DurationS - t
  const liveW = liveWarnings({ t, startTime, emergencyHomeS, conditions, params })
  const liveAlerts = walkAlerts(liveW, planReasons, { marginS: margin, o2LeftS: o2Left }, drill).filter((a) => a.live)
  const gauge = (codes: string[]) => {
    const hit = liveW.filter((w) => codes.includes(w.code))
    return hit.some((w) => w.severity === 'no-go') ? 'warning' : hit.length ? 'caution' : 'ok'
  }

  // Stops that can still change: from the one being walked to (mid-leg) or after the one being worked (at a stop).
  const editableFrom = done ? stops.length : pos.atStop ? pos.nextStation : pos.nextStation - 1
  const kept = stops.slice(0, editableFrom)
  const keptIds = new Set(kept.map((s) => s.id))
  const current = stops.slice(editableFrom)
  const [draft, setDraft] = useState<Waypoint[] | null>(null)
  const ahead = (draft ?? current).filter((s) => !keptIds.has(s.id))
  const added = useMemo(() => (draft ?? []).filter((s) => !stops.some((x) => x.id === s.id)), [draft, stops])
  const [preview, setPreview] = useState<{ for: Waypoint[]; result: Draft | { error: string } } | null>(null)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [centre, setCentre] = useState(0)
  const at = useRef<CrewAt>({ index: pos.index, atStop: pos.atStop })
  at.current = { index: pos.index, atStop: pos.atStop }
  /** the planner's re-plan and the stops already reached, as of the latest render (the crew keeps moving) */
  const latest = useRef({ replan, keptIds })
  latest.current = { replan, keptIds }
  const plan = (list: Waypoint[]) => latest.current.replan(list.filter((s) => !latest.current.keptIds.has(s.id)), at.current)

  // Judge the draft from where the crew is (again shortly after each edit; the send re-plans from where they are then).
  useEffect(() => {
    if (!draft) return setPreview(null)
    let alive = true
    const timer = setTimeout(() => {
      plan(draft).then((result) => alive && setPreview({ for: draft, result }))
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const result = preview && preview.for === draft ? preview.result : null
  const ready = result && 'route' in result ? result : null

  const edit = (next: Waypoint[]) => {
    setProblem(null)
    setSent(null)
    setDraft(next)
  }
  const move = (k: number, by: number) => {
    const list = [...ahead]
    const [s] = list.splice(k, 1)
    list.splice(k + by, 0, s)
    edit(list)
  }
  const addTarget = (tg: ScienceTarget) => {
    if (stops.some((s) => s.id === tg.id) || ahead.some((s) => s.id === tg.id)) return
    edit([...ahead, { id: tg.id, lat: tg.lat, lon: tg.lon, kind: 'science', name: tg.name }])
  }
  const addVia = (lat: number, lon: number) => {
    const v = makeVia(lat, lon)
    if (typeof v === 'string') return setProblem(v)
    edit([v, ...ahead]) // "go through here first": the usual way round a problem just ahead
  }

  /** One sentence for the crew: what changed. */
  function changeNote(d: Draft): string {
    const before = current.filter((s) => !keptIds.has(s.id))
    const after = d.stops.filter((s) => s.kind !== 'via' || !s.id.startsWith('reroute-'))
    const ids = new Set(after.map((s) => s.id))
    const dropped = before.filter((s) => !ids.has(s.id) && s.kind === 'science').map((s) => s.name)
    const newOnes = after.filter((s) => !stops.some((x) => x.id === s.id))
    const parts: string[] = []
    if (dropped.length) parts.push(`dropped ${dropped.join(' and ')}`)
    const sci = newOnes.filter((s) => s.kind === 'science').map((s) => s.name)
    if (sci.length) parts.push(`added ${sci.join(' and ')}`)
    if (newOnes.some((s) => s.kind === 'via')) parts.push('new path through a waypoint')
    if (!parts.length) parts.push(ahead.length ? 'new order of the stops ahead' : 'straight back to the habitat')
    const back = d.verdict.stats ? ` Back at ${elapsed(d.verdict.stats.totalS)}.` : ''
    return `Mission control changed the route: ${parts.join(', ')}.${back}`
  }

  async function send() {
    if (!draft) return
    setSending(true)
    setProblem(null)
    // Re-plan from where the crew is now: they kept walking while the change was drafted.
    const r = await plan(draft)
    setSending(false)
    if ('error' in r) return setProblem(r.error)
    onSend(r, changeNote(r))
    setSent(`Sent to the crew at ${elapsed(t)}.`)
    setDraft(null)
    setPreview(null)
  }

  const deltaS = ready?.verdict.stats ? ready.verdict.stats.totalS - stats.totalS : 0
  const issues = ready ? ready.verdict.reasons.filter((r) => r.severity !== 'info') : []
  const editable = !done && !sending

  return (
    <div className="tablet control" role="dialog" aria-modal="true" aria-label="Mission control">
      <ControlMap
        config={config}
        stats={stats}
        stations={stations}
        targets={targets}
        crew={pos}
        draft={ready}
        added={added}
        editable={editable}
        onTarget={addTarget}
        onMapClick={addVia}
        centre={centre}
      />

      <aside className="tablet-side">
        <header className="tablet-head">
          <div>
            <span className="tablet-kick">Mission control · Marswalk clock</span>
            <strong>{elapsed(t)}</strong>
          </div>
          <button type="button" className="tablet-btn" onClick={onExit}>
            <CloseIcon size={20} /> Exit
          </button>
        </header>

        <div className={`control-link${live ? ' is-live' : ''}`}>
          <span className="control-link-dot" aria-hidden="true" />
          <span>
            {live ? `Live from the crew ${crew!.view === 'hud' ? 'HUD' : 'tablet'}` : 'No crew window open: simulated walk'}
            <StatusBadge status="SIMULATED" />
          </span>
          {!live && (
            <button type="button" className="tablet-btn" onClick={onOpenCrew} title="Opens the crew tablet in a new window, linked to this one">
              <TabletIcon size={18} /> Open crew tablet
            </button>
          )}
        </div>

        {note && (
          <section className="tablet-fix is-control" aria-live="polite">
            <span className="tablet-kick">From the crew</span>
            <p>{note.text}</p>
            <button type="button" className="tablet-btn" onClick={note.onDismiss}>
              OK
            </button>
          </section>
        )}

        {live && crew!.abort && (
          <p className="control-abort" role="alert">
            <WarningIcon size={18} /> The crew pressed Abort: heading to safety.
          </p>
        )}

        <section className="tablet-next" aria-live="polite">
          <h2>
            <span className="tablet-state">{done ? 'Done' : pos.atStop ? 'At stop' : 'Next'}</span>
            {!done && nextIndex < stations.length - 1 && <span className="tablet-num">{nextIndex}</span>}
            {done ? 'Back at the habitat' : next.name}
          </h2>
          {!done && !pos.atStop && (
            <p>
              {formatDistance(sphericalDistanceM(pos, next))} straight line · {compassPoint(initialBearingDeg(pos, next))}
            </p>
          )}
        </section>

        <div className="tablet-gauges">
          <div className={`is-${gauge(['O2_LOW'])}`}>
            <span>O₂ left</span>
            <strong>{formatDuration(o2Left)}</strong>
          </div>
          <div className={`is-${gauge(['NO_RETURN', 'MARGIN_LOW'])}`}>
            <span>Point of no return</span>
            <strong>{margin < 0 ? 'Passed' : `in ${formatDuration(margin)}`}</strong>
          </div>
        </div>
        {liveAlerts.length > 0 && <AlertSlot alerts={liveAlerts} variant="tablet" />}

        <section className="control-plan" aria-label="Rest of the walk">
          <div className="control-plan-head">
            <h3>Rest of the walk</h3>
            <button type="button" className="tablet-btn" onClick={() => setCentre((n) => n + 1)}>
              Centre on crew
            </button>
          </div>
          {kept.some((s) => s.kind === 'science') && (
            <p className="control-kept">
              Done:{' '}
              {kept
                .map((s, i) => (s.kind === 'science' ? `${i + 1}. ${s.name}` : null))
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <ol className="control-stops">
            {ahead.map((s, k) => (
              <li key={s.id} className={draft && added.some((x) => x.id === s.id) ? 'is-new' : ''}>
                <span className="pin">{kept.length + k + 1}</span>
                <span className="control-stop-name">
                  {s.name}
                  <small>{s.kind === 'science' ? 'Science stop' : 'Via point'}</small>
                </span>
                <span className="control-stop-btns">
                  <button type="button" className="icon-btn" aria-label={`Move ${s.name} earlier`} disabled={!editable || k === 0} onClick={() => move(k, -1)}>
                    <ChevronUpIcon size={18} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${s.name} later`} disabled={!editable || k === ahead.length - 1} onClick={() => move(k, 1)}>
                    <ChevronDownIcon size={18} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Drop ${s.name}`} disabled={!editable} onClick={() => edit(ahead.filter((x) => x.id !== s.id))}>
                    <CloseIcon size={18} />
                  </button>
                </span>
              </li>
            ))}
            <li className="is-home">
              <span className="pin pin-home" aria-hidden="true" />
              <span className="control-stop-name">{stations[0].name}</span>
            </li>
          </ol>
          {editable && <p className="control-hint">Click a science target on the map to add it, or the ground to send the crew through that point first.</p>}
          {editable && ahead.length > 0 && (
            <button type="button" className="tablet-btn" onClick={() => edit([])}>
              Straight back to the habitat
            </button>
          )}
          {sent && !draft && <p className="control-sent">{sent}</p>}
          {problem && (
            <p className="control-problem" role="alert">
              {problem}
            </p>
          )}
        </section>

        {draft && (
          <section className="control-draft" aria-live="polite">
            <span className="tablet-kick">Change not sent yet</span>
            {!result ? (
              <p>Planning from where the crew is…</p>
            ) : 'error' in result ? (
              <p>{result.error}</p>
            ) : (
              <>
                <p className="control-draft-verdict">
                  <span className={`verdict-pill ${result.verdict.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>{result.verdict.verdict}</span>
                  <span>
                    Back at {elapsed(result.verdict.stats?.totalS ?? 0)}{' '}
                    <strong>
                      ({deltaS >= 0 ? '+' : '−'}
                      {formatDuration(Math.abs(deltaS))})
                    </strong>
                  </span>
                </p>
                {issues.slice(0, 3).map((r) => (
                  <p key={r.code} className={`control-issue is-${r.severity}`}>
                    {r.severity === 'no-go' ? 'No-go' : 'Caution'}: {shortReason(r.message)}
                  </p>
                ))}
              </>
            )}
            <div className="control-draft-btns">
              <button type="button" className="tablet-btn is-primary" disabled={!ready || sending} onClick={send}>
                {sending ? 'Sending…' : 'Send to crew'}
              </button>
              <button type="button" className="tablet-btn" disabled={sending} onClick={() => (setDraft(null), setProblem(null))}>
                Discard
              </button>
            </div>
          </section>
        )}

        {!live && (
          <footer className="tablet-controls">
            <button type="button" className="tablet-btn is-primary" onClick={clock.toggle}>
              {clock.playing ? 'Pause' : done ? 'Replay' : 'Play walk'}
            </button>
            <input type="range" min={0} max={stats.totalS} step={10} value={clock.t} aria-label="Marswalk time" onChange={(e) => clock.seek(Number(e.target.value))} />
            <select value={clock.speed} aria-label="Playback speed" onChange={(e) => clock.setSpeed(Number(e.target.value))}>
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}× speed
                </option>
              ))}
            </select>
          </footer>
        )}
      </aside>
    </div>
  )
}

import { useState } from 'react'
import { ElevationProfile } from './ElevationProfile'
import { HAZARD_COLORS, HAZARD_LABELS, cellHazard, legHazardSeconds, type Hazard } from '../map/overlays'
import type { RouteParams, RouteProfile } from '../route/cost'
import { formatDistance, formatDuration } from '../stats/format'
import type { EvaVerdict } from '../stats/goNoGo'
import type { CostGrid, DataStatus, ScienceTarget, Waypoint } from '../types'
import { nextPriority, priorityOf, type Priorities, type Priority } from '../stats/risk'
import { AlertIcon, CloseIcon, GripIcon, LineMark, PriorityIcon } from '../ui/icons'
import { StatusBadge } from '../ui/StatusBadge'

export interface Message {
  kind: 'error' | 'info'
  text: string
}

interface Props {
  siteName: string
  dataStatus: DataStatus
  grid: CostGrid
  routeParams: RouteParams
  base: Waypoint
  stops: Waypoint[]
  verdict: EvaVerdict | null
  routing: boolean
  failedLeg: number | null
  notice: Message | null
  startTime: string
  /** "10:30 Mars local (13:12 UTC)" */
  startLabel: string
  o2DurationS: number
  /** when a rover worked at the plan's stops, for comparison; null when no stop is on its path */
  roverSols: { rover: string; first: number; last: number; sols: number; earthDays: number; stopsMatched: number } | null
  targets: ScienceTarget[]
  onAddTarget: (target: ScienceTarget) => void
  onRemove: (id: string) => void
  profile: RouteProfile
  onProfile: (profile: RouteProfile) => void
  /** both alternatives' verdicts, only when the fastest saves enough time to be a real choice */
  routeOptions: Record<RouteProfile, EvaVerdict> | null
  /** seconds the fastest route saves over the safest */
  savingS: number
  /** 'habitat' or the id of the stop where the rover is staged as a safe haven */
  roverAt: string
  onRoverAt: (at: string) => void
  /** rover-assisted Marswalk on/off */
  ride: boolean
  onRide: (on: boolean) => void
  /** the same stops walked all the way, s, for the comparison (rover-assisted plans only) */
  onFootS: number | null
  /** a clear start to suggest when the chosen start is not clear, or null */
  suggestedStart: { time: string; ltst: string } | null
  onStartTime: (iso: string) => void
  onOptimise: () => void
  optimising: boolean
  /** stop priorities: the lowest are dropped first when the walk runs late */
  priorities: Priorities
  onPriority: (id: string, p: Priority) => void
  /** planned time at each stop, s (the default plus any extra stay) */
  dwellS: number[]
  /** move the stop at index `from` to index `to` */
  onMove: (from: number, to: number) => void
  onClear: () => void
  /** open the saved plans panel to save this plan */
  onSavePlan: () => void
  /** open the printable Marswalk card; null while the route is not ready */
  onPrint: (() => void) | null
  /** 0 = habitat, n = stop n */
  selected: number | null
  onSelect: (station: number) => void
  hoverIndex: number | null
  onHover: (index: number | null) => void
}

/** Mission-elapsed clock: T+h:mm from the EVA start. */
const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** Arrival time (EVA clock) at the end of each leg, from the stats track. */
function arrivals(verdict: EvaVerdict | null): number[] {
  const out: number[] = []
  for (const p of verdict?.stats?.track ?? []) out[p.leg] = p.arriveS
  return out
}

const HAZARD_CHIPS: Hazard[] = ['steep', 'sand', 'boulders']

const PROFILE_LABEL: Record<RouteProfile, string> = { fastest: 'Fastest', safest: 'Safest' }

/** Walking seconds on steep ground, sand and boulders over the whole route. */
function hazardSeconds(grid: CostGrid, verdict: EvaVerdict, p: RouteParams): number {
  const stats = verdict.stats
  if (!stats) return 0
  return stats.legs.reduce((sum, _, i) => {
    const s = legHazardSeconds(grid, stats.track, i, p)
    return sum + s.steep + s.sand + s.boulders
  }, 0)
}

/** Fastest and safest side by side, like the route alternatives of a road-map app. */
function RouteOptions(props: {
  options: Record<RouteProfile, EvaVerdict>
  profile: RouteProfile
  onProfile: (p: RouteProfile) => void
  grid: CostGrid
  routeParams: RouteParams
}) {
  const { options, profile, onProfile, grid, routeParams } = props
  return (
    <div className="route-options" role="radiogroup" aria-label="Route options">
      {(['fastest', 'safest'] as RouteProfile[]).map((p) => {
        const v = options[p]
        const hazardS = hazardSeconds(grid, v, routeParams)
        const other = options[p === 'fastest' ? 'safest' : 'fastest']
        const deltaS = (v.stats?.totalS ?? 0) - (other.stats?.totalS ?? 0)
        const deltaHazardS = hazardS - hazardSeconds(grid, other, routeParams)
        return (
          <button key={p} type="button" role="radio" aria-checked={profile === p} className="route-option" onClick={() => onProfile(p)}>
            <span className="route-option-name">
              {PROFILE_LABEL[p]}
              <span className={`mini-verdict ${v.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>{v.verdict}</span>
            </span>
            <strong>{v.stats ? formatDuration(v.stats.totalS) : '—'}</strong>
            <span className="route-option-sub">
              {deltaS < 0
                ? `Saves ${formatDuration(-deltaS)} · ${formatDuration(Math.max(0, deltaHazardS))} more on hazards`
                : `${formatDuration(deltaS)} longer · ${formatDuration(Math.max(0, -deltaHazardS))} less on hazards`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Directions(props: Props) {
  const { siteName, dataStatus, grid, routeParams, base, stops, verdict, routing, failedLeg, notice, startLabel, o2DurationS, roverSols } = props
  const { targets, onAddTarget, onRemove, onMove, onClear, onSavePlan, onPrint, selected, onSelect, hoverIndex, onHover } = props
  const { suggestedStart, onStartTime, priorities, onPriority, dwellS } = props
  const { roverAt, onRoverAt, ride, onRide, onFootS, onOptimise, optimising, profile, onProfile, routeOptions, savingS } = props
  const [showReasons, setShowReasons] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  /** insertion position among the stops (0 … stops.length) while a stop is dragged */
  const [dropAt, setDropAt] = useState<number | null>(null)
  const stats = verdict?.stats ?? null
  const arrive = arrivals(verdict)
  const cautions = verdict?.reasons.filter((r) => r.severity !== 'info') ?? []
  const infos = verdict?.reasons.filter((r) => r.severity === 'info') ?? []

  return (
    <aside className="card directions" aria-label="Marswalk directions">
      <header className="card-head">
        <span className="brand-mark">
          <LineMark size={20} />
        </span>
        <div className="brand-text">
          <h1>Martian Map</h1>
          <p>{siteName}</p>
        </div>
        <StatusBadge status={dataStatus} />
      </header>

      {/* One scroll for the whole plan, so the stop list never gets squeezed by the summary above it. */}
      <div className="card-body">
        {stops.length === 0 ? (
          <>
            <section className="empty">
              <h2>Plan a Marswalk</h2>
              <p>Add science targets below, or click any walkable point on the map. Every walk starts and ends at the habitat.</p>
            </section>
            <section className="suggest" aria-labelledby="suggest-h">
              <h3 id="suggest-h">Science targets</h3>
              <ul>
                {targets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="suggest-btn" onClick={() => onAddTarget(t)}>
                      <span className="pin-target" aria-hidden="true" />
                      <div>
                        <strong>
                          {t.name} <StatusBadge status={t.status} />
                        </strong>
                        <span>{t.why}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <section className={`summary ${routing || !verdict ? 'is-busy' : ''}`} aria-live="polite">
            {!verdict || routing ? (
              <p className="summary-line">Planning the route…</p>
            ) : (
              <>
                <div className="summary-top">
                  <span className={`verdict-pill ${verdict.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>{verdict.verdict}</span>
                  {stats && (
                    <div className="summary-figures">
                      <strong>{formatDuration(stats.totalS)}</strong>
                      <span>
                        {formatDistance(stats.distanceM)} · {formatDuration(o2DurationS - stats.totalS)} O₂ left at return
                        {verdict.doseMSv !== null && ` · ${verdict.doseMSv.toFixed(2)} mSv`}
                      </span>
                    </div>
                  )}
                </div>
                {stats && ride && stats.rideS > 0 && (
                  <p className="ride-compare">
                    Rover-assisted: {formatDuration(stats.rideS)} riding, {formatDuration(stats.walkS)} walking.
                    {onFootS !== null &&
                      (onFootS > stats.totalS
                        ? ` On foot the same stops take ${formatDuration(onFootS)}: the rover saves ${formatDuration(onFootS - stats.totalS)} of O₂ and daylight.`
                        : ` On foot the same stops take ${formatDuration(onFootS)}, so riding saves no time here.`)}
                  </p>
                )}
                {stats && roverSols && (
                  <p className="rover-compare">
                    <span className="traverse-key" aria-hidden="true" />
                    {roverSols.sols > 1
                      ? `${roverSols.rover} worked ${roverSols.stopsMatched === 1 ? 'this stop' : `these ${roverSols.stopsMatched} stops`} over sols ${roverSols.first}–${roverSols.last}: ${roverSols.sols} sols (${roverSols.earthDays} Earth days). This crew: one ${formatDuration(stats.totalS)} Marswalk.`
                      : `${roverSols.rover} was at this stop on sol ${roverSols.first}.`}
                  </p>
                )}
                {routeOptions ? (
                  <RouteOptions options={routeOptions} profile={profile} onProfile={onProfile} grid={grid} routeParams={routeParams} />
                ) : (
                  <p className="route-note">
                    Safest route shown. {savingS >= 60 ? `A riskier one saves only ${formatDuration(savingS)}.` : 'It is also the quickest.'}
                  </p>
                )}
                {cautions.length > 0 && (
                  <ul className="reasons">
                    {cautions.map((r) => (
                      <li key={r.code} className={`reason sev-${r.severity}`}>
                        <AlertIcon size={16} />
                        <span>{r.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {suggestedStart && (
                  <p className="start-hint">
                    <span>Starting at {suggestedStart.ltst} Mars local avoids the start-dependent cautions above.</span>
                    <button type="button" className="btn-chip" onClick={() => onStartTime(suggestedStart.time)}>
                      Start at {suggestedStart.ltst}
                    </button>
                  </p>
                )}
                <button type="button" className="text-btn" aria-expanded={showReasons} onClick={() => setShowReasons((v) => !v)}>
                  {showReasons ? 'Hide safety checks' : `Show safety checks (${infos.length} passed)`}
                </button>
                {showReasons && (
                  <ul className="checks">
                    {infos.map((r) => (
                      <li key={r.code}>{r.message}</li>
                    ))}
                  </ul>
                )}
                {stats && stats.track.length > 1 && (
                  <ElevationProfile
                    track={stats.track}
                    hazards={stats.track.map((p) => cellHazard(grid, p.cell, routeParams))}
                    hoverIndex={hoverIndex}
                    onHover={onHover}
                  />
                )}
                <p className="provenance">
                  Walking times and O₂ <StatusBadge status="MODELED" /> on <StatusBadge status={dataStatus} /> terrain
                </p>
              </>
            )}
          </section>
        )}

        {notice && (
          <p className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.kind === 'error' && <AlertIcon size={16} />}
            {notice.text}
          </p>
        )}

        {stops.length > 0 && (
          <div className="plan-tools">
            <label className="rover-select">
              <span>Rover safe haven</span>
              <select value={ride ? 'ride' : roverAt} disabled={ride} onChange={(e) => onRoverAt(e.target.value)}>
                {ride && <option value="ride">Travels with the crew</option>}
                <option value="habitat">At the habitat</option>
                {stops.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    Staged at {i + 1}. {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-chip" disabled={optimising || stops.length < 2} onClick={onOptimise}>
              {optimising ? 'Optimising…' : 'Optimise order'}
            </button>
            <label className="ride-toggle">
              <input type="checkbox" checked={ride} onChange={(e) => onRide(e.target.checked)} />
              <span>
                Ride the rover between stops <StatusBadge status="MODELED" />
                <small>The rover travels with the crew and parks by each stop. Every leg is ridden or walked, whichever is quicker.</small>
              </span>
            </label>
          </div>
        )}

        {stops.length > 0 && (
          <ol
            className="steps"
            aria-label="Stops and legs"
            // The whole list is the drop zone, walk rows included: the landing spot is set by the cursor's height
            // against the middle of each stop row, whatever element is under it.
            onDragOver={(e) => {
              if (dragFrom === null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-stop]')]
              const at = rows.filter((r) => {
                const b = r.getBoundingClientRect()
                return e.clientY > b.top + b.height / 2
              }).length
              if (at !== dropAt) setDropAt(at)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null && dropAt !== null) {
                // Index the stop lands at once it has been lifted out of the list.
                const to = dropAt > dragFrom ? dropAt - 1 : dropAt
                if (to !== dragFrom) onMove(dragFrom, to)
              }
              setDragFrom(null)
              setDropAt(null)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
            }}
          >
            <li className={`stop is-home ${selected === 0 ? 'is-selected' : ''}`}>
              <span className="pin pin-home" aria-hidden="true" />
              <button type="button" className="stop-text" onClick={() => onSelect(0)}>
                <strong>{base.name}</strong>
                <span>Start {startLabel}</span>
              </button>
              <span className="stop-time">T+0:00</span>
            </li>
            {[...stops, base].map((s, i) => {
              const leg = stats?.legs[i]
              const seconds = stats ? legHazardSeconds(grid, stats.track, i, routeParams) : null
              const isHome = i === stops.length
              return [
                <li key={`leg-${i}`} className={`leg ${failedLeg === i ? 'is-blocked' : ''}`}>
                  <span className="leg-line" aria-hidden="true" />
                  <div className="leg-text">
                    {failedLeg === i ? (
                      <span className="leg-blocked">No walkable path for this leg</span>
                    ) : leg ? (
                      <>
                        <span>
                          {leg.rideS > 0 && <>Rover {formatDuration(leg.rideS)} · </>}
                          Walk {formatDuration(leg.walkS)} · {formatDistance(leg.distanceM)}
                        </span>
                        {seconds && (
                          <span className="chips">
                            {HAZARD_CHIPS.filter((h) => seconds[h] >= 30).map((h) => (
                              <span key={h} className="chip">
                                <span className="dot" style={{ background: HAZARD_COLORS[h] }} />
                                {HAZARD_LABELS[h]} {formatDuration(seconds[h])}
                              </span>
                            ))}
                          </span>
                        )}
                      </>
                    ) : (
                      <span>…</span>
                    )}
                  </div>
                </li>,
                <li
                  key={`stop-${i}`}
                  className={[
                    'stop',
                    isHome ? 'is-home' : '',
                    selected === (isHome ? 0 : i + 1) ? 'is-selected' : '',
                    dragFrom === i ? 'is-dragging' : '',
                    !isHome && dropAt === i ? 'drop-before' : '',
                    i === stops.length - 1 && dropAt === stops.length ? 'drop-after' : '',
                  ].join(' ')}
                  data-stop={isHome ? undefined : i}
                  draggable={!isHome}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', s.name)
                    setDragFrom(i)
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDropAt(null)
                  }}
                >
                  {!isHome && (
                    <button
                      type="button"
                      className="grip"
                      data-grip={i}
                      aria-label={`Reorder ${s.name}: drag, or use the arrow keys`}
                      onKeyDown={(e) => {
                        const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null
                        if (to === null || to < 0 || to >= stops.length) return
                        e.preventDefault()
                        onMove(i, to)
                        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-grip="${to}"]`)?.focus())
                      }}
                    >
                      <GripIcon size={16} />
                    </button>
                  )}
                  {isHome ? <span className="pin pin-home" aria-hidden="true" /> : <span className="pin">{i + 1}</span>}
                  <button type="button" className="stop-text" onClick={() => onSelect(isHome ? 0 : i + 1)}>
                    <strong>{s.name}</strong>
                    <span>{isHome ? 'End of walk' : s.kind === 'science' ? `Science stop · ${Math.round((dwellS[i] ?? 0) / 60)} min` : 'Via point'}</span>
                  </button>
                  {!isHome &&
                    (() => {
                      const p = priorityOf(priorities, s.id)
                      return (
                        <button
                          type="button"
                          className={`prio is-${p}`}
                          aria-label={`Priority of ${s.name}: ${p}. Change it`}
                          title={`Priority: ${p}. If the walk runs late, the lowest-priority stops are dropped first. Click to change.`}
                          onClick={() => onPriority(s.id, nextPriority(p))}
                        >
                          <PriorityIcon size={18} level={p === 'high' ? 3 : p === 'medium' ? 2 : 1} />
                        </button>
                      )
                    })()}
                  <span className="stop-time">{arrive[i] !== undefined ? elapsed(arrive[i]) : ''}</span>
                  {!isHome && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s.id)}>
                      <CloseIcon size={16} />
                    </button>
                  )}
                </li>,
              ]
            })}
          </ol>
        )}
      </div>

      {stops.length > 0 && (
        <footer className="card-foot">
          <button type="button" className="btn-secondary" onClick={onSavePlan}>
            Save plan
          </button>
          <button type="button" className="btn-secondary" disabled={!onPrint} onClick={() => onPrint?.()}>
            Print card
          </button>
          <button type="button" className="btn-secondary" onClick={onClear}>
            Clear
          </button>
        </footer>
      )}
    </aside>
  )
}

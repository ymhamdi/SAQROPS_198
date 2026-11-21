import { useEffect, useMemo, useRef } from 'react'
import { HAZARD_COLORS, HAZARD_LABELS, INK, cellHazard, gridOverlayPixels, hazardRuns, type Hazard } from '../map/overlays'
import type { RouteParams } from '../route/cost'
import { cardStations, cropAround, farthestFromSafety, hillshadePixels, marsClockAt, type Crop } from '../stats/card'
import { findSunset } from '../stats/conditions'
import { formatDistance, formatDuration } from '../stats/format'
import { ROVER_WITH_CREW } from '../stats/eva'
import type { EvaParams, EvaVerdict } from '../stats/goNoGo'
import type { RouteStats } from '../stats/stats'
import type { Conditions, CostGrid, ScienceTarget, Waypoint } from '../types'
import { StatusBadge } from '../ui/StatusBadge'
import { ElevationProfile } from './ElevationProfile'
import type { StopRef } from './RunningLate'

interface Props {
  siteName: string
  /** the saved plan's name, if this plan is saved */
  planName: string | null
  planLink: string
  startTime: string
  lonEast: number
  verdict: EvaVerdict
  stats: RouteStats
  stations: Waypoint[]
  targets: ScienceTarget[]
  grid: CostGrid
  routeParams: RouteParams
  /** seconds to the nearest safe haven from every cell */
  walkHome: Float32Array
  /** stop name where the rover is staged; null = at the habitat */
  roverAt: string | null
  params: EvaParams
  conditions: Conditions[]
  /** running late: the stops in the order they are given up (lowest priority first) */
  dropOrder: StopRef[]
  onClose: () => void
}

/** Card map width on paper, px; markers and labels are sized against it. */
const MAP_PX = 452

const tplus = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** Pale hillshade with sand, boulders and no-go tinted in their route colours, as a PNG data URL. */
function useCardMap(grid: CostGrid, crop: Crop, routeParams: RouteParams): string | null {
  return useMemo(() => {
    const shade = hillshadePixels(grid, crop)
    const terrain = gridOverlayPixels(grid, 'terrain', routeParams)
    for (let y = 0; y < crop.rows; y++) {
      for (let x = 0; x < crop.cols; x++) {
        const o = 4 * (y * crop.cols + x)
        const t = 4 * ((crop.row0 + y) * grid.width + crop.col0 + x)
        const a = (terrain[t + 3] / 255) * 0.55
        for (let k = 0; k < 3; k++) shade[o + k] = Math.round(shade[o + k] * (1 - a) + terrain[t + k] * a)
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = crop.cols
    canvas.height = crop.rows
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(new ImageData(shade, crop.cols, crop.rows), 0, 0)
    return canvas.toDataURL('image/png')
  }, [grid, crop, routeParams])
}

/** The Marswalk card: everything the crew needs on one printed sheet, previewed on screen first. */
export function PrintCard(props: Props) {
  const { siteName, planName, planLink, startTime, lonEast, verdict, stats, stations, targets, grid, routeParams, walkHome, roverAt, params, conditions, onClose } = props
  const startMs = Date.parse(startTime)
  const rows = useMemo(() => cardStations(stats, stations, targets, grid, routeParams, roverAt), [stats, stations, targets, grid, routeParams, roverAt])
  const far = useMemo(() => farthestFromSafety(stats.track, walkHome), [stats, walkHome])
  const crop = useMemo(() => cropAround(grid, stats.track.map((p) => p.cell)), [grid, stats])
  const image = useCardMap(grid, crop, routeParams)
  const printButton = useRef<HTMLButtonElement>(null)
  useEffect(() => printButton.current?.focus(), [])

  const k = crop.cols / MAP_PX // viewBox units per paper px
  const xy = (cell: number) => {
    const r = Math.floor(cell / grid.width)
    return [cell - r * grid.width - crop.col0 + 0.5, r - crop.row0 + 0.5]
  }
  const at = (w: { lat: number; lon: number }) => {
    const { latMin, latMax, lonMin, lonMax } = grid.bounds
    return [((w.lon - lonMin) / (lonMax - lonMin)) * grid.width - crop.col0, ((latMax - w.lat) / (latMax - latMin)) * grid.height - crop.row0]
  }
  const runs = hazardRuns(
    grid,
    stats.track.map((p) => p.cell),
    routeParams,
  )
  const scaleM = [50, 100, 200, 500, 1000].filter((m) => m / grid.cellSizeM <= crop.cols * 0.3).pop() ?? 50
  const usedHazards = [...new Set(runs.map((r) => r.hazard))]
  const legendHazards: Hazard[] = (['clear', 'steep', 'sand', 'boulders', 'blocked'] as Hazard[]).filter((h) => h === 'clear' || usedHazards.includes(h))

  const sunset = findSunset(conditions, startMs)
  const endS = stats.totalS
  const o2LeftS = params.o2DurationS - endS
  const weather = conditions.reduce((best, c) => (Math.abs(Date.parse(c.time) - startMs) < Math.abs(Date.parse(best.time) - startMs) ? c : best), conditions[0])
  const cautions = verdict.reasons.filter((r) => r.severity !== 'info')
  const passed = verdict.reasons.filter((r) => r.severity === 'info')
  const startDate = new Date(startMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="print-view" role="dialog" aria-label="Marswalk card">
      <div className="print-toolbar">
        <strong>Marswalk card</strong>
        <span>A4, two sides: map and safety on the front, stop by stop on the back. Print double-sided or save as PDF.</span>
        <button ref={printButton} type="button" className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <article className="sheet">
        <header className="sheet-head">
          <div>
            <p className="sheet-kicker">Marswalk card · {siteName}</p>
            <h1>{planName ?? 'Unsaved plan'}</h1>
            <p className="sheet-start">
              Start <strong>{marsClockAt(startMs, 0, lonEast)} Mars local</strong> ({new Date(startMs).toISOString().slice(11, 16)} UTC, {startDate}) · back{' '}
              <strong>{marsClockAt(startMs, endS, lonEast)}</strong>
            </p>
          </div>
          <div className={`sheet-verdict ${verdict.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>
            {verdict.verdict}
            <StatusBadge status={verdict.status} />
          </div>
        </header>

        <dl className="sheet-figures">
          <div>
            <dt>Marswalk</dt>
            <dd>{formatDuration(endS)}</dd>
            <small>
              {formatDuration(stats.walkS)} walking{stats.rideS > 0 && `, ${formatDuration(stats.rideS)} riding the rover`}, {formatDuration(stats.dwellS)} at stops
            </small>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{formatDistance(stats.distanceM)}</dd>
            <small>
              +{Math.round(stats.ascentM)} m / −{Math.round(stats.descentM)} m, max {stats.maxSlopeDeg.toFixed(0)}°
            </small>
          </div>
          <div>
            <dt>O₂ at return</dt>
            <dd>{formatDuration(Math.max(0, o2LeftS))}</dd>
            <small>reserve {formatDuration(params.o2ReserveS)} included</small>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{sunset !== null ? `${marsClockAt(sunset, 0, lonEast)} local` : '—'}</dd>
            <small>{sunset !== null ? `${formatDuration(Math.max(0, (sunset - startMs) / 1000 - endS))} after return` : 'not in the conditions data'}</small>
          </div>
          <div>
            <dt>Farthest from safety</dt>
            <dd>{far ? formatDuration(far.s) : '—'}</dd>
            <small>{far ? `${formatDuration(far.s * params.walkHomeContingency)} at emergency pace` : ''}</small>
          </div>
          <div>
            <dt>Radiation dose</dt>
            <dd>{verdict.doseMSv !== null ? `${verdict.doseMSv.toFixed(2)} mSv` : '—'}</dd>
            <small>surface background</small>
          </div>
        </dl>

        <section className="sheet-mid">
          <figure className="sheet-map">
            <svg viewBox={`0 0 ${crop.cols} ${crop.rows}`} role="img" aria-label="Route map">
              {image && <image href={image} width={crop.cols} height={crop.rows} />}
              {runs.map((run, i) => (
                <polyline key={`c${i}`} points={run.cells.map((c) => xy(c).join(',')).join(' ')} className="sheet-route-casing" vectorEffect="non-scaling-stroke" />
              ))}
              {runs.map((run, i) => (
                <polyline
                  key={`r${i}`}
                  points={run.cells.map((c) => xy(c).join(',')).join(' ')}
                  stroke={HAZARD_COLORS[run.hazard]}
                  className="sheet-route"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {far &&
                (() => {
                  const [x, y] = xy(far.point.cell)
                  return <circle cx={x} cy={y} r={11 * k} className="sheet-far" vectorEffect="non-scaling-stroke" />
                })()}
              {rows.slice(0, -1).map((row) => {
                const [x, y] = at(row.station)
                const base = row.number === 0
                return (
                  <g key={row.number} transform={`translate(${x} ${y})`}>
                    <circle r={9 * k} className={base ? 'sheet-pin-base' : 'sheet-pin'} />
                    {base ? <circle r={3 * k} fill={INK.white} /> : <text fontSize={11 * k} dy={4 * k}>{row.number}</text>}
                  </g>
                )
              })}
              {roverAt &&
                (() => {
                  const stop = stations.find((s) => s.name === roverAt)
                  if (!stop) return null
                  const [x, y] = at(stop)
                  return (
                    <g transform={`translate(${x + 13 * k} ${y - 13 * k})`}>
                      <rect x={-8 * k} y={-8 * k} width={16 * k} height={16 * k} rx={3 * k} className="sheet-rover" />
                      <text fontSize={10 * k} dy={3.5 * k}>R</text>
                    </g>
                  )
                })()}
              <g transform={`translate(${crop.cols - 18 * k} ${20 * k})`} className="sheet-north">
                <path d={`M0 ${-12 * k} L${6 * k} ${6 * k} L0 ${2 * k} L${-6 * k} ${6 * k} Z`} />
                <text fontSize={10 * k} dy={18 * k}>N</text>
              </g>
              <g transform={`translate(${10 * k} ${crop.rows - 12 * k})`} className="sheet-scale">
                <rect width={scaleM / grid.cellSizeM} height={4 * k} />
                <text fontSize={10 * k} dy={-4 * k}>{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</text>
              </g>
            </svg>
            <figcaption>
              <ul className="sheet-legend">
                {legendHazards.map((h) => (
                  <li key={h}>
                    <span style={{ background: HAZARD_COLORS[h] }} />
                    {h === 'clear' ? 'Route, clear' : HAZARD_LABELS[h]}
                  </li>
                ))}
                <li>
                  <span className="is-ring" />
                  Farthest from safety
                </li>
                {roverAt && (
                  <li>
                    <span className="is-rover">R</span>
                    Rover staged
                  </li>
                )}
              </ul>
              Hillshade and terrain from the elevation grid <StatusBadge status={grid.status} />, north up.
            </figcaption>
          </figure>

          <div className="sheet-safety">
            <h2>Go / no-go checks</h2>
            {cautions.length === 0 && <p className="sheet-none">No warnings.</p>}
            <ul className="sheet-reasons">
              {cautions.map((r) => (
                <li key={r.code} className={`sev-${r.severity}`}>
                  <b>{r.severity === 'no-go' ? 'NO-GO' : 'Caution'}</b> {r.message}
                </li>
              ))}
              {passed.map((r) => (
                <li key={r.code} className="sev-info">
                  <b>OK</b> {r.message}
                </li>
              ))}
            </ul>

            <h2>If something goes wrong</h2>
            <p>
              Walk to the nearest safe haven: the habitat{roverAt === ROVER_WITH_CREW ? ' or the rover, parked near the crew' : roverAt ? ` or the rover at ${roverAt}` : ''}. From anywhere on this route it is at most{' '}
              {far ? formatDuration(far.s) : '—'} at planned pace, {far ? formatDuration(far.s * params.walkHomeContingency) : '—'} at emergency pace. Turn
              back at once on a radiation alert, or if O₂ comes within {formatDuration(params.o2ReserveS)} of the reserve.
              {props.dropOrder.length > 0 && (
                <>
                  {' '}
                  Running late: drop stops in this order, {props.dropOrder.map((s) => `${s.number}. ${s.name} (${s.priority})`).join(', ')}.
                </>
              )}
            </p>

            <h2>
              Weather at the start <StatusBadge status={weather.status} />
            </h2>
            <p>
              {weather.tempC.toFixed(0)} °C · {weather.pressurePa.toFixed(0)} Pa · dust τ {weather.dustTau.toFixed(2)}
            </p>
          </div>
        </section>

        <section className="sheet-profile">
          <ElevationProfile track={stats.track} hazards={stats.track.map((p) => cellHazard(grid, p.cell, routeParams))} hoverIndex={null} onHover={() => {}} />
        </section>

        <footer className="sheet-foot">
          <p>
            Times: T+ on the Marswalk clock, then Mars local true solar time (Mars24, DERIVED). Walking times, O₂ and the crew plan are MODELED; terrain is{' '}
            {grid.status}, weather {weather.status}. Stop by stop on the back.
          </p>
          <p className="sheet-link">Plan link: {planLink}</p>
        </footer>
      </article>

      <article className="sheet">
        <header className="sheet-head is-back">
          <div>
            <p className="sheet-kicker">Marswalk card · back</p>
            <h1>{planName ?? 'Unsaved plan'} · stop by stop</h1>
          </div>
          <div className={`sheet-verdict is-small ${verdict.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>{verdict.verdict}</div>
        </header>

        <table className="sheet-stops">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Station</th>
              <th scope="col">Arrive</th>
              <th scope="col">Leave</th>
              <th scope="col">Then walk</th>
              <th scope="col">Crew</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.number}>
                <td>{row.number === 0 || row.next === null ? 'H' : row.number}</td>
                <td>
                  <strong>{row.station.name}</strong>
                  {row.target && <small>{row.target.why}</small>}
                </td>
                <td>{row.arriveS !== null ? <Clock s={row.arriveS} startMs={startMs} lonEast={lonEast} /> : '—'}</td>
                <td>{row.leaveS !== null ? <Clock s={row.leaveS} startMs={startMs} lonEast={lonEast} /> : '—'}</td>
                <td>
                  {row.next ? (
                    <>
                      {formatDistance(row.next.distanceM)} · {row.next.rideS > 0 && `rover ${formatDuration(row.next.rideS)} + `}{formatDuration(row.next.walkS)}
                      <small>
                        heading {Math.round(row.next.bearingDeg)}° {row.next.compass}, max {row.next.maxSlopeDeg.toFixed(0)}°
                      </small>
                      {row.next.hazards.length > 0 && (
                        <small className="sheet-hazards">{row.next.hazards.map((h) => `${h.label} ${formatDuration(h.s)}`).join(', ')}</small>
                      )}
                    </>
                  ) : (
                    'End of the Marswalk'
                  )}
                </td>
                <td>
                  {row.crew ? (
                    <>
                      <small>
                        <b>EV1</b> {row.crew.ev1}
                      </small>
                      <small>
                        <b>EV2</b> {row.crew.ev2}
                      </small>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="sheet-foot">
          <p>
            Arrive and leave: T+ on the Marswalk clock, then Mars local time. Headings are straight-line bearings to the next station: follow the route on
            the map. Crew tasks are MODELED (instruments alternate between EV1 and EV2; the rover carries tools and stays as safe haven).
          </p>
        </footer>
      </article>
    </div>
  )
}

function Clock({ s, startMs, lonEast }: { s: number; startMs: number; lonEast: number }) {
  return (
    <>
      {tplus(s)}
      <small>{marsClockAt(startMs, s, lonEast)} local</small>
    </>
  )
}


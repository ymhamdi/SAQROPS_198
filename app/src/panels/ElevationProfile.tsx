import { HAZARD_COLORS, HAZARD_LABELS, hazardSpans, type Hazard } from '../map/overlays'
import type { TrackPoint } from '../stats/stats'
import { formatDistance } from '../stats/format'

interface Props {
  track: TrackPoint[]
  /** hazard of each track point's cell; colours the line like the route on the map */
  hazards?: Hazard[]
  hoverIndex: number | null
  onHover: (index: number | null) => void
}

const W = 368
const H = 92
const PAD_Y = 8
/** hazard strip along the bottom: height, and the narrowest a hazard stretch is drawn so short ones stay visible */
const STRIP_H = 5
const STRIP_MIN_W = 2.5

/** Elevation along the walk. Hover shows distance and elevation and marks the spot on the map. */
export function ElevationProfile({ track, hazards, hoverIndex, onHover }: Props) {
  const total = track[track.length - 1].distanceM || 1
  let min = Infinity
  let max = -Infinity
  for (const p of track) {
    min = Math.min(min, p.elevationM)
    max = Math.max(max, p.elevationM)
  }
  const span = Math.max(max - min, 1)
  const x = (d: number) => (d / total) * W
  const y = (e: number) => PAD_Y + (1 - (e - min) / span) * (H - 2 * PAD_Y)

  const step = Math.max(1, Math.floor(track.length / 240))
  const pts = track.filter((_, i) => i % step === 0 || i === track.length - 1)
  const pathOf = (list: TrackPoint[]) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join('')
  const line = pathOf(pts)
  // Coloured spans: every span keeps its ends, with the same thinning inside.
  const spans = hazards && hazards.length === track.length ? hazardSpans(hazards) : null
  const spanPaths = spans?.map((s) => ({
    hazard: s.hazard,
    d: pathOf(track.slice(s.from, s.to + 1).filter((_, i, all) => i % step === 0 || i === all.length - 1)),
  }))
  const present = spans ? (['steep', 'sand', 'boulders', 'blocked'] as Hazard[]).filter((h) => spans.some((s) => s.hazard === h)) : []
  const stops = track.map((p, i) => ({ p, i })).filter(({ p }) => p.departS > p.arriveS)
  const hover = hoverIndex !== null ? track[hoverIndex] : null

  function indexAt(clientX: number, rect: DOMRect): number {
    const d = ((clientX - rect.left) / rect.width) * total
    let lo = 0
    let hi = track.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (track[mid].distanceM < d) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  return (
    <figure className="profile">
      <figcaption>
        <span>Elevation</span>
        <span>
          {hover
            ? `${formatDistance(hover.distanceM)} · ${hover.elevationM.toFixed(0)} m${hazards && hoverIndex !== null && hazards[hoverIndex] ? ` · ${HAZARD_LABELS[hazards[hoverIndex]]}` : ''}`
            : `${min.toFixed(0)} to ${max.toFixed(0)} m`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Elevation profile from ${min.toFixed(0)} to ${max.toFixed(0)} metres over ${formatDistance(total)}`}
        onPointerMove={(e) => onHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => onHover(null)}
      >
        <path d={`${line}L${W},${H}L0,${H}Z`} className="profile-fill" />
        {spanPaths ? (
          spanPaths.map((s, k) => <path key={k} d={s.d} className="profile-line" style={{ stroke: HAZARD_COLORS[s.hazard] }} vectorEffect="non-scaling-stroke" />)
        ) : (
          <path d={line} className="profile-line" vectorEffect="non-scaling-stroke" />
        )}
        {spans
          ?.filter((s) => s.hazard !== 'clear')
          .map((s, k) => {
            const x0 = x(track[s.from].distanceM)
            const w = Math.max(STRIP_MIN_W, x(track[s.to].distanceM) - x0)
            return <rect key={`h${k}`} x={x0 - (w - (x(track[s.to].distanceM) - x0)) / 2} y={H - STRIP_H} width={w} height={STRIP_H} fill={HAZARD_COLORS[s.hazard]} />
          })}
        {stops.map(({ p, i }) => (
          <line key={i} x1={x(p.distanceM)} x2={x(p.distanceM)} y1={0} y2={H} className="profile-stop" vectorEffect="non-scaling-stroke" />
        ))}
        {hover && <line x1={x(hover.distanceM)} x2={x(hover.distanceM)} y1={0} y2={H} className="profile-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="profile-axis" aria-hidden="true">
        <span>0</span>
        {stops.map(({ p }, k) => (
          <span key={k} className="profile-pin" style={{ left: `${(p.distanceM / total) * 100}%` }}>
            {k + 1}
          </span>
        ))}
        <span>{formatDistance(total)}</span>
      </div>
      {present.length > 0 && (
        <ul className="profile-legend" aria-label="Hazards on the route">
          {present.map((h) => (
            <li key={h}>
              <span style={{ background: HAZARD_COLORS[h] }} />
              {HAZARD_LABELS[h]}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

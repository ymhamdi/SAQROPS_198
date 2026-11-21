import type { Segment } from '../stats/eva'
import { formatDuration } from '../stats/format'
import { StatusBadge } from '../ui/StatusBadge'

interface Props {
  /** one actor's segments (walks and stop work), in time order */
  segments: Segment[]
  totalS: number
  selected: number | null
  onSelect: (stop: number) => void
}

const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** The EVA on one bar: walking stretches and numbered stops along the EVA clock. Click a stop for its crew plan. */
export function Timeline({ segments, totalS, selected, onSelect }: Props) {
  const ticks: number[] = []
  for (let t = 0; t <= totalS; t += 1800) ticks.push(t)
  let stop = 0

  return (
    <section className="card timeline" aria-label="Marswalk timeline">
      <header className="timeline-head">
        <h2>Marswalk timeline</h2>
        <span className="timeline-sub">
          {formatDuration(totalS)} from habitat to habitat · click a stop for who does what <StatusBadge status="MODELED" />
        </span>
      </header>
      <div className="tl-bar">
        {segments.map((s, i) => {
          const style = { left: `${(s.startS / totalS) * 100}%`, width: `calc(${((s.endS - s.startS) / totalS) * 100}% - 2px)` }
          if (s.kind !== 'task') {
            return <span key={i} className="tl-seg tl-walk" style={style} title={`${s.label} · ${elapsed(s.startS)}–${elapsed(s.endS)}`} />
          }
          const n = ++stop
          return (
            <button
              key={i}
              type="button"
              className={`tl-seg tl-stop ${selected === n ? 'is-selected' : ''}`}
              style={style}
              title={`Stop ${n} · ${elapsed(s.startS)}–${elapsed(s.endS)}`}
              aria-label={`Stop ${n}, ${elapsed(s.startS)} to ${elapsed(s.endS)}`}
              onClick={() => onSelect(n)}
            >
              {n}
            </button>
          )
        })}
      </div>
      <div className="tl-axis" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / totalS) * 100}%` }}>
            {elapsed(t)}
          </span>
        ))}
      </div>
    </section>
  )
}

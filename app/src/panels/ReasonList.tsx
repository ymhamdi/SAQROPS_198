import type { Reason } from '../stats/verdict'
import { StatusBadge } from '../ui/StatusBadge'

const SOURCE_LABEL: Record<Reason['source'], string> = { rules: 'Règles', ai: 'IA', air: 'Air', route: 'Itinéraire', latch: 'Verrou', drone: 'Drone', hardware: 'Matériel' }

/** The reasons of a verdict, each with where it comes from and how it was obtained (R3). */
export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="pc-reasons">
      {reasons.map((r, i) => (
        <li key={i} className={`is-${r.severity}`}>
          <span className="pc-src">{SOURCE_LABEL[r.source]}</span> {r.message} <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
  )
}

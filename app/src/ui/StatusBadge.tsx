import type { DataStatus } from '../types'

/** Provenance of a value, plus SIMULATED for drills (the storm drill): never presented like a measurement. */
export type BadgeStatus = DataStatus | 'SIMULATED'

const TITLES: Record<BadgeStatus, string> = {
  OBSERVED: 'Direct measurement',
  DERIVED: 'Computed from observations',
  MODELED: 'Based on assumptions',
  MOCK: 'Placeholder, not real data',
  SIMULATED: 'A drill or simulation, not a real event',
}

/** Every value in the UI shows where it comes from (CLAUDE.md §4 Scientific honesty). */
export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`} title={TITLES[status]}>
      {status}
    </span>
  )
}

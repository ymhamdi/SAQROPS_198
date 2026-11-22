import type { DataStatus } from '../types.ts'

/** Trust order, best first (CLAUDE.md §4): a value is only as good as its weakest input. */
// REPLAY (a recording played back, not live) sits below MODELED: it is never better than a live measurement.
const RANK: Record<DataStatus, number> = { OBSERVED: 0, DERIVED: 1, MODELED: 2, REPLAY: 3, SIMULATED: 4, MOCK: 5 }

/** The least trustworthy of the given statuses. */
export function worstStatus(...statuses: DataStatus[]): DataStatus {
  return statuses.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'OBSERVED')
}

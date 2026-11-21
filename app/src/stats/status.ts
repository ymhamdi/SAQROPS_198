import type { DataStatus } from '../types.ts'

/** Trust order, best first (CLAUDE.md §4): a value is only as good as its weakest input. */
const RANK: Record<DataStatus, number> = { OBSERVED: 0, DERIVED: 1, MODELED: 2, SIMULATED: 3, MOCK: 4 }

/** The least trustworthy of the given statuses. */
export function worstStatus(...statuses: DataStatus[]): DataStatus {
  return statuses.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'OBSERVED')
}

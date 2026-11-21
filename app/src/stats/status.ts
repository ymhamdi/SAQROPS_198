import type { DataStatus } from '../types'

const RANK: Record<DataStatus, number> = { OBSERVED: 0, DERIVED: 1, MODELED: 2, MOCK: 3 }

/** The least trustworthy of the given statuses: a value is only as good as its weakest input. */
export function worstStatus(...statuses: DataStatus[]): DataStatus {
  return statuses.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'OBSERVED')
}

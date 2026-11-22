// Shared shapes of PNR. Coordinates on the plan: metres, x eastwards, y southwards, origin at the site's north-west
// corner (the building plus its outdoor margin). Grid cells: row-major, index = row * width + col.

/** How a value was obtained. SIMULATED and MOCK never look like OBSERVED (CLAUDE.md R3, §4). */
export type DataStatus = 'OBSERVED' | 'DERIVED' | 'MODELED' | 'SIMULATED' | 'MOCK'

export const DATA_STATUSES: readonly DataStatus[] = ['OBSERVED', 'DERIVED', 'MODELED', 'SIMULATED', 'MOCK']

/** A number shown to someone, always with how it was obtained. */
export interface Labelled<T = number> {
  value: T
  status: DataStatus
}

/** Cell codes of the site grid. */
export const CELL = {
  FLOOR: 0,
  OUTSIDE: 1,
  OBSTACLE: 2,
  WALL: 3,
  DOOR: 4,
  EXIT: 5,
} as const
export type CellKind = (typeof CELL)[keyof typeof CELL]

export interface Point {
  x: number
  y: number
}

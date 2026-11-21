// A* (one leg) and the reversed-graph Dijkstra walk-home field, 8-connected, on a PreparedGrid.

import { createHeap } from './heap'
import { isPassable, maxWalkingSpeedMs, stepTime, type PreparedGrid } from './cost'

const DR = [-1, -1, -1, 0, 0, 1, 1, 1]
const DC = [-1, 0, 1, -1, 1, -1, 0, 1]
const DIAG = [true, false, true, false, false, true, false, true]

export interface Path {
  /** cell indices from start to goal, inclusive */
  cells: number[]
  timeS: number
}

/**
 * Calls visit(neighbour, distM) for every neighbour of `cell` that can be stepped to.
 * A diagonal step is not allowed to squeeze between two cells when either of them is impassable.
 */
function forEachNeighbour(p: PreparedGrid, cell: number, visit: (n: number, distM: number) => void) {
  const { width, height, cellSizeM } = p.grid
  const r = (cell / width) | 0
  const c = cell - r * width
  for (let k = 0; k < 8; k++) {
    const nr = r + DR[k]
    const nc = c + DC[k]
    if (nr < 0 || nr >= height || nc < 0 || nc >= width) continue
    if (DIAG[k] && (!isPassable(p, nr * width + c) || !isPassable(p, r * width + nc))) continue
    visit(nr * width + nc, DIAG[k] ? cellSizeM * Math.SQRT2 : cellSizeM)
  }
}

/** Fastest walking path between two cells, or null when there is none. */
export function findPath(p: PreparedGrid, start: number, goal: number): Path | null {
  if (!isPassable(p, start) || !isPassable(p, goal)) return null
  if (start === goal) return { cells: [start], timeS: 0 }

  const { width, cellSizeM } = p.grid
  const { g, came, closed } = p.scratch
  g.fill(Infinity)
  came.fill(-1)
  closed.fill(0)

  // Admissible: octile distance at the fastest speed any step can reach, with the smallest multiplier (1).
  const secondsPerCell = cellSizeM / maxWalkingSpeedMs(p.params)
  const goalR = (goal / width) | 0
  const goalC = goal - goalR * width
  const heuristic = (cell: number) => {
    const r = (cell / width) | 0
    const dr = Math.abs(r - goalR)
    const dc = Math.abs(cell - r * width - goalC)
    return (Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc)) * secondsPerCell
  }

  const heap = createHeap()
  g[start] = 0
  heap.push(heuristic(start), start)
  while (heap.size() > 0) {
    const cell = heap.pop()
    if (closed[cell]) continue
    if (cell === goal) return { cells: reconstruct(came, goal), timeS: g[goal] }
    closed[cell] = 1
    forEachNeighbour(p, cell, (n, distM) => {
      if (closed[n]) return
      const t = g[cell] + stepTime(p, cell, n, distM)
      if (t < g[n]) {
        g[n] = t
        came[n] = cell
        heap.push(t + heuristic(n), n)
      }
    })
  }
  return null
}

/**
 * Fastest walking path from `start` to whichever of `goals` is quickest to reach (Dijkstra, stops at the first goal
 * settled), or null when none is reachable. Used to walk back onto a planned route from off it.
 */
export function findPathToAny(p: PreparedGrid, start: number, goals: Iterable<number>): (Path & { goal: number }) | null {
  if (!isPassable(p, start)) return null
  const goalSet = new Set<number>()
  for (const g of goals) if (isPassable(p, g)) goalSet.add(g)
  if (goalSet.size === 0) return null
  if (goalSet.has(start)) return { cells: [start], timeS: 0, goal: start }

  const { g, came, closed } = p.scratch
  g.fill(Infinity)
  came.fill(-1)
  closed.fill(0)
  const heap = createHeap()
  g[start] = 0
  heap.push(0, start)
  while (heap.size() > 0) {
    const cell = heap.pop()
    if (closed[cell]) continue
    if (goalSet.has(cell)) return { cells: reconstruct(came, cell), timeS: g[cell], goal: cell }
    closed[cell] = 1
    forEachNeighbour(p, cell, (n, distM) => {
      if (closed[n]) return
      const t = g[cell] + stepTime(p, cell, n, distM)
      if (t < g[n]) {
        g[n] = t
        came[n] = cell
        heap.push(t, n)
      }
    })
  }
  return null
}

function reconstruct(came: Int32Array, goal: number): number[] {
  const cells = [goal]
  for (let c = came[goal]; c !== -1; c = came[c]) cells.push(c)
  return cells.reverse()
}

/**
 * Seconds to walk from each of `from` to `goal` (Infinity where there is no way): the walk-home search, stopped as
 * soon as every cell asked about is settled, so it stays small when they are near the goal.
 */
export function walkTimesTo(p: PreparedGrid, goal: number, from: number[]): number[] {
  const out = from.map(() => Infinity)
  if (from.length === 0 || !isPassable(p, goal)) return out
  const wanted = new Map<number, number[]>()
  from.forEach((c, i) => wanted.set(c, [...(wanted.get(c) ?? []), i]))
  let left = wanted.size
  const { g, closed } = p.scratch
  g.fill(Infinity)
  closed.fill(0)
  const heap = createHeap()
  g[goal] = 0
  heap.push(0, goal)
  while (heap.size() > 0 && left > 0) {
    const v = heap.pop()
    if (closed[v]) continue
    closed[v] = 1
    const hit = wanted.get(v)
    if (hit) {
      for (const i of hit) out[i] = g[v]
      left--
    }
    forEachNeighbour(p, v, (u, distM) => {
      if (closed[u]) return
      const t = g[v] + stepTime(p, u, v, distM)
      if (t < g[u]) {
        g[u] = t
        heap.push(t, u)
      }
    })
  }
  return out
}

/**
 * Seconds to walk from every cell back to `base` (Infinity where unreachable).
 * One Dijkstra pass from the base over reversed edges: the value at u uses stepTime(u → v), the
 * direction the astronaut actually walks, so uphill/downhill asymmetry is respected.
 */
export function walkHomeField(p: PreparedGrid, base: number): Float32Array {
  const n = p.grid.width * p.grid.height
  const time = new Float32Array(n).fill(Infinity)
  if (!isPassable(p, base)) return time
  const { g, closed } = p.scratch
  g.fill(Infinity)
  closed.fill(0)

  const heap = createHeap()
  g[base] = 0
  heap.push(0, base)
  while (heap.size() > 0) {
    const v = heap.pop()
    if (closed[v]) continue
    closed[v] = 1
    time[v] = g[v]
    forEachNeighbour(p, v, (u, distM) => {
      if (closed[u]) return
      const t = g[v] + stepTime(p, u, v, distM)
      if (t < g[u]) {
        g[u] = t
        heap.push(t, u)
      }
    })
  }
  return time
}

/**
 * The path from `from` down a time-to-goal field made by walkHomeField on the same grid (goal = where the field is 0):
 * at each cell, the neighbour whose step plus remaining time matches the field. Same result as an A* search to the
 * goal, without the search. Null when the field has no way from `from`.
 */
export function pathDown(p: PreparedGrid, field: Float32Array, from: number): Path | null {
  if (!Number.isFinite(field[from])) return null
  const cells = [from]
  let cur = from
  let timeS = 0
  while (field[cur] > 0) {
    let best = -1
    let bestT = Infinity
    let bestStep = 0
    forEachNeighbour(p, cur, (u, distM) => {
      const step = stepTime(p, cur, u, distM)
      if (step + field[u] < bestT) {
        bestT = step + field[u]
        best = u
        bestStep = step
      }
    })
    if (best < 0 || field[best] >= field[cur]) return null // float noise or a broken field: never loop
    cells.push(best)
    timeS += bestStep
    cur = best
  }
  return { cells, timeS }
}

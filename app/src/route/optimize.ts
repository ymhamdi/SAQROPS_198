// Best order to visit the stops: base → every stop once → base, minimising total walking time.
// Walking times are asymmetric (uphill ≠ downhill), so the matrix is directed.

/** matrix[i][j] = seconds from point i to point j; point 0 is the base, 1..n the stops. Infinity = no path. */
export type TimeMatrix = number[][]

/** Total time of base → order → base. */
export function tourTime(matrix: TimeMatrix, order: number[]): number {
  let t = 0
  let at = 0
  for (const next of order) {
    t += matrix[at][next]
    at = next
  }
  return t + matrix[at][0]
}

/**
 * Stop order (indices 1..n into the matrix) with the shortest base → stops → base walk.
 * Exact branch-and-bound up to 9 stops (9! = 362 880 tours at most, pruned); beyond that nearest-neighbour
 * followed by 2-opt improvement. Returns null when no order can visit every stop.
 */
export function bestOrder(matrix: TimeMatrix): number[] | null {
  const n = matrix.length - 1
  if (n <= 0) return []
  if (n > 9) return twoOpt(matrix, nearestNeighbour(matrix))
  let best: number[] | null = null
  let bestT = Infinity
  const used = new Array(n + 1).fill(false)
  const path: number[] = []
  const visit = (at: number, t: number) => {
    if (t >= bestT) return
    if (path.length === n) {
      const total = t + matrix[at][0]
      if (total < bestT) {
        bestT = total
        best = [...path]
      }
      return
    }
    for (let next = 1; next <= n; next++) {
      if (used[next] || !Number.isFinite(matrix[at][next])) continue
      used[next] = true
      path.push(next)
      visit(next, t + matrix[at][next])
      path.pop()
      used[next] = false
    }
  }
  visit(0, 0)
  return best
}

function nearestNeighbour(matrix: TimeMatrix): number[] {
  const n = matrix.length - 1
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1))
  const order: number[] = []
  let at = 0
  while (left.size) {
    let pick = -1
    for (const j of left) if (pick === -1 || matrix[at][j] < matrix[at][pick]) pick = j
    order.push(pick)
    left.delete(pick)
    at = pick
  }
  return order
}

function twoOpt(matrix: TimeMatrix, order: number[]): number[] | null {
  let best = order
  let bestT = tourTime(matrix, best)
  for (let improved = true; improved; ) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const t = tourTime(matrix, cand)
        if (t < bestT) {
          best = cand
          bestT = t
          improved = true
        }
      }
    }
  }
  return Number.isFinite(bestT) ? best : null
}

/** Element-wise minimum of walk-home fields: time to the nearest safe haven from every cell. */
export function nearestHaven(fields: Float32Array[]): Float32Array {
  const out = new Float32Array(fields[0])
  for (const f of fields.slice(1)) for (let i = 0; i < out.length; i++) if (f[i] < out[i]) out[i] = f[i]
  return out
}

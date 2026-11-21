// Time cost of moving across the site: seconds per metre in each cell, from what the detectors say about its room
// (clear, smoke, hot smoke), door procedure, and the danger multipliers (danger/). Walls and equipment are impassable.
// Same interface as Martian Map's cost model, so the A* and the walk-home Dijkstra of search.ts are reused unchanged.

import { H, v } from '../config.ts'
import type { Site } from '../site/site.ts'
import { CELL } from '../types.ts'

/** A grid prepared for the searches: seconds per metre per cell (Infinity = impassable) and reusable scratch buffers. */
export interface PreparedGrid {
  grid: { width: number; height: number; cellSizeM: number }
  /** s/m per cell */
  pace: Float32Array
  /** the smallest finite pace: the A* heuristic's speed bound */
  minPace: number
  scratch: { g: Float64Array; came: Int32Array; closed: Uint8Array }
}

/**
 * Seconds per metre in each room: its progression speed (from the detectors, R5) times its danger multiplier.
 * Index = room index.
 */
export type RoomPace = ArrayLike<number>

/** Door procedure time, spread over the door's cells (a door is one or two cells deep). */
function doorExtraPace(cellM: number): number {
  return v(H.progression.doorPassS) / (2 * cellM)
}

export function prepareGrid(site: Site, roomPace: RoomPace): PreparedGrid {
  const n = site.width * site.height
  const pace = new Float32Array(n)
  const clear = 1 / v(H.progression.clearMs)
  let minPace = Infinity
  for (let i = 0; i < n; i++) {
    const k = site.kind[i]
    let p: number
    if (k === CELL.WALL || k === CELL.OBSTACLE) p = Infinity
    else if (k === CELL.OUTSIDE) p = clear
    else if (k === CELL.DOOR || k === CELL.EXIT) {
      const [a, b] = site.doors[site.door[i]].rooms
      p = Math.max(a >= 0 ? roomPace[a] : clear, b >= 0 ? roomPace[b] : clear) + doorExtraPace(site.cellM)
    } else p = roomPace[site.room[i]]
    pace[i] = p
    if (p < minPace) minPace = p
  }
  return {
    grid: { width: site.width, height: site.height, cellSizeM: site.cellM },
    pace,
    minPace,
    scratch: { g: new Float64Array(n), came: new Int32Array(n), closed: new Uint8Array(n) },
  }
}

export function isPassable(p: PreparedGrid, cell: number): boolean {
  return Number.isFinite(p.pace[cell])
}

/** Seconds to step between neighbouring cells distM apart: half the step in each cell. */
export function stepTime(p: PreparedGrid, from: number, to: number, distM: number): number {
  return (distM * (p.pace[from] + p.pace[to])) / 2
}

/** Fastest possible speed anywhere on the grid, m/s (admissible A* heuristic). */
export function maxSpeedMs(p: PreparedGrid): number {
  return 1 / p.minPace
}

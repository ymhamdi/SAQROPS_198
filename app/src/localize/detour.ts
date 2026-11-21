// Re-planning after a position fix: a path from where the crew really is back onto the planned route, and the walk's
// clock with that detour folded in (walk the detour, then carry on along the plan from the point it rejoins).

import { stepTime, type PreparedGrid } from '../route/cost'
import { cellCenter } from '../route/route'
import { findPathToAny } from '../route/search'
import { positionAt, type Position } from '../stats/eva'
import { sphericalDistanceM, type TrackPoint } from '../stats/stats'
import type { PositionFix } from './getRealPosition'

export interface Detour {
  /** EVA clock when the fix was taken, s */
  atT: number
  /** where the plan had the crew when the fix was taken, and its track index */
  estimate: { lat: number; lon: number }
  estimateIndex: number
  fix: PositionFix
  /** walking path from the fixed position to the route: cells, their centres, and seconds from atT to reach each */
  cells: number[]
  points: { lat: number; lon: number }[]
  times: number[]
  timeS: number
  distanceM: number
  /** track index where the detour meets the plan, and the planned EVA time there */
  rejoinIndex: number
  rejoinPlanS: number
  /** how much later (+) or earlier (−) the rest of the plan now runs, s */
  shiftS: number
}

/** Where the crew is at EVA time t, with any detours folded in. */
export interface WalkState extends Position {
  /** the cell the crew stands in (for walk-home time and aborts) */
  cell: number
  /** true while walking a detour back to the route */
  onDetour: boolean
  /** the detour that applies at t (latest one taken at or before t), or null */
  detour: Detour | null
}

/** The detour that applies at EVA time t: the latest one taken at or before t. */
export function activeDetour(detours: Detour[], t: number): Detour | null {
  let out: Detour | null = null
  for (const d of detours) if (d.atT <= t && (!out || d.atT >= out.atT)) out = d
  return out
}

/** Where the crew is at EVA time t: on the plan, on a detour, or on the plan again after rejoining it. */
export function walkStateAt(track: TrackPoint[], detours: Detour[], t: number): WalkState {
  const d = activeDetour(detours, t)
  if (!d) {
    const pos = positionAt(track, t)
    return { ...pos, cell: track[pos.index].cell, onDetour: false, detour: null }
  }
  const dt = t - d.atT
  if (dt < d.timeS) {
    let k = 0
    while (k + 1 < d.times.length && d.times[k + 1] <= dt) k++
    const a = d.points[k]
    const b = d.points[Math.min(k + 1, d.points.length - 1)]
    const span = (d.times[k + 1] ?? d.times[k]) - d.times[k]
    const f = span > 0 ? (dt - d.times[k]) / span : 0
    return {
      lat: a.lat + f * (b.lat - a.lat),
      lon: a.lon + f * (b.lon - a.lon),
      index: Math.max(0, d.rejoinIndex - 1),
      atStop: false,
      nextStation: track[d.rejoinIndex].leg + 1,
      cell: d.cells[k],
      onDetour: true,
      detour: d,
    }
  }
  const pos = positionAt(track, d.rejoinPlanS + (dt - d.timeS))
  return { ...pos, cell: track[pos.index].cell, onDetour: false, detour: d }
}

/** EVA duration with the detours folded in: the plan's duration, moved by the latest detour's shift. */
export function walkTotalS(plannedTotalS: number, detours: Detour[]): number {
  const last = detours.reduce<Detour | null>((a, d) => (!a || d.atT >= a.atT ? d : a), null)
  return last ? Math.max(last.atT + last.timeS, plannedTotalS + last.shiftS) : plannedTotalS
}

/**
 * Track indices the crew may walk back to from `state`: the rest of the current leg, up to and including the next
 * stop. Never behind them (no walking back over ground already covered) and never past the next stop (no skipping it).
 */
export function rejoinCandidates(track: TrackPoint[], state: WalkState): number[] {
  const last = track.length - 1
  const from = Math.min(state.onDetour && state.detour ? state.detour.rejoinIndex : state.index + 1, last)
  const leg = track[from].leg
  const out: number[] = []
  for (let i = from; i <= last && track[i].leg === leg; i++) out.push(i)
  return out
}

/**
 * The detour from a fixed position back onto the plan, or null when no walkable path reaches the route ahead.
 * `state` is where the crew was (with earlier detours folded in) when the fix was taken at EVA time atT.
 */
export function planDetour(p: PreparedGrid, track: TrackPoint[], state: WalkState, atT: number, fix: Pick<PositionFix, 'cell'> & Partial<PositionFix>): Detour | null {
  const candidates = rejoinCandidates(track, state)
  // A cell can appear once in the track; map it back to its index to know where the plan resumes.
  const indexOfCell = new Map<number, number>()
  for (const i of candidates) if (!indexOfCell.has(track[i].cell)) indexOfCell.set(track[i].cell, i)
  const path = findPathToAny(p, fix.cell, indexOfCell.keys())
  if (!path) return null
  const rejoinIndex = indexOfCell.get(path.goal)!
  const points = path.cells.map((c) => cellCenter(p.grid, c))
  const times = [0]
  let distanceM = 0
  for (let i = 1; i < path.cells.length; i++) {
    const diagonal = Math.abs(path.cells[i] - path.cells[i - 1]) !== 1 && Math.abs(path.cells[i] - path.cells[i - 1]) !== p.grid.width
    times.push(times[i - 1] + stepTime(p, path.cells[i - 1], path.cells[i], diagonal ? p.grid.cellSizeM * Math.SQRT2 : p.grid.cellSizeM))
    distanceM += sphericalDistanceM(points[i - 1], points[i])
  }
  const timeS = times[times.length - 1]
  const rejoinPlanS = track[rejoinIndex].arriveS
  return {
    atT,
    estimate: { lat: state.lat, lon: state.lon },
    estimateIndex: state.index,
    fix: fix as PositionFix,
    cells: path.cells,
    points,
    times,
    timeS,
    distanceM,
    rejoinIndex,
    rejoinPlanS,
    shiftS: atT + timeS - rejoinPlanS,
  }
}

/** Adds a detour taken at EVA time d.atT; detours taken at or after it belonged to a history that no longer happened. */
export function withDetour(detours: Detour[], d: Detour): Detour[] {
  return [...detours.filter((x) => x.atT < d.atT), d]
}

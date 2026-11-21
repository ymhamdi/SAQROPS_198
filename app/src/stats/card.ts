// The printable Marswalk card: one row per station with its times in Mars local, the leg that follows (distance,
// walking time, heading, hazards) and who does what; plus the map crop and the farthest point from safety.

import { HAZARD_LABELS, legHazardSeconds, type Hazard } from '../map/overlays'
import { formatMarsClock, ltstHours, marsTime } from '../marsTime'
import type { RouteParams } from '../route/cost'
import type { CostGrid, ScienceTarget, Waypoint } from '../types'
import { compassPoint, crewAtStop, initialBearingDeg, type CrewTasks } from './eva'
import { safetyS, type RouteStats, type TrackPoint } from './stats'

/** "10:42" Mars local true solar time at the site, `s` seconds after the start. */
export function marsClockAt(startMs: number, s: number, lonEastDeg: number): string {
  return formatMarsClock(ltstHours(marsTime(startMs + s * 1000), lonEastDeg)).slice(0, 5)
}

export interface CardLeg {
  distanceM: number
  walkS: number
  /** riding the rover on this leg, s (rover-assisted plans) */
  rideS: number
  /** straight-line initial bearing to the next station, degrees from north */
  bearingDeg: number
  compass: string
  maxSlopeDeg: number
  /** walking time on each hazard other than bedrock, longest first */
  hazards: { hazard: Hazard; label: string; s: number }[]
}

export interface CardStation {
  /** 0 = habitat at the start, 1..n stops, n+1 = habitat on return */
  number: number
  station: Waypoint
  target: ScienceTarget | null
  /** Marswalk clock, s; null where it does not apply (no arrival at the start, no departure at the end) */
  arriveS: number | null
  leaveS: number | null
  crew: CrewTasks | null
  /** the leg to the next station; null at the end */
  next: CardLeg | null
}

/** Arrival and departure at every station along the track (the last track point of the leg that ends there). */
function stationTimes(track: TrackPoint[], legs: number): { arriveS: number; departS: number }[] {
  const out = Array.from({ length: legs }, () => ({ arriveS: 0, departS: 0 }))
  for (const p of track) out[p.leg] = { arriveS: p.arriveS, departS: p.departS }
  return out
}

export function cardStations(
  stats: RouteStats,
  stations: Waypoint[],
  targets: ScienceTarget[],
  grid: CostGrid,
  params: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>,
  roverStagedAt: string | null,
): CardStation[] {
  const ends = stationTimes(stats.track, stats.legs.length)
  return stations.map((station, k) => {
    const last = k === stations.length - 1
    const leg = stats.legs[k]
    let next: CardLeg | null = null
    if (!last && leg) {
      const secs = legHazardSeconds(grid, stats.track, k, params)
      const bearingDeg = initialBearingDeg(station, stations[k + 1])
      next = {
        distanceM: leg.distanceM,
        walkS: leg.walkS,
        rideS: leg.rideS,
        bearingDeg,
        compass: compassPoint(bearingDeg),
        maxSlopeDeg: leg.maxSlopeDeg,
        hazards: (Object.keys(secs) as Hazard[])
          .filter((h) => h !== 'clear' && secs[h] >= 30)
          .map((h) => ({ hazard: h, label: HAZARD_LABELS[h], s: secs[h] }))
          .sort((a, b) => b.s - a.s),
      }
    }
    const isStop = k > 0 && !last
    return {
      number: k,
      station,
      target: targets.find((t) => t.id === station.id) ?? null,
      arriveS: k === 0 ? null : last ? stats.totalS : ends[k - 1].arriveS,
      leaveS: last ? null : k === 0 ? 0 : ends[k - 1].departS,
      crew: isStop ? crewAtStop(station, targets, roverStagedAt) : null,
      next,
    }
  })
}

/** The point on the walk farthest (in walking time) from the nearest safe haven. */
export function farthestFromSafety(track: TrackPoint[], walkHome: Float32Array): { s: number; point: TrackPoint } | null {
  let best: { s: number; point: TrackPoint } | null = null
  for (const p of track) {
    const s = safetyS(walkHome, p)
    if (Number.isFinite(s) && (!best || s > best.s)) best = { s, point: p }
  }
  return best
}

export interface Crop {
  col0: number
  row0: number
  cols: number
  rows: number
}

/**
 * Grid window around the walk for the card map: every cell the walk touches plus `marginCells`, widened so the short
 * side is at least `minAspect` of the long side, clamped to the grid.
 */
export function cropAround(grid: CostGrid, cells: number[], marginCells = 60, minAspect = 0.6): Crop {
  let c0 = Infinity
  let c1 = -Infinity
  let r0 = Infinity
  let r1 = -Infinity
  for (const cell of cells) {
    const r = Math.floor(cell / grid.width)
    const c = cell - r * grid.width
    c0 = Math.min(c0, c)
    c1 = Math.max(c1, c)
    r0 = Math.min(r0, r)
    r1 = Math.max(r1, r)
  }
  let cols = c1 - c0 + 1 + 2 * marginCells
  let rows = r1 - r0 + 1 + 2 * marginCells
  const wantCols = Math.max(cols, Math.ceil(rows * minAspect))
  const wantRows = Math.max(rows, Math.ceil(cols * minAspect))
  const fit = (start: number, size: number, want: number, max: number) => {
    const s = Math.round(start - (want - size) / 2)
    const n = Math.min(want, max)
    return [Math.max(0, Math.min(s, max - n)), n]
  }
  const [col0, nc] = fit(c0 - marginCells, cols, wantCols, grid.width)
  const [row0, nr] = fit(r0 - marginCells, rows, wantRows, grid.height)
  cols = nc
  rows = nr
  return { col0, row0, cols, rows }
}

/**
 * Light grey hillshade of a grid window from the CostGrid elevation (DERIVED), sun from the north-west at 45°,
 * as RGBA pixels (row 0 = north). Kept pale so the route and hazards print over it.
 */
export function hillshadePixels(grid: CostGrid, crop: Crop): Uint8ClampedArray<ArrayBuffer> {
  const { col0, row0, cols, rows } = crop
  const px = new Uint8ClampedArray(4 * cols * rows)
  const z = (r: number, c: number) =>
    grid.elevation[Math.min(grid.height - 1, Math.max(0, r)) * grid.width + Math.min(grid.width - 1, Math.max(0, c))]
  const az = (315 * Math.PI) / 180
  const alt = (45 * Math.PI) / 180
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const r = row0 + y
      const c = col0 + x
      const dzdx = (z(r, c + 1) - z(r, c - 1)) / (2 * grid.cellSizeM) // east
      const dzdy = (z(r - 1, c) - z(r + 1, c)) / (2 * grid.cellSizeM) // north
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(-dzdx, -dzdy) // direction the slope faces, from north, clockwise
      const shade = Math.max(0, Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect))
      const v = Math.round(150 + 105 * shade)
      px.set([v, v, v, 255], 4 * (y * cols + x))
    }
  }
  return px
}

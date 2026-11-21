// Route statistics: distance, elevation profile, per-leg time, slopes, time per terrain type, timeline.

import { MARS_MEAN_RADIUS_M, SCIENCE_STOP_DWELL_MIN } from '../config'
import { stepTime, type PreparedGrid } from '../route/cost'
import { cellCenter, type Leg } from '../route/route'
import { TERRAIN, type DataStatus, type TerrainClass } from '../types'
import { worstStatus } from './status'

/** One route cell, in walking order. Stop cells shared by two legs appear once. */
export interface TrackPoint {
  cell: number
  lat: number
  lon: number
  /** along-route spherical distance from the start, m */
  distanceM: number
  elevationM: number
  /** EVA clock (walking + dwell) on arrival and on leaving; they differ only at science stops */
  arriveS: number
  departS: number
  leg: number
  /** reached by rover, crew riding (rover-assisted Marswalk) */
  riding?: boolean
  /** rover-assisted Marswalk, on foot: the cell where the rover is parked */
  roverCell?: number
  /** rover-assisted Marswalk: walking seconds to the parked rover (0 riding) */
  toRoverS?: number
  /** rover-assisted Marswalk: radio line of sight to the parked rover (true riding) */
  roverInSight?: boolean
}

/** Planned time at a stop before any extra stay, s: science stops are worked, via points are only walked through. */
export function stopDwellS(stop: { kind: string }): number {
  return stop.kind === 'via' ? 0 : SCIENCE_STOP_DWELL_MIN * 60
}

/**
 * Walking seconds from a track point to the nearest safe haven: `walkHome` (the habitat, or the habitat and a staged
 * rover), or the rover parked near the crew on a rover-assisted Marswalk.
 */
export function safetyS(walkHome: Float32Array, t: TrackPoint): number {
  return Math.min(walkHome[t.cell], t.toRoverS ?? Infinity)
}

export interface LegStats {
  from: number
  to: number
  distanceM: number
  walkS: number
  /** seconds riding the rover on this leg (0 on foot) */
  rideS: number
  ascentM: number
  descentM: number
  maxSlopeDeg: number
}

export interface RouteStats {
  distanceM: number
  walkS: number
  /** riding the rover (rover-assisted Marswalk), s */
  rideS: number
  dwellS: number
  /** walking + riding + dwell = EVA duration */
  totalS: number
  ascentM: number
  descentM: number
  maxSlopeDeg: number
  maxSlopeCell: number
  /** walking time per terrain class; each step's time is split between its two cells */
  timeByTerrainS: Record<TerrainClass, number>
  legs: LegStats[]
  track: TrackPoint[]
  status: { distance: DataStatus; time: DataStatus }
}

/** Great-circle distance on the Mars mean sphere (haversine), m. */
export function sphericalDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Stats for consecutive legs (base → stops → base). dwellS is the time spent at the end of each
 * leg except the last: one number for every stop, or one per stop.
 */
/**
 * Distances, times and the timed track of a route. Steps marked in leg.ride are timed with `drive` (the rover's
 * prepared grid) and count as riding, not walking; without `drive` every step is walked.
 */
export function routeStats(p: PreparedGrid, legs: Leg[], dwellS: number | number[] = SCIENCE_STOP_DWELL_MIN * 60, drive?: PreparedGrid): RouteStats {
  const { grid } = p
  const timeByTerrainS: Record<TerrainClass, number> = {
    [TERRAIN.BEDROCK]: 0,
    [TERRAIN.SAND]: 0,
    [TERRAIN.BOULDERS]: 0,
    [TERRAIN.NO_GO]: 0,
  }
  const track: TrackPoint[] = []
  const legStats: LegStats[] = []
  let elapsed = 0
  let distance = 0
  let dwellTotal = 0
  let rideTotal = 0
  let maxSlopeDeg = -Infinity
  let maxSlopeCell = -1

  const point = (cell: number, leg: number, riding: boolean, l: Leg, k: number) => {
    const { lat, lon } = cellCenter(grid, cell)
    const rover = l.rover?.[k]
    track.push({
      cell, lat, lon, distanceM: distance, elevationM: grid.elevation[cell], arriveS: elapsed, departS: elapsed, leg,
      ...(riding ? { riding } : {}),
      ...(rover !== undefined && rover >= 0 ? { roverCell: rover } : {}),
      ...(l.toRoverS ? { toRoverS: l.toRoverS[k] } : {}),
      ...(l.roverInSight ? { roverInSight: l.roverInSight[k] === 1 } : {}),
    })
    if (!riding && grid.slopeDeg[cell] > maxSlopeDeg) {
      maxSlopeDeg = grid.slopeDeg[cell]
      maxSlopeCell = cell
    }
  }

  legs.forEach((leg, li) => {
    const s: LegStats = { from: leg.from, to: leg.to, distanceM: 0, walkS: 0, rideS: 0, ascentM: 0, descentM: 0, maxSlopeDeg: grid.slopeDeg[leg.cells[0]] }
    if (li === 0) point(leg.cells[0], 0, false, leg, 0)
    for (let k = 1; k < leg.cells.length; k++) {
      const a = leg.cells[k - 1]
      const b = leg.cells[k]
      const diagonal = a % grid.width !== b % grid.width && Math.floor(a / grid.width) !== Math.floor(b / grid.width)
      const riding = drive !== undefined && leg.ride?.[k] === 1
      const t = stepTime(riding ? drive : p, a, b, diagonal ? grid.cellSizeM * Math.SQRT2 : grid.cellSizeM)
      const d = sphericalDistanceM(cellCenter(grid, a), cellCenter(grid, b))
      const dz = grid.elevation[b] - grid.elevation[a]
      if (riding) {
        s.rideS += t
        rideTotal += t
      } else {
        timeByTerrainS[grid.terrainClass[a] as TerrainClass] += t / 2
        timeByTerrainS[grid.terrainClass[b] as TerrainClass] += t / 2
        s.walkS += t
      }
      s.distanceM += d
      if (dz > 0) s.ascentM += dz
      else s.descentM -= dz
      if (!riding) s.maxSlopeDeg = Math.max(s.maxSlopeDeg, grid.slopeDeg[b])
      elapsed += t
      distance += d
      point(b, li, riding, leg, k)
    }
    if (li < legs.length - 1) {
      const dwell = Array.isArray(dwellS) ? (dwellS[li] ?? 0) : dwellS
      track[track.length - 1].departS += dwell
      elapsed += dwell
      dwellTotal += dwell
    }
    legStats.push(s)
  })

  const distanceStatus = worstStatus('DERIVED', grid.status)
  return {
    distanceM: distance,
    walkS: Math.max(0, elapsed - dwellTotal - rideTotal), // float noise can leave -1e-12 on an all-ridden plan
    rideS: rideTotal,
    dwellS: dwellTotal,
    totalS: elapsed,
    ascentM: legStats.reduce((sum, l) => sum + l.ascentM, 0),
    descentM: legStats.reduce((sum, l) => sum + l.descentM, 0),
    maxSlopeDeg,
    maxSlopeCell,
    timeByTerrainS,
    legs: legStats,
    track,
    status: { distance: distanceStatus, time: worstStatus('MODELED', distanceStatus) },
  }
}

// Multi-stop routes (base → stops → base) and lat/lon ↔ cell conversion.

import type { CostGrid } from '../types'
import { maxWalkingSpeedMs, type PreparedGrid } from './cost'
import { findPath, pathDown, walkTimesTo, type Path } from './search'
import { inSight } from './viewshed'

export interface Leg {
  from: number
  to: number
  cells: number[]
  timeS: number
  /** Rover-assisted legs: ride[k] = 1 when the step into cells[k] is driven, not walked (ride[0] unused). */
  ride?: number[]
  /** Rover-assisted legs: rover[k] = the cell where the rover is parked while the crew is on foot at cells[k]; -1 riding. */
  rover?: number[]
  /** Rover-assisted legs: walking seconds from cells[k] to the parked rover (standard walking model; 0 riding). */
  toRoverS?: number[]
  /** Rover-assisted legs: 1 when cells[k] has radio line of sight to the parked rover (1 riding). */
  roverInSight?: number[]
}

export type RouteResult =
  | { ok: true; legs: Leg[]; timeS: number; ride?: RideInfo }
  | { ok: false; failedLeg: number; reason?: string }

/**
 * Adds to rover-assisted legs what the safety checks need about the parked rover at every walked step: the walking
 * time to it on `p` (the standard walking model, as the walk-home field) and radio line of sight to its antenna.
 */
export function annotateRover(p: PreparedGrid, legs: Leg[], antennaHeightM: number, suitHeightM: number): Leg[] {
  const byRover = new Map<number, { leg: number; k: number }[]>()
  legs.forEach((l, li) =>
    l.rover?.forEach((r, k) => {
      if (r >= 0) byRover.set(r, [...(byRover.get(r) ?? []), { leg: li, k }])
    }),
  )
  const out: Leg[] = legs.map((l) => ({
    ...l,
    toRoverS: l.rover?.map((r): number => (r < 0 ? 0 : Infinity)),
    roverInSight: l.rover?.map((r): number => (r < 0 ? 1 : 0)),
  }))
  for (const [rover, at] of byRover) {
    const cells = at.map(({ leg, k }) => legs[leg].cells[k])
    const times = walkTimesTo(p, rover, cells)
    const seen = inSight(p.grid, { cell: rover, heightM: antennaHeightM }, suitHeightM, cells)
    at.forEach(({ leg, k }, i) => {
      out[leg].toRoverS![k] = times[i]
      out[leg].roverInSight![k] = seen[i]
    })
  }
  return out
}

/** Rover-assisted Marswalk summary. */
export interface RideInfo {
  /** every cell where the rover parks during the walk (not the habitat), in order */
  parked: number[]
  /** legs ridden (at least partly) */
  riddenLegs: number
}

/** Walk the stops in the given order (no reordering). Fails on the first leg with no path. */
export function planRoute(p: PreparedGrid, stops: number[]): RouteResult {
  const legs: Leg[] = []
  for (let i = 0; i + 1 < stops.length; i++) {
    const path = findPath(p, stops[i], stops[i + 1])
    if (!path) return { ok: false, failedLeg: i }
    legs.push({ from: stops[i], to: stops[i + 1], cells: path.cells, timeS: path.timeS })
  }
  return { ok: true, legs, timeS: legs.reduce((sum, leg) => sum + leg.timeS, 0) }
}

/** base → each stop in order → base. */
export function planLoop(p: PreparedGrid, base: number, stops: number[]): RouteResult {
  return planRoute(p, [base, ...stops, base])
}

/** Cell containing (lat, lon), or -1 outside the grid. Row 0 = latMax, column 0 = lonMin. */
export function cellAt(grid: CostGrid, lat: number, lon: number): number {
  const { latMin, latMax, lonMin, lonMax } = grid.bounds
  const r = Math.floor(((latMax - lat) / (latMax - latMin)) * grid.height)
  const c = Math.floor(((lon - lonMin) / (lonMax - lonMin)) * grid.width)
  if (r < 0 || r >= grid.height || c < 0 || c >= grid.width) return -1
  return r * grid.width + c
}

export function cellCenter(grid: CostGrid, cell: number): { lat: number; lon: number } {
  const { latMin, latMax, lonMin, lonMax } = grid.bounds
  const r = Math.floor(cell / grid.width)
  const c = cell - r * grid.width
  return {
    lat: latMax - ((r + 0.5) * (latMax - latMin)) / grid.height,
    lon: lonMin + ((c + 0.5) * (lonMax - lonMin)) / grid.width,
  }
}

/**
 * The rover-reachable cell nearest `target` (straight-line), within maxM: where the rover can drop off or pick up the
 * crew. `reach` = the rover's time-to-base field (Infinity where it cannot drive). -1 when none is close enough.
 */
export function nearestRoverCell(drive: PreparedGrid, reach: Float32Array, target: number, maxM: number): number {
  const { width, height, cellSizeM } = drive.grid
  const r0 = (target / width) | 0
  const c0 = target - r0 * width
  const rad = Math.ceil(maxM / cellSizeM)
  let best = -1
  let bestD = Infinity
  for (let r = Math.max(0, r0 - rad); r <= Math.min(height - 1, r0 + rad); r++) {
    for (let c = Math.max(0, c0 - rad); c <= Math.min(width - 1, c0 + rad); c++) {
      const cell = r * width + c
      if (!Number.isFinite(reach[cell])) continue
      const d = Math.hypot(r - r0, c - c0) * cellSizeM
      if (d < bestD && d <= maxM) {
        bestD = d
        best = cell
      }
    }
  }
  return best
}

/**
 * Rover-assisted Marswalk. The rover only moves with the crew aboard (no driving itself), and it parks at the
 * rover-reachable cell nearest each stop it brings them to. For every leg the crew either
 *   - walks straight to the next stop, leaving the rover where it is parked, or
 *   - hops: walks to the rover, drives to the parking spot by the next stop, and walks the last metres in,
 * and the whole sequence of choices is optimised together (dynamic programming over where the rover is parked), so the
 * rover is not left behind on a short walk when it is needed later. A ride must save `boardingS` to be taken. The
 * rover must be back at the habitat at the end. Each leg still runs from one stop to the next; leg.ride marks the
 * driven steps and leg.rover where the rover is parked at every walked step. `stops` = [base, ...stops, base], or, to
 * re-plan the rest of a walk under way, [the crew's stop, ...stops, base] with `roverStart` = where the rover is
 * parked now. The habitat is always the last stop; `reach` is the rover's time-to-habitat field.
 */
export function planRide(
  walk: PreparedGrid,
  drive: PreparedGrid,
  reach: Float32Array,
  stops: number[],
  maxParkM: number,
  boardingS: number,
  roverStart: number = stops[0],
): RouteResult {
  const base = stops[stops.length - 1]
  const paths = new Map<string, Path | null>()
  const path = (p: PreparedGrid, tag: string, a: number, b: number): Path | null => {
    if (a === b) return { cells: [a], timeS: 0 }
    const key = `${tag}${a}:${b}`
    // Drives home read straight off the rover's time-to-habitat field: exact, and no search.
    // The rover's step costs are direction-free (fixed speed, slope penalty from the unsigned slope), so a drive out
    // of the habitat is the drive home reversed.
    if (!paths.has(key)) {
      const out = p === drive && a === base ? pathDown(drive, reach, b) : null
      paths.set(key, p === drive && b === base ? pathDown(drive, reach, a) : out ? { cells: out.cells.reverse(), timeS: out.timeS } : findPath(p, a, b))
    }
    return paths.get(key)!
  }
  const parkNear = stops.map((s, i) => (i === stops.length - 1 ? base : nearestRoverCell(drive, reach, s, maxParkM)))
  // Admissible lower bound on a path's time (octile distance at top speed), as in the A* heuristic: lets the planner
  // skip searching hops that cannot beat one already found.
  const { width, cellSizeM } = walk.grid
  const minTimeS = (p: PreparedGrid, a: number, b: number) => {
    const dr = Math.abs(((a / width) | 0) - ((b / width) | 0))
    const dc = Math.abs((a % width) - (b % width))
    return ((Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc)) * cellSizeM) / maxWalkingSpeedMs(p.params)
  }

  interface State {
    cost: number
    legs: Leg[]
  }
  let states = new Map<number, State>([[roverStart, { cost: 0, legs: [] }]])
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    const last = i + 2 === stops.length
    const parkB = parkNear[i + 1]
    let direct: Path | null | undefined // searched only if some state may walk this leg
    const next = new Map<number, State>()
    const relax = (rover: number, cost: number, legs: Leg[]) => {
      const old = next.get(rover)
      if (!old || cost < old.cost) next.set(rover, { cost, legs })
    }
    const byCost = [...states].sort((x, y) => x[1].cost - y[1].cost)
    for (const [at, st] of byCost) {
      // Walk, the rover stays parked. Not on the way home: the rover has to come back too.
      if (!(last && at !== base) && (direct ??= path(walk, 'w', a, b))) {
        const n = direct.cells.length
        relax(at, st.cost + direct.timeS, [
          ...st.legs,
          { from: a, to: b, cells: direct.cells, timeS: direct.timeS, ride: new Array<number>(n).fill(0), rover: new Array<number>(n).fill(at) },
        ])
      }
      // Hop: walk to the rover, drive to the parking spot by the next stop, walk in.
      if (parkB < 0 || parkB === at) continue
      const bound = st.cost + minTimeS(walk, a, at) + minTimeS(drive, at, parkB) + minTimeS(walk, parkB, b) + boardingS
      if ((next.get(parkB)?.cost ?? Infinity) <= bound) continue
      const toRover = path(walk, 'w', a, at)
      const ride = toRover && path(drive, 'd', at, parkB)
      const walkIn = ride && path(walk, 'w', parkB, b)
      if (!toRover || !ride || !walkIn) continue
      const timeS = toRover.timeS + ride.timeS + walkIn.timeS
      const nr = ride.cells.length - 1
      const ni = walkIn.cells.length - 1
      relax(parkB, st.cost + timeS + boardingS, [
        ...st.legs,
        {
          from: a,
          to: b,
          cells: [...toRover.cells, ...ride.cells.slice(1), ...walkIn.cells.slice(1)],
          timeS,
          ride: [...new Array<number>(toRover.cells.length).fill(0), ...new Array<number>(nr).fill(1), ...new Array<number>(ni).fill(0)],
          rover: [...new Array<number>(toRover.cells.length).fill(at), ...new Array<number>(nr).fill(-1), ...new Array<number>(ni).fill(parkB)],
        },
      ])
    }
    if (next.size === 0) return { ok: false, failedLeg: i }
    states = next
  }
  const end = states.get(base)
  if (!end) return { ok: false, failedLeg: stops.length - 2, reason: 'the rover cannot drive back to the habitat' }
  const legs = end.legs
  return { ok: true, legs, timeS: legs.reduce((sum, l) => sum + l.timeS, 0), ride: rideInfo(legs, base) }
}

/** Where the rover parks (not the habitat), in order, and how many legs are ridden, from rover-assisted legs. */
export function rideInfo(legs: Leg[], base: number): RideInfo {
  const parked: number[] = []
  for (const l of legs) for (const c of l.rover ?? []) if (c >= 0 && c !== base && c !== parked[parked.length - 1]) parked.push(c)
  return { parked, riddenLegs: legs.filter((l) => l.ride?.some((x) => x === 1)).length }
}

/** Where the rover is parked while the crew is at the end of `leg` (the stop itself when it drove them onto it). */
export function roverAtLegEnd(leg: Leg): number | undefined {
  const r = leg.rover?.[leg.rover.length - 1]
  return r === undefined ? undefined : r >= 0 ? r : leg.cells[leg.cells.length - 1]
}

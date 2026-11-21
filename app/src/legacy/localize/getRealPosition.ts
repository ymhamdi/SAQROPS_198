// "Where am I really?" — a SIMULATED position fix for the demo.
//
// A real system would localize the crew's support rover by matching a 360° stereo view of its surroundings to the
// orbital map (as NASA's Mars Global Localization does for Perseverance). This app has no rover cameras, so
// getRealPosition() fakes the answer: it takes where the plan says the crew is and moves it by a random drift onto
// walkable ground. Everything downstream (re-planning back to the route, the tablet display) uses only its result, so
// a real localization system can replace the body of this function without other changes.

import { MARS_MEAN_RADIUS_M, SIMULATED_FIX_ACCURACY_M, SIMULATED_FIX_DELAY_MS, SIMULATED_FIX_OFFSET_M } from '../config'
import { isPassable, type PreparedGrid } from '../route/cost'
import { cellAt, cellCenter } from '../route/route'
import { initialBearingDeg } from '../stats/eva'
import { sphericalDistanceM } from '../stats/stats'
import type { DataStatus } from '../types'

export interface PositionFix {
  /** where the fix puts the crew (a cell centre on walkable ground) */
  lat: number
  lon: number
  cell: number
  /** how far, and in which direction, the fix is from where the plan had the crew */
  offsetM: number
  bearingDeg: number
  /** stated accuracy of the fix, m */
  accuracyM: number
  source: string
  /** always MOCK here: no measurement is made */
  status: DataStatus
}

export interface GetRealPositionInput {
  prepared: PreparedGrid
  /** where the plan says the crew is right now */
  estimate: { lat: number; lon: number }
  /** extra test a candidate cell must pass (e.g. "a way back to the route exists"); default: any walkable cell */
  accept?: (cell: number) => boolean
  /** random source in [0, 1), injectable for repeatable tests; default Math.random */
  random?: () => number
  /** simulated computing time, ms; default SIMULATED_FIX_DELAY_MS */
  delayMs?: number
  /** drift range, m; default SIMULATED_FIX_OFFSET_M */
  offsetM?: readonly [number, number]
  /**
   * Direction the crew is walking, degrees from north. When given, the simulated drift goes sideways (left or right
   * of it, ±30°) so the fix lands visibly off the route; when omitted, the drift direction is uniform.
   */
  headingDeg?: number
}

const SOURCE =
  'SIMULATED position fix (demo): the planned position moved by a random drift onto walkable ground. Stand-in for a ' +
  'rover localization system that would match a 360° stereo view to the HiRISE map; no real measurement.'
const MAX_TRIES = 60

/** The point `distanceM` from `from` along `bearingDeg` (local flat approximation; fine over tens of metres). */
export function offsetPoint(from: { lat: number; lon: number }, distanceM: number, bearingDeg: number): { lat: number; lon: number } {
  const rad = Math.PI / 180
  const north = distanceM * Math.cos(bearingDeg * rad)
  const east = distanceM * Math.sin(bearingDeg * rad)
  return {
    lat: from.lat + (north / MARS_MEAN_RADIUS_M) / rad,
    lon: from.lon + (east / (MARS_MEAN_RADIUS_M * Math.cos(from.lat * rad))) / rad,
  }
}

/** Synchronous core of getRealPosition (no delay). Null only when no acceptable cell is found anywhere nearby. */
export function simulateFix(input: Omit<GetRealPositionInput, 'delayMs'>): PositionFix | null {
  const { prepared, estimate, accept = () => true, random = Math.random, offsetM = SIMULATED_FIX_OFFSET_M, headingDeg } = input
  const driftBearing = () =>
    headingDeg === undefined ? random() * 360 : headingDeg + (random() < 0.5 ? -90 : 90) + (random() - 0.5) * 60
  const grid = prepared.grid
  const ok = (cell: number) => cell >= 0 && isPassable(prepared, cell) && accept(cell)
  const fix = (cell: number): PositionFix => {
    const c = cellCenter(grid, cell)
    return {
      lat: c.lat,
      lon: c.lon,
      cell,
      offsetM: sphericalDistanceM(estimate, c),
      bearingDeg: initialBearingDeg(estimate, c),
      accuracyM: SIMULATED_FIX_ACCURACY_M,
      source: SOURCE,
      status: 'MOCK',
    }
  }
  const [lo, hi] = offsetM
  for (let i = 0; i < MAX_TRIES; i++) {
    const p = offsetPoint(estimate, lo + random() * (hi - lo), driftBearing())
    const cell = cellAt(grid, p.lat, p.lon)
    if (ok(cell)) return fix(cell)
  }
  // Boxed in by no-go ground: fall back to the planned cell itself (zero drift), if acceptable.
  const here = cellAt(grid, estimate.lat, estimate.lon)
  return ok(here) ? fix(here) : null
}

/**
 * Returns the crew's "real" position. SIMULATED: see the note at the top of this file.
 * Rejects when no acceptable position is found.
 */
export async function getRealPosition(input: GetRealPositionInput): Promise<PositionFix> {
  const delayMs = input.delayMs ?? SIMULATED_FIX_DELAY_MS
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  const fix = simulateFix(input)
  if (!fix) throw new Error('No walkable position with a way back to the route was found near the crew.')
  return fix
}

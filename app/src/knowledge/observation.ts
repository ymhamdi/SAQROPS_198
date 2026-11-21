// What the indoor drone reports. R10: every observation carries the time it was taken, a position, a confidence and a
// source; it ages (its confidence halves every knowledge.confidenceHalfLifeS) and, once below knowledge.confidenceExpiry,
// it no longer counts and its room is UNKNOWN again. R9: an observation can only make things worse (knowledge/known.ts).

import { H, v } from '../config.ts'
import type { DataStatus, Point } from '../types.ts'

export type ObservationKind =
  /** the temperature the drone read in a room it flew through */
  | 'room-thermal'
  /** a door seen open or closed (the drone never opens one) */
  | 'door-state'
  /** a passage blocked by something the plan does not show */
  | 'obstacle'
  /** a room the drone could see into but did not enter: above its temperature limit */
  | 'too-hot'

export interface Observation {
  id: string
  kind: ObservationKind
  /** simulated time the picture was taken, s */
  takenAtS: number
  /** simulated time it reached PNR: later than takenAtS inside a radio dead zone (the link comes back when the drone leaves it) */
  receivedAtS: number
  /** where the drone was, site metres */
  at: Point
  room: number | null
  door: number | null
  /** cells made impassable (kind 'obstacle') */
  cells: number[]
  /** temperature read, °C (room-thermal and too-hot) */
  valueC: number | null
  /** door state seen (door-state) */
  open: boolean | null
  /** at the time it was taken, 0..1 */
  confidence: number
  source: 'drone-indoor'
  /** what it is shown as: a SIMULATED sensor in the demo */
  status: DataStatus
  /** French, for the interface */
  label: string
}

/** Confidence now: halved every half-life since the picture was taken. */
export function confidenceAt(o: Observation, tS: number): number {
  const ageS = Math.max(0, tS - o.takenAtS)
  return o.confidence * Math.pow(0.5, ageS / v(H.knowledge.confidenceHalfLifeS))
}

/** Too old to count: the room it was about is UNKNOWN again. */
export function isExpired(o: Observation, tS: number): boolean {
  return confidenceAt(o, tS) < v(H.knowledge.confidenceExpiry)
}

/** The observations that have reached PNR by tS (the others are still in the dead zone). */
export function receivedBy(os: readonly Observation[], tS: number): Observation[] {
  return os.filter((o) => o.receivedAtS <= tS)
}

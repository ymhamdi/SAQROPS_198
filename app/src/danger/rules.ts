// What the detectors say about each room (R5: only the readings, never the simulator's truth): its condition, the
// progression speed it allows, and the rule-based reasons. Rule thresholds live in data/config.json.

import { H, v } from '../config.ts'
import type { RoomStats } from '../ml/features.ts'
import type { DataStatus } from '../types.ts'

export type RoomCondition = 'clear' | 'smoke' | 'hot' | 'failed'

export interface RoomObservation {
  room: number
  condition: RoomCondition
  /** room signal now, °C (NaN when every detector has failed) */
  tLastC: number
  fracFailed: number
  /** the readings' status: SIMULATED in the demo, OBSERVED with real detectors */
  status: DataStatus
}

/** A room's condition from its detector statistics only. */
export function observeRoom(room: number, stats: RoomStats, readingsStatus: DataStatus): RoomObservation {
  const ambient = v(H.fire.ambientC)
  let condition: RoomCondition = 'clear'
  if (stats.fracFailed >= 1) condition = 'failed'
  else if (stats.fracFailed > 0 || stats.tLast >= v(H.progression.hotC)) condition = 'hot'
  else if (stats.tLast >= ambient + v(H.progression.smokeAboveAmbientC)) condition = 'smoke'
  return { room, condition, tLastC: stats.tLast, fracFailed: stats.fracFailed, status: readingsStatus }
}

/** Seconds per metre allowed by a room's condition (MODELED speeds). */
export function paceOf(condition: RoomCondition): number {
  const ms = condition === 'clear' ? v(H.progression.clearMs) : condition === 'smoke' ? v(H.progression.smokeMs) : v(H.progression.hotMs)
  return 1 / ms
}

/** Route-cost multiplier the rules put on a room (a failed room is avoided but stays crossable to get out). */
export function ruleMultiplier(condition: RoomCondition): number {
  return condition === 'failed' ? v(H.danger.failedRoomCostMultiplier) : 1
}

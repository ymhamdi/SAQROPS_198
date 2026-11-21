// « Ce que PNR sait » : the plan (documented), the detectors (measured), the indoor drone (observed), the AI (estimated)
// and what nobody has seen (UNKNOWN), each with where it comes from and how fresh it is.
//
// R9: a drone observation can only make things worse, like the AI (R1). It never makes a room « safe »: the cost it puts
// on a room is never below what the detectors and the AI alone give (a multiplier of at least 1), a room nobody has
// observed since the drone flew stays UNKNOWN with an uncertainty cost (never free), and a missing observation proves
// nothing. Before the drone has flown, the layer is off and everything is as it was.
// R10: observations age; once expired a room is UNKNOWN again.

import { H, v } from '../config.ts'
import { verdictOf, type Reason, type Verdict } from '../stats/verdict.ts'
import { worstStatus } from '../stats/status.ts'
import type { DataStatus } from '../types.ts'
import { confidenceAt, isExpired, type Observation } from './observation.ts'

export interface KnownRoom {
  /** nobody has observed it since the drone flew (or its observation has expired) */
  unknown: boolean
  /** seen above the drone's temperature limit, from a doorway */
  tooHot: boolean
  /** the drone's last reading, °C */
  observedC: number | null
  takenAtS: number | null
  receivedAtS: number | null
  /** confidence now, after ageing */
  confidence: number
  /** multiplier on the room's route cost on top of the detectors' and the AI's: always ≥ 1 (R9) */
  extraCost: number
  /** the weakest label among what this room's picture rests on */
  status: DataStatus
}

export interface KnownDoor {
  door: number
  open: boolean
  takenAtS: number
  confidence: number
}

export interface Known {
  /** the drone has flown: UNKNOWN rooms carry their uncertainty cost */
  active: boolean
  rooms: KnownRoom[]
  /** passages the drone found blocked and whose observation has not expired */
  blockedCells: number[]
  doors: KnownDoor[]
}

const UNOBSERVED: KnownRoom = { unknown: false, tooHot: false, observedC: null, takenAtS: null, receivedAtS: null, confidence: 0, extraCost: 1, status: 'MODELED' }

/** Everything known at tS from the observations that have reached PNR. `roomCount` = number of rooms of the site. */
export function mergeKnowledge(roomCount: number, active: boolean, observations: readonly Observation[], tS: number): Known {
  if (!active) return { active: false, rooms: Array.from({ length: roomCount }, () => ({ ...UNOBSERVED })), blockedCells: [], doors: [] }
  const live = observations.filter((o) => o.receivedAtS <= tS && !isExpired(o, tS))
  const latest = (room: number) => live.filter((o) => (o.kind === 'room-thermal' || o.kind === 'too-hot') && o.room === room).sort((a, b) => b.takenAtS - a.takenAtS)[0]
  const rooms: KnownRoom[] = Array.from({ length: roomCount }, (_, r) => {
    const o = latest(r)
    if (!o) return { ...UNOBSERVED, unknown: true, extraCost: v(H.knowledge.unknownCostMultiplier) }
    const tooHot = o.kind === 'too-hot'
    const hot = tooHot || (o.valueC !== null && o.valueC >= v(H.progression.hotC))
    // Never below 1: a calm picture sends the room back to what the detectors and the AI say, no further (R9).
    const extraCost = Math.max(1, tooHot ? v(H.knowledge.tooHotCostMultiplier) : hot ? v(H.knowledge.observedHotCostMultiplier) : 1)
    return { unknown: false, tooHot, observedC: o.valueC, takenAtS: o.takenAtS, receivedAtS: o.receivedAtS, confidence: confidenceAt(o, tS), extraCost, status: worstStatus('MODELED', o.status) }
  })
  const doors: KnownDoor[] = live
    .filter((o) => o.kind === 'door-state' && o.door !== null && o.open !== null)
    .map((o) => ({ door: o.door!, open: o.open!, takenAtS: o.takenAtS, confidence: confidenceAt(o, tS) }))
  const blockedCells = [...new Set(live.filter((o) => o.kind === 'obstacle').flatMap((o) => o.cells))]
  return { active: true, rooms, blockedCells, doors }
}

/** R9, as R1 is for the AI: the drone's reasons are added to the verdict, and nothing it says can improve it. */
export function mergeKnown(base: Verdict, extra: Reason[]): Verdict {
  const merged = verdictOf([...base.reasons, ...extra.map((r) => ({ ...r, source: 'drone' as const }))])
  if (base.verdict === 'NO-GO' && merged.verdict !== 'NO-GO') throw new Error('mergeKnown: R9 violated')
  return merged
}

/**
 * Reasons from the drone's picture, for the rooms on the plan. They only add to the rules' and the AI's (R9): a room the
 * drone saw too hot or hot, or nobody has seen, is a caution; none of them can remove or soften another reason.
 */
export function knownReasons(known: Known, involved: Set<number>, roomName: (r: number) => string): Reason[] {
  if (!known.active) return []
  const out: Reason[] = []
  for (const r of involved) {
    const k = known.rooms[r]
    if (!k) continue
    if (k.tooHot) out.push({ code: 'DRONE_HOT', severity: 'caution', message: `${roomName(r)} : trop chaud pour le drone (${Math.round(k.observedC ?? 0)} °C)`, source: 'drone', status: k.status, room: r })
    else if (k.unknown) out.push({ code: 'ROOM_UNKNOWN', severity: 'caution', message: `${roomName(r)} : INCONNU, aucune observation récente`, source: 'drone', status: 'MODELED', room: r })
    else if (k.extraCost > 1) out.push({ code: 'DRONE_HOT', severity: 'caution', message: `${roomName(r)} : ${Math.round(k.observedC ?? 0)} °C relevés par le drone`, source: 'drone', status: k.status, room: r })
  }
  return out
}

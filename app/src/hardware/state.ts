// What the hardware has told the simulation, and what it makes of the verdict. R13: hardware can only AGGRAVATE.
//
//  - A critical room, once marked, stays marked: a reading that falls back, a packet that never comes, a missing sensor never
//    mark it safe. Only the COS, by re-engaging, clears it (R6).
//  - A mayday, once raised, stays up until the COS clears it.
//  - The live air pressure can only make the PNR worse: the air used is the WORSE of the model's and the cylinder's, never
//    the better of the two.
// Pure functions with .ts imports: the simulation worker runs them.

import type { TrackPoint } from '../stats/air.ts'
import { worstStatus } from '../stats/status.ts'
import { verdictOf, type Reason, type Verdict } from '../stats/verdict.ts'
import type { HardwareEvent, HwStatus } from './ingest.ts'

export interface CriticalRoom {
  /** the room of the site, or null when the firmware named one the site does not know */
  room: number | null
  roomName: string
  /** the highest reading seen, °C */
  valueC: number
  thresholdC: number
  /** simulated time it was first marked */
  atS: number
  status: HwStatus
}

export interface HardwareState {
  critical: CriticalRoom[]
  mayday: { atS: number; status: HwStatus } | null
  /** the latest air pressure read on the cylinder, bar */
  ari: { bar: number; status: HwStatus } | null
}

export const initialHardware = (): HardwareState => ({ critical: [], mayday: null, ari: null })

/**
 * The state after an event. A critical room is added or its reading raised, never lowered; a mayday is set once; the air
 * reading is replaced by the latest. There is no event that removes anything.
 */
export function applyHardwareEvent(h: HardwareState, ev: HardwareEvent, atS: number): HardwareState {
  if (ev.kind === 'critical-room') {
    const same = (c: CriticalRoom) => (ev.room !== null ? c.room === ev.room : c.room === null && c.roomName === ev.roomName)
    const known = h.critical.find(same)
    const critical = known
      ? h.critical.map((c) => (c === known ? { ...c, valueC: Math.max(c.valueC, ev.valueC), thresholdC: Math.min(c.thresholdC, ev.thresholdC), status: worstStatus(c.status, ev.status) as HwStatus } : c))
      : [...h.critical, { room: ev.room, roomName: ev.roomName, valueC: ev.valueC, thresholdC: ev.thresholdC, atS, status: ev.status }]
    return { ...h, critical }
  }
  if (ev.kind === 'mayday') return h.mayday ? h : { ...h, mayday: { atS, status: ev.status } }
  return { ...h, ari: { bar: ev.bar, status: ev.status } }
}

/** The COS's decision (re-engage): the dangers the hardware raised are cleared. The air reading stays: it is still the cylinder. */
export function clearHardware(h: HardwareState): HardwareState {
  return { ...h, critical: [], mayday: null }
}

/** The reasons the hardware adds to the verdict: all NO-GO, none removable. The wording is fixed by the specification. */
export function hardwareReasons(h: HardwareState, roomName: (r: number) => string): Reason[] {
  const out: Reason[] = h.critical.map((c) => ({
    code: 'HARDWARE_HOT' as const,
    severity: 'no-go' as const,
    message: `Chaleur anormale relevée par la charge utile — ${c.room !== null ? roomName(c.room) : c.roomName}`,
    source: 'hardware' as const,
    status: c.status,
    ...(c.room !== null ? { room: c.room } : {}),
  }))
  if (h.mayday) {
    out.push({ code: 'HARDWARE_MAYDAY', severity: 'no-go', message: 'ALERTE MAYDAY matérielle déclenchée par le chef de binôme', source: 'hardware', status: h.mayday.status })
  }
  return out
}

/** As R1 for the AI and R9 for the drone: the hardware's reasons are added, and none of them can improve the verdict. */
export function mergeHardware(base: Verdict, extra: Reason[]): Verdict {
  const merged = verdictOf([...base.reasons, ...extra])
  if (base.verdict === 'NO-GO' && merged.verdict !== 'NO-GO') throw new Error('mergeHardware: R13 violated')
  return merged
}

/**
 * Litres of air the cylinder says the team has used beyond what the model says: never negative. A cylinder that reads
 * fuller than the model is ignored (the model holds): the live pressure can only make the PNR worse.
 */
export function ariExtraUsedL(h: HardwareState, air: { startBar: number; cylinderL: number }, modelUsedL: number): number {
  if (!h.ari) return 0
  return Math.max(0, (air.startBar - h.ari.bar) * air.cylinderL - modelUsedL)
}

/** The plan with every point's air used raised by extraL (the live pressure), for the point-of-no-return check. */
export function shiftTrack(track: TrackPoint[], extraL: number): TrackPoint[] {
  return extraL > 0 ? track.map((p) => ({ ...p, airArriveL: p.airArriveL + extraL, airUsedL: p.airUsedL + extraL })) : track
}

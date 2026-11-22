// The digital twin's memory and small helpers. The twin only displays what the PC broadcasts: a rolling record of the
// snapshots for the curves, which room to follow, and the verdict the system would give without the AI (R1 made
// visible). Nothing here feeds the verdict (R5).

import type { RoomView, Snapshot } from '../sim/protocol'
import { verdictOf, type Verdict } from '../stats/verdict'

/** Longest record kept (samples), so a long session cannot grow without bound. */
const MAX_SAMPLES = 4000

export interface RoomSample {
  /** hot-layer temperature of the simulated fire, °C: SIMULATED truth, shown for comparison only */
  truthC: number
  /** what the room's detectors report, °C; null once every one of them has failed */
  sensorC: number | null
  p30: number | null
  p60: number | null
  tffS: number | null
}

export interface TwinSample {
  t: number
  rooms: RoomSample[]
  bar: number
  exitBar: number | null
  /** the verdict the system computed (rules + AI), before the latch */
  noGo: boolean
  /** the verdict it would have computed without the AI */
  noGoWithoutAi: boolean
  droneBatteryPct: number | null
}

/** The verdict of the rules, the air and the route alone: every reason that does not come from the AI. */
export function withoutAi(v: Verdict): Verdict {
  return verdictOf(v.reasons.filter((r) => r.source !== 'ai'))
}

/** True when the AI turned a GO into a NO-GO. The reverse can never happen (R1). */
export function aiWorsened(s: Snapshot): boolean {
  return s.computed.verdict === 'NO-GO' && withoutAi(s.computed).verdict === 'GO'
}

export function sampleOf(s: Snapshot): TwinSample {
  return {
    t: s.t,
    rooms: s.rooms.map((r) => ({
      truthC: r.truth.layerC,
      sensorC: Number.isFinite(r.tLastC) ? r.tLastC : null,
      p30: r.pred?.p30 ?? null,
      p60: r.pred?.p60 ?? null,
      tffS: r.pred?.tffS ?? null,
    })),
    bar: s.team.bar,
    exitBar: s.team.exitBar,
    noGo: s.computed.verdict === 'NO-GO',
    noGoWithoutAi: withoutAi(s.computed).verdict === 'NO-GO',
    droneBatteryPct: s.drone.at?.batteryPct ?? null,
  }
}

/**
 * Appends the snapshot to the record. A snapshot older than the last one means the PC was reset: start over. One at the
 * same instant (an action taken while paused) replaces the last sample.
 */
export function pushSample(history: readonly TwinSample[], s: Snapshot): TwinSample[] {
  const sample = sampleOf(s)
  const last = history[history.length - 1]
  if (!last || s.t < last.t) return [sample]
  const next = s.t === last.t ? [...history.slice(0, -1), sample] : [...history, sample]
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next
}

/** Score of a room for the automatic focus: an alert counts most, and a room whose detectors are all gone counts less. */
const ALERT_WEIGHT = 10
const BLIND_PENALTY = 5

/**
 * The room the twin follows: the one the user picked, else the room where the model is adding the most information
 * (an alert on a room still sensed first, then the highest P60), else the room whose detectors read hottest, else the
 * first room the model covers. Detector-side quantities only, so the choice never depends on the simulator's truth.
 */
export function pickFocus(s: Snapshot, picked: number | null): number {
  if (picked !== null && picked >= 0 && picked < s.rooms.length) return picked
  let best = -1
  let bestScore = -Infinity
  s.rooms.forEach((r, i) => {
    if (!r.pred) return
    const score = (r.pred.alert ? ALERT_WEIGHT : 0) + r.pred.p60 - (r.condition === 'failed' ? BLIND_PENALTY : 0)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  if (best >= 0 && bestScore > 0.05) return best
  let hottest = -1
  let hottestC = -Infinity
  s.rooms.forEach((r, i) => {
    const c = r.condition === 'failed' ? Infinity : r.tLastC
    if (r.condition !== 'clear' && c > hottestC) {
      hottestC = c
      hottest = i
    }
  })
  if (hottest >= 0) return hottest
  return best >= 0 ? best : 0
}

/** How long before the real flashover the model first alerted, s; null until both have happened. */
export function leadS(r: RoomView): number | null {
  return r.truth.flashedAt !== null && r.firstAlertAt !== null ? r.truth.flashedAt - r.firstAlertAt : null
}

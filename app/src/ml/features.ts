// Model inputs, computed from heat-detector histories only (CLAUDE.md R5: never from the simulator's truth).
// The definitions live in ml/model/contract.json and are mirrored line for line by ml/features.py; the parity of the
// two is tested on ml/model/golden-features.json. Pure, with .ts imports, so ml/generate.ts can run it under Node.

import contract from '../../../ml/model/contract.json' with { type: 'json' }

export const FEATURE_NAMES: readonly string[] = contract.features.map((f) => f.name)
export const WINDOW_S: number = contract.windowS
const SLOPES_S: readonly number[] = contract.slopeWindowsS
const SLOPE_AT_FAIL_S: number = contract.slopeAtFailWindowS

/**
 * What the detectors of one room reported, in time order. `readings[d][k]` = detector d at `t[k]`, degC; NaN once the
 * detector has failed (it never comes back).
 */
export interface RoomHistory {
  t: number[]
  readings: number[][]
}

/** One room's statistics at a given time: the `self_*` features, and what its neighbours contribute to theirs. */
export interface RoomStats {
  tLast: number
  slope10: number
  slope30: number
  slope60: number
  tMax60: number
  fracFailed: number
  sSinceFail: number
  slopeAtFail: number
}

/** Max of the valid readings at sample k; NaN when every detector has failed. */
function signalAt(h: RoomHistory, k: number): number {
  let best = NaN
  for (const d of h.readings) {
    const v = d[k]
    if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) best = v
  }
  return best
}

/** Least-squares slope of the valid room signal for samples with from <= t <= to; NaN with fewer than 2 points. */
function slopeBetween(h: RoomHistory, from: number, to: number, strictEnd = false): number {
  const ts: number[] = []
  const ys: number[] = []
  for (let k = 0; k < h.t.length; k++) {
    const t = h.t[k]
    if (t < from || t > to || (strictEnd && t >= to)) continue
    const y = signalAt(h, k)
    if (Number.isNaN(y)) continue
    ts.push(t)
    ys.push(y)
  }
  if (ts.length < 2) return NaN
  let mt = 0
  let my = 0
  for (let i = 0; i < ts.length; i++) {
    mt += ts[i]
    my += ys[i]
  }
  mt /= ts.length
  my /= ts.length
  let num = 0
  let den = 0
  for (let i = 0; i < ts.length; i++) {
    num += (ts[i] - mt) * (ys[i] - my)
    den += (ts[i] - mt) * (ts[i] - mt)
  }
  return den > 0 ? num / den : NaN
}

/** Statistics of one room at time tNow (the last sample at or before tNow is "now"). */
export function roomStats(h: RoomHistory, tNow: number): RoomStats {
  let last = -1
  for (let k = 0; k < h.t.length && h.t[k] <= tNow; k++) last = k
  const nDet = h.readings.length
  if (last < 0 || nDet === 0) {
    return { tLast: NaN, slope10: NaN, slope30: NaN, slope60: NaN, tMax60: NaN, fracFailed: 0, sSinceFail: NaN, slopeAtFail: NaN }
  }
  let tMax = NaN
  for (let k = 0; k <= last; k++) {
    if (h.t[k] < tNow - WINDOW_S) continue
    const y = signalAt(h, k)
    if (!Number.isNaN(y) && (Number.isNaN(tMax) || y > tMax)) tMax = y
  }
  let failed = 0
  let firstFail = Infinity
  for (const d of h.readings) {
    if (Number.isNaN(d[last])) failed++
    for (let k = 0; k <= last; k++) {
      if (Number.isNaN(d[k])) {
        if (h.t[k] < firstFail) firstFail = h.t[k]
        break
      }
    }
  }
  const hasFail = Number.isFinite(firstFail)
  const [w10, w30, w60] = SLOPES_S
  return {
    tLast: signalAt(h, last),
    slope10: slopeBetween(h, tNow - w10, tNow),
    slope30: slopeBetween(h, tNow - w30, tNow),
    slope60: slopeBetween(h, tNow - w60, tNow),
    tMax60: tMax,
    fracFailed: failed / nDet,
    sSinceFail: hasFail ? tNow - firstFail : NaN,
    slopeAtFail: hasFail ? slopeBetween(h, firstFail - SLOPE_AT_FAIL_S, firstFail, true) : NaN,
  }
}

/** Max ignoring NaN; NaN when nothing is valid. */
function nanMax(values: number[]): number {
  let best = NaN
  for (const v of values) if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) best = v
  return best
}

/** The model's input row for one room, in contract order. */
export function featureVector(self: RoomStats, neighbours: RoomStats[]): number[] {
  return [
    self.tLast,
    self.slope10,
    self.slope30,
    self.slope60,
    self.tMax60,
    self.fracFailed,
    self.sSinceFail,
    self.slopeAtFail,
    nanMax(neighbours.map((n) => n.tLast)),
    nanMax(neighbours.map((n) => n.slope30)),
    neighbours.length ? Math.max(...neighbours.map((n) => n.fracFailed)) : 0,
    nanMax(neighbours.map((n) => n.sSinceFail)),
    nanMax(neighbours.map((n) => n.slopeAtFail)),
  ]
}

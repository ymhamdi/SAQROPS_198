// Breathing-apparatus (ARI) air budget and the point of no return, carried over from Martian Map's O₂ logic:
// from every point of the plan, the way out at returnFactor × the planned time must still end above the EN 137
// low-pressure whistle. Consumption depends on the effort (approach, work, exit), all in data/config.json.

import { H, v } from '../config.ts'
import { stepTime, type PreparedGrid } from '../route/cost.ts'
import type { Reason } from './verdict.ts'

export interface AirParams {
  cylinderL: number
  startBar: number
  whistleBar: number
  returnFactor: number
  approachLpm: number
  workLpm: number
  exitLpm: number
  workS: number
}

export function airParams(): AirParams {
  const a = H.ari
  return {
    cylinderL: v(a.cylinderL),
    startBar: v(a.startBar),
    whistleBar: v(a.whistleBar),
    returnFactor: v(a.returnFactor),
    approachLpm: v(a.consumptionApproachLpm),
    workLpm: v(a.consumptionWorkLpm),
    exitLpm: v(a.consumptionExitLpm),
    workS: v(a.workAtObjectiveS),
  }
}

export type Effort = 'approach' | 'work' | 'exit'

export interface TrackPoint {
  cell: number
  /** time since the team was engaged, on arrival and on leaving (they differ at an objective) */
  arriveS: number
  departS: number
  /** litres of free air used on arriving at the point, and on leaving it (they differ at an objective) */
  airArriveL: number
  airUsedL: number
  /** index of the leg this point ends or lies on */
  leg: number
}

/** Air used per second at an effort, L/s. */
function rate(ap: AirParams, e: Effort): number {
  return (e === 'approach' ? ap.approachLpm : e === 'work' ? ap.workLpm : ap.exitLpm) / 60
}

/**
 * Times and air along legs walked one after the other. Every leg but the last ends at an objective where the team
 * works `ap.workS`; the last leg is the way out (exit effort). `start` = clock and air already used where it begins.
 */
export function buildTrack(p: PreparedGrid, legs: number[][], ap: AirParams, start = { tS: 0, airUsedL: 0 }, lastIsExit = true): TrackPoint[] {
  const out: TrackPoint[] = []
  let t = start.tS
  let air = start.airUsedL
  const w = p.grid.width
  legs.forEach((cells, li) => {
    const effort: Effort = lastIsExit && li === legs.length - 1 ? 'exit' : 'approach'
    if (out.length === 0) out.push({ cell: cells[0], arriveS: t, departS: t, airArriveL: air, airUsedL: air, leg: li })
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1]
      const b = cells[k]
      const diag = a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0)
      const dt = stepTime(p, a, b, diag ? p.grid.cellSizeM * Math.SQRT2 : p.grid.cellSizeM)
      t += dt
      air += dt * rate(ap, effort)
      out.push({ cell: b, arriveS: t, departS: t, airArriveL: air, airUsedL: air, leg: li })
    }
    const ends = !(lastIsExit && li === legs.length - 1)
    if (ends) {
      const last = out[out.length - 1]
      last.departS += ap.workS
      last.airUsedL += ap.workS * rate(ap, 'work')
      t = last.departS
      air = last.airUsedL
    }
  })
  return out
}

/** Pressure left after using airUsedL, bar (ideal gas: free litres = bar × cylinder litres). */
export function barAfter(ap: AirParams, airUsedL: number): number {
  return ap.startBar - airUsedL / ap.cylinderL
}

/** Litres usable before the whistle, from a pressure. */
export function usableL(ap: AirParams, bar: number): number {
  return (bar - ap.whistleBar) * ap.cylinderL
}

export interface PnrCheck {
  /** smallest margin over the plan, litres above the whistle after the way out at returnFactor × */
  worstMarginL: number
  worstIndex: number
  /** first point past the point of no return, or -1 */
  passedIndex: number
  /** pressure when the plan reaches the exit, bar */
  exitBar: number
}

/**
 * At every point: air left above the whistle, minus the way out from there at returnFactor × the time to the nearest
 * exit (exitField, s) at exit effort. Negative = past the point of no return.
 */
export function checkPnr(track: TrackPoint[], exitField: Float32Array, ap: AirParams): PnrCheck {
  let worst = Infinity
  let worstIndex = 0
  let passed = -1
  track.forEach((pt, i) => {
    const left = usableL(ap, barAfter(ap, pt.airUsedL))
    const out = exitField[pt.cell]
    const margin = Number.isFinite(out) ? left - ap.returnFactor * out * rate(ap, 'exit') : -Infinity
    if (margin < worst) {
      worst = margin
      worstIndex = i
    }
    if (margin < 0 && passed < 0) passed = i
  })
  return { worstMarginL: worst, worstIndex, passedIndex: passed, exitBar: barAfter(ap, track[track.length - 1]?.airUsedL ?? 0) }
}

const fmtS = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)

/** Air reasons for a plan (MODELED: consumption and speeds are assumptions). */
export function airReasons(track: TrackPoint[], exitField: Float32Array, ap: AirParams): Reason[] {
  const c = checkPnr(track, exitField, ap)
  const out: Reason[] = []
  if (c.exitBar < ap.whistleBar) {
    out.push({ code: 'AIR_BUDGET', severity: 'no-go', message: `Air insuffisant : sortie prévue à ${Math.round(c.exitBar)} bar, sous le sifflet (${ap.whistleBar} bar)`, source: 'air', status: 'MODELED' })
  } else {
    out.push({ code: 'AIR_BUDGET', severity: 'info', message: `Sortie prévue à ${Math.round(c.exitBar)} bar (sifflet ${ap.whistleBar} bar)`, source: 'air', status: 'MODELED' })
  }
  if (c.passedIndex >= 0) {
    const pt = track[c.passedIndex]
    out.push({ code: 'POINT_OF_NO_RETURN', severity: 'no-go', message: `Point de non-retour dépassé à T+${fmtS(pt.arriveS)} : la sortie à ×${ap.returnFactor} n'est plus garantie avant le sifflet`, source: 'air', status: 'MODELED' })
  } else if (Number.isFinite(c.worstMarginL)) {
    out.push({ code: 'POINT_OF_NO_RETURN', severity: 'info', message: `Marge minimale avant le point de non-retour : ${Math.round(c.worstMarginL / ap.cylinderL)} bar`, source: 'air', status: 'MODELED' })
  }
  return out
}

// Running late. Before the walk the crew ranks the stops (high / medium / low); during it, when they stay longer at a
// stop, the plan is judged again and, if it no longer fits, the fewest lowest-priority stops ahead are dropped.
// Pure: every verdict comes from a judge the caller builds on evaluateEva, the same rules as the plan itself.

import { rideInfo, roverAtLegEnd, type RouteResult } from '../route/route'
import type { Waypoint } from '../types'
import type { EvaVerdict, ReasonCode } from './goNoGo'
import { sphericalDistanceM, type RouteStats } from './stats'

export type Priority = 'high' | 'medium' | 'low'
export const PRIORITIES: Priority[] = ['high', 'medium', 'low']
export const DEFAULT_PRIORITY: Priority = 'medium'
const RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2 }

/** Stop priorities by stop id; a missing id is DEFAULT_PRIORITY. */
export type Priorities = Record<string, Priority>

export const priorityOf = (p: Priorities, id: string): Priority => p[id] ?? DEFAULT_PRIORITY

/** The next priority when the compact control is clicked: medium → high → low → medium. */
export function nextPriority(p: Priority): Priority {
  return p === 'medium' ? 'high' : p === 'high' ? 'low' : 'medium'
}

/** A plan that can be walked with no no-go reason. */
export const isGo = (v: EvaVerdict | null): v is EvaVerdict => !!v && v.stats !== null && !v.reasons.some((r) => r.severity === 'no-go')

export interface Spare {
  /** whole minutes the crew can stay beyond the plan at this stop and still be GO (capped at the search limit) */
  minutes: number
  /** the limit that breaks first one minute later; null when nothing breaks within the search limit */
  limit: ReasonCode | null
}

/**
 * How much longer the crew can stay at one stop. `judge(extraS)` = the plan's verdict with that much more time at
 * the stop. Null when the plan is not GO as it stands. Whole minutes up to maxMin by bisection: more time only ever adds
 * no-go reasons (O₂ budget, point of no return, sunset, radiation).
 */
export function spareAt(judge: (extraS: number) => EvaVerdict | null, maxMin: number): Spare | null {
  if (!isGo(judge(0))) return null
  if (isGo(judge(maxMin * 60))) return { minutes: maxMin, limit: null }
  let lo = 0
  let hi = maxMin
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (isGo(judge(mid * 60))) lo = mid
    else hi = mid
  }
  const broken = judge(hi * 60)
  return { minutes: lo, limit: broken?.reasons.find((r) => r.severity === 'no-go')?.code ?? null }
}

/**
 * Rough time a stop costs the walk: its dwell plus the detour to reach it, from the planned legs in and out, scaled by
 * how much longer prev → stop → next is than prev → next in a straight line. Only used to order stops of equal
 * priority (the real saving is judged afterwards).
 */
export function stopCostS(stats: RouteStats, stations: Waypoint[], j: number, dwellS: number): number {
  const legIn = stats.legs[j]
  const legOut = stats.legs[j + 1]
  if (!legIn || !legOut) return dwellS
  const [prev, cur, next] = [stations[j], stations[j + 1], stations[j + 2]]
  const via = sphericalDistanceM(prev, cur) + sphericalDistanceM(cur, next)
  const share = via > 0 ? 1 - sphericalDistanceM(prev, next) / via : 0
  return dwellS + (legIn.walkS + legIn.rideS + legOut.walkS + legOut.rideS) * share
}

/**
 * The order in which stops are given up when the walk runs late: lowest priority first; among equal priorities the
 * one that costs the walk the most time first (fewest stops lost); then the later one. `candidates` = stop indices.
 */
export function dropOrder(candidates: number[], priorityAt: (i: number) => Priority, costS: (i: number) => number): number[] {
  return [...candidates].sort((a, b) => RANK[priorityAt(a)] - RANK[priorityAt(b)] || costS(b) - costS(a) || b - a)
}

export type CutPlan =
  /** dropping these stops (indices, ascending) makes the rest of the walk GO again */
  | { kind: 'drop'; drop: number[]; verdict: EvaVerdict }
  /** even dropping every stop ahead leaves the plan not GO: head back to safety */
  | { kind: 'none'; verdict: EvaVerdict | null }

/**
 * Which stops to drop so the rest of the walk is GO again. Drops in `order` (see dropOrder) until the plan is GO, then
 * puts back every dropped stop that turns out not to be needed, the most valuable first, so the cut is as small as it
 * can be. `evaluate(drop)` = the verdict of the walk without those stops (indices ascending), or null when there is no
 * route. Called when the plan as it stands is not GO.
 */
export async function planCuts(order: number[], evaluate: (drop: number[]) => Promise<EvaVerdict | null>): Promise<CutPlan> {
  const cache = new Map<string, Promise<EvaVerdict | null>>()
  const judge = (drop: number[]) => {
    const sorted = [...drop].sort((a, b) => a - b)
    const key = sorted.join(',')
    if (!cache.has(key)) cache.set(key, evaluate(sorted))
    return cache.get(key)!
  }
  let drop: number[] = []
  let verdict: EvaVerdict | null = null
  for (const c of order) {
    drop = [...drop, c]
    verdict = await judge(drop)
    if (isGo(verdict)) break
  }
  if (!isGo(verdict)) return { kind: 'none', verdict }
  // The last stop dropped made the difference; the ones before it may not be needed any more.
  for (const c of [...drop].reverse().slice(1)) {
    const without = drop.filter((x) => x !== c)
    const v = await judge(without)
    if (isGo(v)) {
      drop = without
      verdict = v
    }
  }
  return { kind: 'drop', drop: [...drop].sort((a, b) => a - b), verdict: verdict! }
}

export interface CutsInput {
  /** the plan as it stands (ok), with its stats and stops */
  route: Extract<RouteResult, { ok: true }>
  stats: RouteStats
  stops: Waypoint[]
  /** [habitat, ...stops, habitat] */
  stations: Waypoint[]
  /** the stations' cells */
  cells: number[]
  /** index into stops of the stop the crew is at (or heading to); stops after it may be dropped */
  at: number
  /** dwell at each stop, s */
  dwellS: number[]
  priorityAt: (i: number) => Priority
  /** stop indices that must stay (e.g. where the rover is staged as safe haven) */
  keep?: number[]
  /** rover-assisted plan: re-plans start with the rover where it is parked at the crew's stop */
  ride: boolean
  /** plans [from, ...stops, habitat] (cells) in the planner's worker; roverStart = where the rover is parked */
  planRest: (cells: number[], roverStart: number | undefined) => Promise<RouteResult>
  /** the planner's verdict of a whole plan with these dwells */
  judge: (route: RouteResult, dwellS: number[]) => EvaVerdict | null
}

export type Cuts =
  | { kind: 'drop'; drop: number[]; verdict: EvaVerdict; route: Extract<RouteResult, { ok: true }>; stops: Waypoint[] }
  | { kind: 'none' }

/**
 * The fewest lowest-priority stops after `at` to drop so the walk is GO again. Only the rest is re-planned, from the
 * crew's stop (and, riding, from where the rover is parked); the legs up to `at` are kept exactly, so the walked part
 * and the clock do not change.
 */
export async function cutsAhead(c: CutsInput): Promise<Cuts> {
  const { route, stats, stops, cells, at, dwellS } = c
  const order = dropOrder(
    stops.map((_, k) => k).filter((k) => k > at && !(c.keep ?? []).includes(k)),
    c.priorityAt,
    (k) => stopCostS(stats, c.stations, k, dwellS[k]),
  )
  const prefix = route.legs.slice(0, at + 1)
  const roverStart = c.ride && at >= 0 ? roverAtLegEnd(route.legs[at]) : undefined
  const base = cells[cells.length - 1]
  const built = new Map<string, { route: Extract<RouteResult, { ok: true }>; stops: Waypoint[] }>()
  const plan = await planCuts(order, async (drop) => {
    const kept = stops.map((_, k) => k).filter((k) => !drop.includes(k)) // only stops after `at` are dropped
    const rest = await c.planRest([cells[at + 1], ...kept.filter((k) => k > at).map((k) => cells[k + 1]), base], roverStart)
    if (!rest.ok) return null
    const legs = [...prefix, ...rest.legs]
    const whole = { ok: true as const, legs, timeS: legs.reduce((t, l) => t + l.timeS, 0), ...(c.ride ? { ride: rideInfo(legs, base) } : {}) }
    built.set(drop.join(','), { route: whole, stops: kept.map((k) => stops[k]) })
    return c.judge(whole, kept.map((k) => dwellS[k]))
  })
  if (plan.kind === 'none') return { kind: 'none' }
  return { kind: 'drop', drop: plan.drop, verdict: plan.verdict, ...built.get(plan.drop.join(','))! }
}

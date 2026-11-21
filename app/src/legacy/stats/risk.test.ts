import { describe, expect, test } from 'vitest'
import { DEFAULT_ROUTE_PARAMS, prepareGrid, ROVER_ROUTE_PARAMS } from '../route/cost'
import { cellCenter, planRide, planRoute, roverAtLegEnd, type RouteResult } from '../route/route'
import { walkHomeField } from '../route/search'
import { gridFrom, idx } from '../testing/grids'
import type { Conditions, Waypoint } from '../types'
import { DEFAULT_EVA_PARAMS, evaluateEva, type EvaVerdict, type ReasonCode } from './goNoGo'
import { cutsAhead, dropOrder, isGo, nextPriority, planCuts, spareAt, type Priority } from './risk'
import { routeStats } from './stats'

/** A stand-in verdict: GO or NO-GO with one reason. */
const verdict = (go: boolean, code: ReasonCode = 'O2_BUDGET'): EvaVerdict => ({
  verdict: go ? 'GO' : 'NO-GO',
  reasons: [{ code, severity: go ? 'info' : 'no-go', message: '' }],
  stats: routeStats(prepareGrid(gridFrom(['..']), DEFAULT_ROUTE_PARAMS), [{ from: 0, to: 1, cells: [0, 1], timeS: 0 }]),
  endTime: null,
  doseMSv: null,
  status: 'MODELED',
})

describe('spare time at a stop', () => {
  test('the largest whole minute that stays GO, and the limit that breaks next', () => {
    expect(spareAt((s) => verdict(s <= 37 * 60, 'SUNSET'), 480)).toEqual({ minutes: 37, limit: 'SUNSET' })
    expect(spareAt((s) => verdict(s <= 0), 480)).toEqual({ minutes: 0, limit: 'O2_BUDGET' })
  })
  test('null when the plan is not GO as it stands; capped when nothing breaks', () => {
    expect(spareAt(() => verdict(false), 480)).toBeNull()
    expect(spareAt(() => verdict(true), 480)).toEqual({ minutes: 480, limit: null })
  })
})

describe('which stops go first', () => {
  test('lowest priority first, then the stop that costs the walk most, then the later one', () => {
    const prio: Priority[] = ['high', 'low', 'medium', 'low', 'low']
    const cost = [100, 50, 999, 50, 80]
    expect(dropOrder([0, 1, 2, 3, 4], (i) => prio[i], (i) => cost[i])).toEqual([4, 3, 1, 2, 0])
  })
  test('the compact control cycles medium → high → low → medium', () => {
    expect([nextPriority('medium'), nextPriority('high'), nextPriority('low')]).toEqual(['high', 'low', 'medium'])
  })
})

describe('cutting the plan', () => {
  // Each stop saves this many minutes when dropped; the walk fits once 25 minutes are saved.
  const saves = [5, 30, 12]
  const evaluate = (need: number) => async (drop: number[]) => verdict(drop.reduce((t, k) => t + saves[k], 0) >= need)

  test('drops in order until GO, then puts back what turned out not to be needed', async () => {
    const cut = await planCuts([0, 1, 2], evaluate(25))
    expect(cut.kind).toBe('drop')
    if (cut.kind === 'drop') expect(cut.drop).toEqual([1]) // 0 was dropped first, but 1 alone is enough
  })
  test('keeps dropping when one stop is not enough', async () => {
    const cut = await planCuts([0, 2, 1], evaluate(40))
    expect(cut.kind === 'drop' && cut.drop).toEqual([1, 2]) // 30 + 12; the 5-minute stop is put back
  })
  test('none when even dropping every stop ahead is not GO', async () => {
    expect((await planCuts([0, 1, 2], evaluate(100))).kind).toBe('none')
    expect((await planCuts([], evaluate(1))).kind).toBe('none')
  })
})

// 600 m of flat ground: habitat at column 0, stops at 120 m, 300 m and 560 m.
const g = gridFrom(Array.from({ length: 9 }, () => '.'.repeat(300)))
const walk = prepareGrid(g, DEFAULT_ROUTE_PARAMS)
const drive = prepareGrid(g, ROVER_ROUTE_PARAMS)
const base = idx(g, 4, 0)
const cells = [base, idx(g, 4, 60), idx(g, 4, 150), idx(g, 4, 280), base]
const point = (c: number, id: string): Waypoint => ({ id, ...cellCenter(g, c), kind: 'science', name: id })
const stations = cells.map((c, i) => point(c, i === 0 || i === cells.length - 1 ? 'habitat' : `s${i - 1}`))
const stops = stations.slice(1, -1)
const home = walkHomeField(walk, base)
const day = Array.from({ length: 25 }, (_, h) => ({
  time: new Date(Date.UTC(2026, 0, 1, h)).toISOString(), tempC: -50, pressurePa: 700, dustTau: 0.5,
  sunElevationDeg: 45, radiationAlert: false, source: 't', status: 'MOCK',
})) as Conditions[]
// A short suit budget, so a 20-minute overstay at the first stop breaks the plan: 120 min of O₂, 30 in reserve.
const params = { ...DEFAULT_EVA_PARAMS, o2DurationS: 120 * 60 }
const judge = (ride: boolean) => (r: RouteResult, dwellS: number[]) =>
  evaluateEva({ prepared: walk, route: r, walkHome: home, startTime: day[1].time, conditions: day, dwellS, params, drive: ride ? drive : undefined })
const DWELL = 20 * 60

describe('running late on a real plan', () => {
  const plan = planRoute(walk, cells)
  if (!plan.ok) throw new Error('no route')
  const overstay = [DWELL + 20 * 60, DWELL, DWELL] // the crew stayed 20 min longer at s0
  const input = (priority: Priority[]) => ({
    route: plan,
    stats: routeStats(walk, plan.legs, overstay),
    stops,
    stations,
    cells,
    at: 0,
    dwellS: overstay,
    priorityAt: (k: number) => priority[k],
    ride: false,
    planRest: async (c: number[]) => planRoute(walk, c),
    judge: judge(false),
  })

  test('on plan it is GO; the overstay makes it NO-GO', () => {
    expect(isGo(judge(false)(plan, [DWELL, DWELL, DWELL]))).toBe(true)
    expect(isGo(judge(false)(plan, overstay))).toBe(false)
  })

  test('the lowest-priority stop ahead is dropped, and the walked part is kept exactly', async () => {
    const farLow = await cutsAhead(input(['high', 'medium', 'low']))
    expect(farLow.kind).toBe('drop')
    if (farLow.kind !== 'drop') return
    expect(farLow.drop).toEqual([2])
    expect(farLow.stops.map((s) => s.id)).toEqual(['s0', 's1'])
    expect(farLow.route.legs[0]).toBe(plan.legs[0]) // the leg already walked, untouched
    expect(isGo(farLow.verdict)).toBe(true)
    // with the middle stop ranked lowest, it is the one that goes (the walk still fits without it)
    const midLow = await cutsAhead(input(['high', 'low', 'medium']))
    expect(midLow.kind === 'drop' && midLow.drop).toEqual([1])
  })

  test('a stop that must stay is never dropped; the crew is told to head back when nothing helps', async () => {
    const kept = await cutsAhead({ ...input(['high', 'low', 'low']), keep: [1, 2] })
    expect(kept.kind).toBe('none')
  })

  test('riding: the rest is re-planned from where the rover is parked', async () => {
    const reach = walkHomeField(drive, base)
    const ride = planRide(walk, drive, reach, cells, 400, 120)
    if (!ride.ok) throw new Error('no route')
    const at = 1
    const roverStart = roverAtLegEnd(ride.legs[at])!
    expect(roverStart).toBeGreaterThanOrEqual(0)
    const rest = planRide(walk, drive, reach, [cells[at + 1], cells[at + 3], base], 400, 120, roverStart)
    expect(rest.ok).toBe(true)
    if (!rest.ok) return
    expect(rest.legs[0].rover![0]).toBe(roverStart) // the crew starts beside the rover where it really is
    expect(rest.legs.at(-1)!.cells.at(-1)).toBe(base)
  })
})

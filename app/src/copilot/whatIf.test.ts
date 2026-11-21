import { describe, expect, test } from 'vitest'
import { prepareGrid } from '../route/cost'
import { cellCenter, planLoop, type Leg } from '../route/route'
import { findPath, walkHomeField } from '../route/search'
import { DEFAULT_EVA_PARAMS, evaluateEva, type EvaParams } from '../stats/goNoGo'
import { gridFrom, idx } from '../testing/grids'
import type { Conditions, ScienceTarget, Waypoint } from '../types'
import { addStop, extendStay, goHome, skipStop, stopStates, timeLeft, type PathFinder, type PlanContext } from './whatIf'

const START = '2026-11-15T08:00:00.000Z'
const HOUR = 3600_000

/** Hourly conditions from 2 h before START to 12 h after; sun(h) = elevation at START + h hours. */
function conditions(sun: (h: number) => number, alertHours: number[] = []): Conditions[] {
  const out: Conditions[] = []
  for (let h = -2; h <= 12; h++) {
    out.push({
      time: new Date(Date.parse(START) + h * HOUR).toISOString(),
      tempC: -30,
      pressurePa: 800,
      dustTau: 0.6,
      sunElevationDeg: sun(h),
      radiationAlert: alertHours.includes(h),
      source: 'test',
      status: 'MOCK',
    })
  }
  return out
}
const LONG_DAY = (h: number) => 60 - 4 * h // sets 15 h after START: never binds
const SHORT_DAY = (h: number) => 40 - 10 * h // sets 4 h after START

const WIDTH = 300

/** A flat 600 m strip; the habitat at column 0, stops at the given columns. */
function site(stopCols: number[], over: Partial<PlanContext> = {}) {
  const g = gridFrom(['.'.repeat(WIDTH)])
  const p = prepareGrid(g)
  const base = idx(g, 0, 0)
  const cells = stopCols.map((c) => idx(g, 0, c))
  const r = planLoop(p, base, cells)
  if (!r.ok) throw new Error('no route')
  const stops: Waypoint[] = cells.map((c, i) => ({ id: `s${i}`, ...cellCenter(g, c), kind: 'science', name: `Stop ${i}` }))
  const targets = stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, name: s.name, why: '', instrumentsNeeded: [], source: 'test', status: 'MOCK' }) as ScienceTarget)
  const ctx: PlanContext = {
    prepared: p,
    legs: r.legs,
    stops,
    targets,
    walkHome: walkHomeField(p, base),
    startTime: START,
    conditions: conditions(LONG_DAY),
    params: DEFAULT_EVA_PARAMS,
    lonEast: 137.38,
    ...over,
  }
  const finder: PathFinder = async (a, b) => findPath(p, a, b)?.cells ?? null
  return { g, p, ctx, finder, cells, base }
}

/** Track index of the point where stop i is worked (end of leg i). */
function stopIndex(legs: Leg[], i: number): number {
  let n = legs[0].cells.length - 1
  for (let l = 1; l <= i; l++) n += legs[l].cells.length - 1
  return n
}

function planOf(ctx: PlanContext) {
  const v = evaluateEva({ prepared: ctx.prepared, route: { ok: true, legs: ctx.legs, timeS: 0 }, walkHome: ctx.walkHome, startTime: ctx.startTime, conditions: ctx.conditions, params: ctx.params })
  return v.stats!
}

/** Params whose O₂ leaves `spareMin` minutes of point-of-no-return margin when leaving stop `i` on plan. */
function pnrTight(ctx: PlanContext, i: number, spareMin: number): EvaParams {
  const stats = planOf(ctx)
  const at = stats.track[stopIndex(ctx.legs, i)]
  const need = at.departS + DEFAULT_EVA_PARAMS.walkHomeContingency * ctx.walkHome[at.cell]
  return { ...DEFAULT_EVA_PARAMS, o2DurationS: DEFAULT_EVA_PARAMS.o2ReserveS + need + spareMin * 60 }
}

describe('extendStay', () => {
  test('the point of no return binds at a far stop, and the search lands on the exact minute', () => {
    const { ctx } = site([WIDTH - 1])
    const params = pnrTight(ctx, 0, 25)
    const c = { ...ctx, params }
    const i = stopIndex(c.legs, 0)
    const arrive = planOf(c).track[i].arriveS
    const r = extendStay(c, { elapsedS: arrive, index: i }, 60)
    expect(r.verdict).toBe('PARTIAL')
    expect(r.binding).toBe('POINT_OF_NO_RETURN')
    // from arrival: the 20 planned minutes plus the 25 of spare margin
    expect(r.allowed_min).toBeGreaterThanOrEqual(44)
    expect(r.allowed_min).toBeLessThanOrEqual(45)
    expect(extendStay(c, { elapsedS: arrive, index: i }, r.allowed_min!).verdict).toBe('GO')
    expect(extendStay(c, { elapsedS: arrive, index: i }, r.allowed_min! + 1).verdict).toBe('PARTIAL')
    expect(r.next_is_home).toBe(true)
    expect(r.apply).toMatchObject({ kind: 'extend_stay', stopId: 's0' })
  })

  test('the O₂ budget binds when the emergency walk home is not the tighter limit', () => {
    const { ctx } = site([WIDTH - 1])
    const total = planOf(ctx).totalS
    // 30.5 min spare, so the 30th minute is clearly inside and the 31st clearly outside (no float tie)
    const params = { ...DEFAULT_EVA_PARAMS, walkHomeContingency: 0.5, o2DurationS: DEFAULT_EVA_PARAMS.o2ReserveS + total + 30.5 * 60 }
    const c = { ...ctx, params }
    const i = stopIndex(c.legs, 0)
    const r = extendStay(c, { elapsedS: planOf(c).track[i].arriveS, index: i }, 120)
    expect(r.binding).toBe('O2_BUDGET')
    expect(r.allowed_min).toBe(20 + 30) // planned dwell + spare O₂
  })

  test('sunset binds on a short day with plenty of O₂', () => {
    const { ctx } = site([WIDTH - 1], { conditions: conditions(SHORT_DAY) })
    const i = stopIndex(ctx.legs, 0)
    const r = extendStay(ctx, { elapsedS: planOf(ctx).track[i].arriveS, index: i }, 240)
    expect(r.verdict).toBe('PARTIAL')
    expect(r.binding).toBe('SUNSET')
    expect(r.numbers.sunset_margin_min).toBeGreaterThanOrEqual(30)
  })

  test('a radiation alert later in the day binds the stay', () => {
    const { ctx } = site([WIDTH - 1], { conditions: conditions(LONG_DAY, [3, 4, 5]) })
    const i = stopIndex(ctx.legs, 0)
    const r = extendStay(ctx, { elapsedS: planOf(ctx).track[i].arriveS, index: i }, 240)
    expect(r.binding).toBe('RADIATION')
    expect(r.verdict).toBe('PARTIAL')
  })

  test('max extra stay only shrinks as elapsed time grows, at a stop and mid-leg', () => {
    const { ctx } = site([150, WIDTH - 1])
    const c = { ...ctx, params: pnrTight(ctx, 1, 40) }
    const track = planOf(c).track
    for (const index of [stopIndex(c.legs, 0), stopIndex(c.legs, 1), 60, stopIndex(c.legs, 0) + 40]) {
      let prev = Infinity
      for (let late = 0; late <= 90 * 60; late += 5 * 60) {
        const r = extendStay(c, { elapsedS: track[index].arriveS + late, index }, null)
        expect(r.allowed_min!).toBeLessThanOrEqual(prev)
        prev = r.allowed_min!
      }
      expect(prev).toBe(0)
    }
  })

  test('NO_GO when already past the point of no return', () => {
    const { ctx } = site([WIDTH - 1])
    const c = { ...ctx, params: pnrTight(ctx, 0, 10) }
    const i = stopIndex(c.legs, 0)
    const depart = planOf(c).track[i].departS
    const r = extendStay(c, { elapsedS: depart + 15 * 60, index: i }, 5)
    expect(r.verdict).toBe('NO_GO')
    expect(r.allowed_min).toBe(0)
    expect(r.binding).toBe('POINT_OF_NO_RETURN')
    expect(r.numbers.pnr_in_min).toBeLessThan(0)
    expect(r.apply).toBeNull()
    expect(timeLeft(c, { elapsedS: depart + 15 * 60, index: i }).verdict).toBe('NO_GO')
  })

  test('a stop ahead gets minutes beyond its planned dwell; a stop already left cannot', () => {
    const { ctx } = site([100, 200])
    const track = planOf(ctx).track
    const now = { elapsedS: track[20].departS, index: 20 }
    const r = extendStay(ctx, now, 10, 's1')
    expect(r.verdict).toBe('GO')
    expect(r.subject).toBe('Stop 1')
    expect(r.apply).toMatchObject({ kind: 'extend_stay', stopId: 's1', extraS: 600 })
    // leave-by at stop 1 moves 10 min later than planned
    expect(r.numbers.head_back_in_min).toBe(Math.floor((track[stopIndex(ctx.legs, 1)].departS + 600 - now.elapsedS) / 60))
    const later = { elapsedS: track[stopIndex(ctx.legs, 1)].departS + 30, index: stopIndex(ctx.legs, 1) + 10 }
    expect(extendStay(ctx, later, 10, 's0').binding).toBe('ALREADY_LEFT')
  })
})

describe('add_stop and skip_stop agree with evaluateEva', () => {
  test('skip a stop ahead: saved time = the plan without it', async () => {
    const { ctx, finder, p, base, cells } = site([100, 250])
    const r = await skipStop(ctx, { elapsedS: 0, index: 0 }, 's1', finder)
    const without = planLoop(p, base, [cells[0]])
    if (!without.ok) throw new Error('no route')
    const v = evaluateEva({ prepared: p, route: without, walkHome: ctx.walkHome, startTime: START, conditions: ctx.conditions })
    expect(r.verdict).toBe('GO')
    expect(r.numbers.saved_min).toBe(Math.floor((planOf(ctx).totalS - v.stats!.totalS) / 60 + 1e-6))
    expect(r.numbers.dose_msv).toBeCloseTo(v.doseMSv!, 2)
  })

  test('skip the stop being worked: leave now, saving the rest of its dwell', async () => {
    const { ctx, finder } = site([100])
    const i = stopIndex(ctx.legs, 0)
    const arrive = planOf(ctx).track[i].arriveS
    const r = await skipStop(ctx, { elapsedS: arrive + 5 * 60, index: i }, 's0', finder)
    expect(r.numbers.saved_min).toBe(15)
  })

  test('add a target: extra time = the best order with it, judged by evaluateEva', async () => {
    const { ctx, finder, p, base, cells } = site([100, 250])
    const one: PlanContext = { ...ctx, legs: (planLoop(p, base, [cells[1]]) as { legs: Leg[] }).legs, stops: [ctx.stops[1]] }
    const r = await addStop(one, { elapsedS: 0, index: 0 }, 's0', finder)
    const both = planLoop(p, base, cells)
    if (!both.ok) throw new Error('no route')
    const v = evaluateEva({ prepared: p, route: both, walkHome: ctx.walkHome, startTime: START, conditions: ctx.conditions })
    expect(r.verdict).toBe('GO')
    expect(r.numbers.extra_min).toBe(Math.ceil((v.stats!.totalS - planOf(one).totalS) / 60 - 1e-6))
    expect(r.apply).toEqual({ kind: 'add_stop', targetId: 's0', insertAt: 0 })
  })

  test('add a target that breaks the O₂ budget: NO_GO naming the limit', async () => {
    const { ctx, finder, p, base, cells } = site([100, WIDTH - 1])
    const legs = (planLoop(p, base, [cells[0]]) as { legs: Leg[] }).legs
    const one: PlanContext = { ...ctx, legs, stops: [ctx.stops[0]] }
    const params = pnrTight(one, 0, 15)
    const r = await addStop({ ...one, params }, { elapsedS: 0, index: 0 }, 's1', finder)
    expect(r.verdict).toBe('NO_GO')
    expect(['POINT_OF_NO_RETURN', 'O2_BUDGET']).toContain(r.binding)
    expect(r.apply).toBeNull()
  })

  test('targets already on the plan or already visited are answered without a budget', async () => {
    const { ctx, finder } = site([100, 200])
    expect((await addStop(ctx, { elapsedS: 0, index: 0 }, 's1', finder)).binding).toBe('ALREADY_PLANNED')
    const later = stopIndex(ctx.legs, 1)
    expect((await addStop(ctx, { elapsedS: planOf(ctx).track[later].arriveS, index: later }, 's0', finder)).binding).toBe('ALREADY_VISITED')
  })
})

describe('timeLeft and goHome', () => {
  test('time to the point of no return is the HUD walk-home margin', () => {
    const { ctx } = site([WIDTH - 1])
    const c = { ...ctx, params: pnrTight(ctx, 0, 30) }
    const i = stopIndex(c.legs, 0)
    const t = planOf(c).track[i].arriveS
    const r = timeLeft(c, { elapsedS: t, index: i })
    const p = c.params
    const margin = p.o2DurationS - p.o2ReserveS - (t + p.walkHomeContingency * c.walkHome[planOf(c).track[i].cell])
    expect(r.verdict).toBe('GO')
    expect(r.binding).toBe('POINT_OF_NO_RETURN')
    expect(r.numbers.pnr_in_min).toBe(Math.floor(margin / 60))
    expect(r.numbers.head_back_in_min).toBe(Math.floor(margin / 60))
  })

  test('"time left" and "how long can we stay" agree when sunset binds at the last stop', () => {
    const { ctx } = site([WIDTH - 1], { conditions: conditions(SHORT_DAY) })
    const i = stopIndex(ctx.legs, 0)
    const now = { elapsedS: planOf(ctx).track[i].arriveS + 10 * 60, index: i }
    const stay = extendStay(ctx, now, null)
    const left = timeLeft(ctx, now)
    expect(left.binding).toBe('SUNSET')
    expect(Math.abs(left.numbers.head_back_in_min! - stay.allowed_min!)).toBeLessThanOrEqual(1)
  })

  test('the way home: spare O₂ at the slow pace, as the HUD abort shows it', () => {
    const { ctx } = site([WIDTH - 1])
    const i = stopIndex(ctx.legs, 0)
    const t = planOf(ctx).track[i].arriveS
    const home = ctx.walkHome[planOf(ctx).track[i].cell]
    const r = goHome(ctx, { elapsedS: t, index: i }, { haven: 'the habitat', timeS: home, distanceM: 598 })
    const p = ctx.params
    expect(r.verdict).toBe('GO')
    expect(r.numbers.spare_o2_min).toBe(Math.floor((p.o2DurationS - p.o2ReserveS - (t + 1.5 * home)) / 60))
    expect(r.numbers.distance_m).toBe(600)
    expect(goHome(ctx, { elapsedS: t, index: i }, null).binding).toBe('NO_HAVEN')
  })
})

test('stopStates marks done, current, next and ahead', () => {
  const { ctx } = site([100, 200, 250])
  const at1 = stopIndex(ctx.legs, 1)
  expect(stopStates(ctx, { elapsedS: 0, index: at1 }).map((s) => s.state)).toEqual(['done', 'current', 'next'])
  expect(stopStates(ctx, { elapsedS: 0, index: 10 }).map((s) => s.state)).toEqual(['next', 'ahead', 'ahead'])
})

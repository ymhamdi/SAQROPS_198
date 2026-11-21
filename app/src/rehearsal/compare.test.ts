// Plan or real: the lead or delay and the air used more or less than planned, at the team's position.

import { beforeAll, describe, expect, test } from 'vitest'
import { v } from '../config'
import { H } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { snapshot } from '../sim/protocol'
import { initSim, makeContext, startFire, tick, type SimContext, type SimState } from '../sim/sim'
import { buildSite } from '../site/site'
import { comparePlan } from './compare'
import { barAt, rehearse, type RehearsalPlan } from './engine'
import { knownInputOf } from './input'

const site = buildSite()
let ctx: SimContext
let s: SimState
let plan: RehearsalPlan

beforeAll(() => {
  ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 90; k++) {
    if (k === 25) applyAction(ctx, s, { type: 'indoor' })
    tick(ctx, s)
  }
  plan = rehearse(site, knownInputOf(site, snapshot(ctx, s)))
}, 60_000)

describe('plan or real', () => {
  test('a team exactly on the plan has no lead, no delay and no air difference', () => {
    for (const i of [0, 40, Math.floor(plan.track.length / 2), plan.track.length - 1]) {
      const p = plan.track[i]
      const c = comparePlan(site, plan, { cell: p.cell, clock: p.arriveS, bar: barAt(plan, p.arriveS) })!
      expect(c.offRouteM).toBe(0)
      expect(Math.abs(c.delayS)).toBeLessThan(1e-6)
      expect(Math.abs(c.barDelta)).toBeLessThan(1e-9)
    }
  })

  test('late is positive, ahead is negative, and more air used than planned is a negative difference', () => {
    const p = plan.track[40]
    const bar = barAt(plan, p.arriveS)
    expect(comparePlan(site, plan, { cell: p.cell, clock: p.arriveS + 20, bar })!.delayS).toBeCloseTo(20, 6)
    expect(comparePlan(site, plan, { cell: p.cell, clock: p.arriveS - 5, bar })!.delayS).toBeCloseTo(-5, 6)
    expect(comparePlan(site, plan, { cell: p.cell, clock: p.arriveS, bar: bar - 7 })!.barDelta).toBeCloseTo(-7, 6)
  })

  test('working at an objective as planned is on time, not a growing delay', () => {
    const k = plan.objectiveIndex[0]
    const p = plan.track[k]
    expect(p.departS).toBeGreaterThan(p.arriveS)
    const mid = (p.arriveS + p.departS) / 2
    const c = comparePlan(site, plan, { cell: p.cell, clock: mid, bar: barAt(plan, mid) })!
    expect(c.delayS).toBe(0)
    expect(Math.abs(c.barDelta)).toBeLessThan(1e-9)
    // Still there once the planned work is over: that is a delay.
    expect(comparePlan(site, plan, { cell: p.cell, clock: p.departS + 12, bar: 200 })!.delayS).toBeCloseTo(12, 6)
  })

  test('on the way back through the same cells, the point whose time matches the clock is the one used', () => {
    // The route goes out and back across the hall: the same cell appears at two times.
    const seen = new Map<number, number>()
    let twice: [number, number] | null = null
    plan.track.forEach((p, i) => {
      if (seen.has(p.cell) && !twice && p.arriveS - plan.track[seen.get(p.cell)!].arriveS > 30) twice = [seen.get(p.cell)!, i]
      if (!seen.has(p.cell)) seen.set(p.cell, i)
    })
    expect(twice).not.toBeNull()
    const [first, second] = twice!
    const late = comparePlan(site, plan, { cell: plan.track[second].cell, clock: plan.track[second].arriveS + 3, bar: 200 })!
    const early = comparePlan(site, plan, { cell: plan.track[first].cell, clock: plan.track[first].arriveS + 3, bar: 200 })!
    expect(late.plannedAtS).toBe(plan.track[second].arriveS)
    expect(early.plannedAtS).toBe(plan.track[first].arriveS)
  })

  test('in the real simulation, shortly after the plan is validated the team is close to it', () => {
    const c2 = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const st = initSim(c2, initialDoors(site), 42)
    startFire(c2, st, site.demo.fireAt)
    for (let k = 0; k < 100; k++) {
      if (k === 25) applyAction(c2, st, { type: 'indoor' })
      tick(c2, st)
    }
    const p = rehearse(site, knownInputOf(site, snapshot(c2, st)))
    applyAction(c2, st, { type: 'plan-validate', plan: p })
    // Over the first 45 s the team walks to the victim and starts working there: at every moment it is within seconds of the plan.
    let worstDelay = 0
    let worstBar = 0
    for (let k = 0; k < 45; k++) {
      tick(c2, st)
      const sn = snapshot(c2, st)
      const x = comparePlan(site, p, { cell: sn.team.cell, clock: sn.team.clock, bar: sn.team.bar })!
      worstDelay = Math.max(worstDelay, Math.abs(x.delayS))
      worstBar = Math.max(worstBar, Math.abs(x.barDelta))
    }
    expect(worstDelay).toBeLessThan(5)
    expect(worstBar).toBeLessThan(3)
    const snap = snapshot(c2, st)
    const cmp = comparePlan(site, p, { cell: snap.team.cell, clock: snap.team.clock, bar: snap.team.bar })!
    expect(snap.team.mode).toBe('engaged')
    // The rehearsal and the live route are the same plan on the same grids: the team is on it, on time, on the same air.
    expect(cmp.offRouteM).toBeLessThan(2)
    expect(Math.abs(cmp.delayS)).toBeLessThan(10)
    expect(Math.abs(cmp.barDelta)).toBeLessThan(5)
    expect(snap.team.bar).toBeLessThan(v(H.ari.startBar))
  })
})

// The collapsed rack the plan does not show. A team sent in without the rehearsal walks into it: it stops, reports it, loses
// time and goes round. A team sent in on a validated plan (the indoor drone found it first) never meets it. Nobody ever
// walks through it, and meeting it must not read as a NO-GO that the latch (R6) would keep.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { mergeKnowledge } from '../knowledge/known'
import { rehearse } from '../rehearsal/engine'
import { knownInputOf } from '../rehearsal/input'
import { buildSite } from '../site/site'
import { applyAction } from './actions'
import { snapshot } from './protocol'
import { initSim, makeContext, teamNow, tick } from './sim'

const site = buildSite()
const rack = site.hidden[0].cells

function run(withPlan: boolean) {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  applyAction(ctx, s, { type: 'fire', at: site.demo.fireAt })
  // The first moment the team stands on each objective, and every cell it has stood on.
  const doneAt = new Map<string, number>()
  const cellsWalked = new Set<number>()
  for (let k = 0; k < 230; k++) {
    if (withPlan && k === 25) applyAction(ctx, s, { type: 'indoor' })
    if (k === 100) {
      if (withPlan) applyAction(ctx, s, { type: 'plan-validate', plan: rehearse(site, knownInputOf(site, snapshot(ctx, s))) })
      else applyAction(ctx, s, { type: 'engage-direct' })
    }
    tick(ctx, s)
    if (s.team.mode === 'standby') continue
    const cell = teamNow(ctx, s).cell
    cellsWalked.add(cell)
    for (const o of site.objectives) if (o.cell === cell && !doneAt.has(o.id)) doneAt.set(o.id, s.fire.t)
  }
  return { ctx, s, doneAt, cellsWalked }
}

describe('the collapsed rack', { timeout: 90_000 }, () => {
  const without = run(false)
  const withPlan = run(true)

  test('sent in without the rehearsal, the team meets it once, says so, and PNR now knows the passage is closed', () => {
    const notes = without.s.notes.filter((n) => n.text.includes('Passage obstrué rencontré'))
    expect(notes).toHaveLength(1)
    expect(without.s.contacts).toHaveLength(1)
    expect(without.s.contacts[0]).toMatchObject({ kind: 'obstacle', source: 'team', status: 'SIMULATED' })
    expect(without.s.contacts[0].cells).toEqual(rack)
    expect(without.s.known.blockedCells).toEqual(expect.arrayContaining(rack))
    // The drone never flew: the rooms are as the detectors and the AI say, only the passage is closed.
    expect(without.s.known.active).toBe(false)
  })

  test('nobody ever walks through the rack, with or without the plan', () => {
    for (const r of [without, withPlan]) for (const c of rack) expect(r.cellsWalked.has(c)).toBe(false)
  })

  test('the team stops in front of it and loses contactDelayS, which the plan avoids', () => {
    const lost = without.doneAt.get('victime-peinture')! - withPlan.doneAt.get('victime-peinture')!
    console.log(`victim reached ${withPlan.doneAt.get('victime-peinture')} s with the plan, ${without.doneAt.get('victime-peinture')} s without: ${lost} s lost`)
    expect(lost).toBeGreaterThanOrEqual(v(H.obstacle.contactDelayS) - 3)
    expect(lost).toBeLessThanOrEqual(v(H.obstacle.contactDelayS) + 10)
  })

  test('on a validated plan the team never meets it: the drone found it first', () => {
    expect(withPlan.s.contacts).toEqual([])
    expect(withPlan.s.notes.some((n) => n.text.includes('Passage obstrué rencontré'))).toBe(false)
    expect(withPlan.s.known.blockedCells).toEqual(expect.arrayContaining(rack))
  })

  test('meeting it is not a NO-GO: the verdict is still GO and nothing is latched by it', () => {
    const t = without.s.notes.find((n) => n.text.includes('Passage obstrué rencontré'))!.t
    // Re-run up to just after the contact and look at the latch.
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    applyAction(ctx, s, { type: 'fire', at: site.demo.fireAt })
    for (let k = 0; k < 100; k++) tick(ctx, s)
    applyAction(ctx, s, { type: 'engage-direct' })
    for (let k = 0; k < t - 100 + 3; k++) tick(ctx, s)
    expect(s.contacts).toHaveLength(1)
    expect(s.latch.latched).toBe(false)
    expect(s.shown.verdict).toBe('GO')
    // The wait is on the plan, at working effort: the team stands still for contactDelayS and uses its air meanwhile.
    const first = s.team.track[0]
    expect(first.departS - first.arriveS).toBeCloseTo(v(H.obstacle.contactDelayS), 6)
    expect((first.airUsedL - first.airArriveL) / (first.departS - first.arriveS)).toBeCloseTo(ctx.air.workLpm / 60, 6)
  })

  test('a passage the team met stays closed whether or not the drone flew (R9: closing only adds cost)', () => {
    const met = mergeKnowledge(site.rooms.length, false, without.s.contacts, 200)
    expect(met.active).toBe(false)
    expect(met.blockedCells).toEqual(expect.arrayContaining(rack))
    expect(met.rooms.every((r) => r.extraCost === 1 && !r.unknown)).toBe(true)
  })
})

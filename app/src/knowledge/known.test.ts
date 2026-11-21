// R9: what the indoor drone sees can only make things worse, never better, and nobody having looked is no proof of safety.
// R10: observations age; expired, they leave the room UNKNOWN again.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { indoorParams, planIndoor, senseIndoor, type IndoorTruth } from '../drone/indoor'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { launchIndoor, makeContext, initSim, startFire, tick, engage } from '../sim/sim'
import { buildSite } from '../site/site'
import { verdictOf, type Reason } from '../stats/verdict'
import { knownReasons, mergeKnown, mergeKnowledge } from './known'
import type { Observation } from './observation'

const site = buildSite()
const n = site.rooms.length
const params = indoorParams()
const targets = site.demo.objectives.map((id) => ({ id, cell: site.objectives.find((o) => o.id === id)!.cell }))
const plan = planIndoor(site, { doorOpen: initialDoors(site), roomTLastC: site.rooms.map(() => 20) }, site.demo.entry, targets, params)
/** Just after the drone has landed: every picture is in, none is old yet. */
const LANDED = plan.durationS + 1
const truth = (layer: number[]): IndoorTruth => ({ layerC: layer, doorOpen: initialDoors(site), hidden: [{ id: 'rack', name: 'rack', cells: [site.objectives[0].cell] }], ambientC: 20 })

/** A small deterministic generator, for property-style checks. */
function lcg(seed: number) {
  let a = seed
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) | 0
    return (a >>> 0) / 4294967296
  }
}

describe('R9 an observation can only make things worse', { timeout: 120_000 }, () => {
  test('before the drone has flown the layer is off: every cost is as it was', () => {
    const k = mergeKnowledge(n, false, [], 100)
    expect(k.active).toBe(false)
    expect(k.rooms.every((r) => r.extraCost === 1 && !r.unknown)).toBe(true)
    expect(k.blockedCells).toEqual([])
    expect(knownReasons(k, new Set([0, 1, 2]), String)).toEqual([])
  })

  test('whatever the drone saw, no room costs less than without it, and nothing is ever free', () => {
    const rnd = lcg(11)
    for (let run = 0; run < 60; run++) {
      const layer = site.rooms.map(() => 20 + rnd() * 600)
      const all = senseIndoor(site, plan, truth(layer), 0, params, run)
      const some = all.filter(() => rnd() < 0.7)
      const t = rnd() * 400
      const k = mergeKnowledge(n, true, some, t)
      for (const r of k.rooms) expect(r.extraCost).toBeGreaterThanOrEqual(1)
      // Visiting a room can send it back to the detectors' and the AI's cost, no lower: never under the unknown cost
      // of a room nobody saw, unless it was seen.
      k.rooms.forEach((r, i) => {
        const seen = some.some((o) => o.room === i && (o.kind === 'room-thermal' || o.kind === 'too-hot') && o.receivedAtS <= t)
        if (!seen) expect(r.extraCost).toBeGreaterThanOrEqual(v(H.knowledge.unknownCostMultiplier))
      })
    }
  })

  test('a room nobody has observed is UNKNOWN with an uncertainty cost, never zero and never « safe »', () => {
    const k = mergeKnowledge(n, true, [], 10)
    for (const r of k.rooms) {
      expect(r.unknown).toBe(true)
      expect(r.extraCost).toBe(v(H.knowledge.unknownCostMultiplier))
      expect(r.extraCost).toBeGreaterThan(1)
    }
  })

  test('a calm picture sends a room back to what the detectors and the AI say, and no further', () => {
    const calm = senseIndoor(site, plan, truth(site.rooms.map(() => 20)), 0, params, 1)
    const k = mergeKnowledge(n, true, calm, LANDED)
    const peinture = site.rooms.findIndex((r) => r.id === 'peinture')
    expect(k.rooms[peinture].unknown).toBe(false)
    expect(k.rooms[peinture].extraCost).toBe(1)
  })

  test('a hot reading, or a room too hot to enter, costs more', () => {
    const layer = site.rooms.map(() => 20)
    const peinture = site.rooms.findIndex((r) => r.id === 'peinture')
    layer[peinture] = v(H.progression.hotC) + 80
    const k = mergeKnowledge(n, true, senseIndoor(site, plan, truth(layer), 0, params, 1), LANDED)
    expect(k.rooms[peinture].extraCost).toBe(v(H.knowledge.observedHotCostMultiplier))
  })

  test('the drone’s reasons are added to the verdict and none can improve it', () => {
    const noGo: Reason = { code: 'ROOM_FAILED', severity: 'no-go', message: 'x', source: 'rules', status: 'SIMULATED' }
    const base = verdictOf([noGo])
    const layer = site.rooms.map(() => 20)
    layer[site.rooms.findIndex((r) => r.id === 'peinture')] = 300
    const k = mergeKnowledge(n, true, senseIndoor(site, plan, truth(layer), 0, params, 1), LANDED)
    const extra = knownReasons(k, new Set(site.rooms.map((_, i) => i)), (i) => site.rooms[i].name)
    expect(extra.length).toBeGreaterThan(0)
    const merged = mergeKnown(base, extra)
    expect(merged.verdict).toBe('NO-GO')
    expect(merged.reasons.length).toBe(base.reasons.length + extra.length)
    // From a GO, the drone can only add cautions or worse: it never removes a reason.
    const go = verdictOf([{ code: 'AIR_BUDGET', severity: 'info', message: 'air', source: 'air', status: 'MODELED' }])
    const after = mergeKnown(go, extra)
    for (const r of go.reasons) expect(after.reasons.some((x) => x.message === r.message)).toBe(true)
  })

  test('in the real simulation, with the drone flown, no cell is cheaper than without it and a NO-GO stays a NO-GO', () => {
    const run = (withDrone: boolean) => {
      const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
      const s = initSim(ctx, initialDoors(site), 42)
      startFire(ctx, s, site.demo.fireAt)
      for (let k = 0; k < 120; k++) {
        if (k === 30 && withDrone) launchIndoor(ctx, s)
        if (k === 100) engage(ctx, s)
        tick(ctx, s)
      }
      return { ctx, s }
    }
    const a = run(false)
    const b = run(true)
    expect(b.s.indoor.status).toBe('flown')
    let cheaper = 0
    for (let i = 0; i < a.s.cost.pace.length; i++) if (b.s.cost.pace[i] < a.s.cost.pace[i] - 1e-9) cheaper++
    expect(cheaper).toBe(0)
    for (let i = 0; i < a.s.travel.pace.length; i++) expect(b.s.travel.pace[i]).toBeGreaterThanOrEqual(a.s.travel.pace[i] - 1e-9)
    if (a.s.shown.verdict === 'NO-GO') expect(b.s.shown.verdict).toBe('NO-GO')
    // The drone opened nothing.
    expect(b.s.fire.doorOpen).toEqual(a.s.fire.doorOpen)
  })
})

describe('R10 observations age and expire', () => {
  const calm = senseIndoor(site, plan, truth(site.rooms.map(() => 20)), 0, params, 1)
  const peinture = site.rooms.findIndex((r) => r.id === 'peinture')
  const only = (o: Observation) => [o]

  test('fresh: the room is known; much later: UNKNOWN again', () => {
    const o = calm.find((x) => x.kind === 'room-thermal' && x.room === peinture)!
    expect(mergeKnowledge(n, true, only(o), o.takenAtS + 1).rooms[peinture].unknown).toBe(false)
    const late = o.takenAtS + 20 * v(H.knowledge.confidenceHalfLifeS)
    const k = mergeKnowledge(n, true, only(o), late)
    expect(k.rooms[peinture].unknown).toBe(true)
    expect(k.rooms[peinture].extraCost).toBe(v(H.knowledge.unknownCostMultiplier))
  })

  test('the confidence shown decays with age', () => {
    const o = calm.find((x) => x.kind === 'room-thermal' && x.room === peinture)!
    const a = mergeKnowledge(n, true, only(o), o.takenAtS + 1).rooms[peinture].confidence
    const b = mergeKnowledge(n, true, only(o), o.takenAtS + 60).rooms[peinture].confidence
    expect(b).toBeLessThan(a)
  })

  test('a picture still in a radio dead zone does not count yet, and the room shows when it was taken and when it arrived', () => {
    const o = { ...calm.find((x) => x.kind === 'room-thermal' && x.room === peinture)!, takenAtS: 10, receivedAtS: 50 }
    expect(mergeKnowledge(n, true, only(o), 40).rooms[peinture].unknown).toBe(true)
    const k = mergeKnowledge(n, true, only(o), 55).rooms[peinture]
    expect(k.unknown).toBe(false)
    expect(k.takenAtS).toBe(10)
    expect(k.receivedAtS).toBe(50)
  })

  test('a passage found blocked stays blocked until its observation expires, then back to what the plan says', () => {
    const o = calm.length > 0 ? senseIndoor(site, plan, truth(site.rooms.map(() => 20)), 0, params, 1).find((x) => x.kind === 'obstacle') : undefined
    expect(o).toBeDefined()
    expect(mergeKnowledge(n, true, [o!], o!.takenAtS + 1).blockedCells).toEqual(o!.cells)
    expect(mergeKnowledge(n, true, [o!], o!.takenAtS + 20 * v(H.knowledge.confidenceHalfLifeS)).blockedCells).toEqual([])
  })
})

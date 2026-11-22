// Security audit of 2026-11-22 (quick profile, c91771c): the leads the audit could not run for lack of a sandbox, written as tests
// of the behaviour the rules ask for. c91771c did not have this behaviour (the first group reproduced the R13 recall and the
// R3 label on that commit); the fixes of the same branch make them pass.

import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { bearingDeg, droneParams, loopAround, planFlight, plumeOf, type Wind } from '../drone/drone'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { EventGate } from '../hardware/gate'
import type { HardwareEvent, HwStatus } from '../hardware/ingest'
import { applyHardwareEvent, initialHardware } from '../hardware/state'
import { isCopilotEntry, isSnapshot } from '../live/validate'
import { loadPredictor } from '../ml/predict'
import { parseXgb, predict } from '../ml/xgb'
import { applyAction } from '../sim/actions'
import { snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, type SimContext, type SimState } from '../sim/sim'
import { buildSite } from '../site/site'

vi.setConfig({ testTimeout: 120_000 })

const site = buildSite()
const solvents = site.rooms.findIndex((r) => r.id === 'solvants')

function fresh() {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  return { ctx, s }
}
const hot = (room: number, valueC: number, status: HwStatus = 'OBSERVED'): HardwareEvent => ({ kind: 'critical-room', room, roomName: 'x', valueC, thresholdC: 35, status })
const mayday = (): HardwareEvent => ({ kind: 'mayday', status: 'OBSERVED' })
const send = (ctx: SimContext, s: SimState, event: HardwareEvent) => applyAction(ctx, s, { type: 'hardware', event })

describe('R13: a MAYDAY recalls the engaged team, whatever the order of the events', () => {
  test('a NO-GO latched in standby, then the COS engages, then a MAYDAY: the team is turned back and stays out', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 80))
    expect(s.latch.latched).toBe(true)
    expect(s.team.mode).toBe('standby')
    engage(ctx, s)
    // R6: a latched NO-GO never leaves a team engaged; only « Ré-engager (décision COS) » opens the latch.
    expect(s.team.mode).toBe('evacuating')
    send(ctx, s, mayday())
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.some((r) => r.code === 'HARDWARE_MAYDAY')).toBe(true)
    expect(s.team.mode).toBe('evacuating')
  })

  test('the same through the plan-less engage action', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 80))
    applyAction(ctx, s, { type: 'engage-direct' })
    expect(s.team.mode).toBe('evacuating')
    send(ctx, s, mayday())
    expect(s.team.mode).toBe('evacuating')
  })

  test('without a prior latch the recall is unchanged', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    send(ctx, s, mayday())
    expect(s.team.mode).toBe('evacuating')
  })
})

describe('the cylinder pressure is delivered again after a simulation reset', () => {
  const ari = (bar: number): HardwareEvent => ({ kind: 'ari', bar, status: 'OBSERVED' })

  test('the gate forgets the pressure when the simulation state it mirrors is rebuilt', () => {
    const g = new EventGate()
    expect(g.pass(ari(40.0))).toBe(true)
    expect(g.pass(ari(40.1))).toBe(false)
    g.clearAri()
    expect(g.pass(ari(40.1))).toBe(true)
  })

  test('clearing the air does not touch the critical rooms or the mayday memory', () => {
    const g = new EventGate()
    expect(g.pass(hot(2, 50))).toBe(true)
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(true)
    g.clearAri()
    expect(g.pass(hot(2, 50))).toBe(false)
    expect(g.pass({ kind: 'mayday', status: 'OBSERVED' })).toBe(false)
  })
})

describe('R3: a displayed hardware value carries the weakest label of the readings it combines', () => {
  test('a live reading raised by a replay reading is labelled REPLAY', () => {
    const h1 = applyHardwareEvent(initialHardware(), hot(2, 40, 'OBSERVED'), 10)
    const h2 = applyHardwareEvent(h1, hot(2, 48, 'REPLAY'), 20)
    expect(h2.critical).toHaveLength(1)
    expect(h2.critical[0].valueC).toBe(48)
    expect(h2.critical[0].status).toBe('REPLAY')
  })

  test('a replay reading then a lower live reading keeps the weaker label too', () => {
    const h1 = applyHardwareEvent(initialHardware(), hot(2, 48, 'REPLAY'), 10)
    const h2 = applyHardwareEvent(h1, hot(2, 40, 'OBSERVED'), 20)
    expect(h2.critical[0].status).toBe('REPLAY')
  })

  test('two live readings stay OBSERVED', () => {
    const h1 = applyHardwareEvent(initialHardware(), hot(2, 40, 'OBSERVED'), 10)
    const h2 = applyHardwareEvent(h1, hot(2, 44, 'OBSERVED'), 20)
    expect(h2.critical[0].status).toBe('OBSERVED')
  })
})

// ---- hardening found by the same audit ----

describe('R7 fails closed: an unreadable wind refuses the flight', () => {
  const p = droneParams()
  const m = site.marginM
  const loop = loopAround({ x0: m, y0: m, x1: m + 60, y1: m + 40 }, p.loopOffsetM)
  const home = site.engine.at
  const calm: Wind = { speedMs: 1.6, fromDeg: 248, status: 'DERIVED' }

  test('a finite wind still flies', () => {
    expect(planFlight(loop, home, null, calm, p).ok).toBe(true)
  })

  test.each([NaN, Infinity, undefined as unknown as number, null as unknown as number])('wind speed %s is refused', (speedMs) => {
    const f = planFlight(loop, home, null, { ...calm, speedMs }, p)
    expect(f.ok).toBe(false)
    expect(f.reason).toMatch(/vent/)
  })

  test('a missing wind direction is refused too (the plume cone would vanish)', () => {
    const wind = { ...calm, fromDeg: NaN }
    const pl = plumeOf(site.demo.fireAt, wind, p)
    const f = planFlight(loop, home, pl, wind, p)
    expect(f.ok).toBe(false)
    expect(bearingDeg(site.demo.fireAt, home)).toBeTypeOf('number')
  })
})

describe('the live channel drops a message of an unexpected shape', () => {
  const { ctx, s } = fresh()
  const snap = snapshot(ctx, s)

  test('a real snapshot passes', () => {
    expect(isSnapshot(snap)).toBe(true)
  })

  test.each([null, undefined, 3, 'x', [], {}, { t: 0 }, { ...snap, shown: null }, { ...snap, shown: { verdict: 'MAYBE', reasons: [] } }, { ...snap, hardware: undefined }, { ...snap, team: null }, { ...snap, t: NaN }])('malformed snapshot %#', (bad) => {
    expect(isSnapshot(bad)).toBe(false)
  })

  const entry = { id: 'a', t: 1, question: 'q', intent: 'mayday', answer: 'a', path: 'sos', latencyMs: 1, mayday: true }
  test('a copilot entry of the right shape passes', () => {
    expect(isCopilotEntry(entry)).toBe(true)
  })

  test.each([null, {}, { ...entry, id: 3 }, { ...entry, question: { a: 1 } }, { ...entry, answer: 'x'.repeat(5000) }, { ...entry, path: 'telepathie' }, { ...entry, mayday: 'oui' }, { ...entry, t: NaN }])('malformed copilot entry %#', (bad) => {
    expect(isCopilotEntry(bad)).toBe(false)
  })
})

describe('the XGBoost evaluator refuses a damaged tree instead of looping', () => {
  const raw = () => JSON.parse(readFileSync(new URL('../../../ml/model/model-30s.json', import.meta.url), 'utf-8'))

  test('a cycle in a tree throws', () => {
    const j = raw()
    const t = j.learner.gradient_booster.model.trees[0]
    // the root sends both ways back to itself
    t.left_children[0] = 0
    t.right_children[0] = 0
    const model = parseXgb(j)
    expect(() => predict(model, new Array(model.nFeatures).fill(0))).toThrow(/malformed tree/)
  })

  test('a child outside the tree is refused when the model is read', () => {
    const j = raw()
    j.learner.gradient_booster.model.trees[0].left_children[0] = 1_000_000
    expect(() => parseXgb(j)).toThrow(/out of range/)
  })

  test('the shipped model still reads', () => {
    expect(() => parseXgb(raw())).not.toThrow()
  })
})

import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import type { Predictor } from '../ml/predict'
import { buildSite } from '../site/site'
import { engage, initSim, judge, makeContext, observe, reengageTeam, setObjectives, startFire, tick, toggleDoor, teamNow, type SimState } from './sim'

const site = buildSite()

/**
 * A deterministic stand-in for the model: alerts when a neighbour's detectors have failed and the room's own reading
 * climbs fast (contract order: self_slope_30 = 2, self_frac_failed = 5, nb_frac_failed_max = 10).
 */
const stub: Predictor = {
  predict: (row) => {
    const hot = row[10] >= 1 && (row[2] >= 0.8 || row[5] > 0)
    return { p30: hot ? 0.7 : 0.01, p60: hot ? 0.9 : 0.02, tffS: hot ? 45 : 300 }
  },
  thresholds: { p30: 0.5, p60: 0.5 },
  dummy: false,
  trainedOn: 'stub',
}

function demo() {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), stub)
  const s = initSim(ctx, initialDoors(site), 42)
  return { ctx, s }
}

function runUntil(ctx: ReturnType<typeof demo>['ctx'], s: SimState, maxS: number, stop: (s: SimState) => boolean) {
  for (let k = 0; k < maxS && !stop(s); k++) tick(ctx, s)
}

describe('the loop: fire → detectors → model → NO-GO → way out', { timeout: 30_000 }, () => {
  test('engaged GO towards the victim, then NO-GO, evacuation, out above the whistle', () => {
    const { ctx, s } = demo()
    expect(startFire(ctx, s, site.demo.fireAt)).toBe(true)
    runUntil(ctx, s, 40, () => false)
    engage(ctx, s)
    expect(s.team.mode).toBe('engaged')
    expect(s.shown.verdict).toBe('GO')
    expect(s.team.track.length).toBeGreaterThan(10)
    runUntil(ctx, s, 900, (x) => x.team.mode === 'out')
    expect(s.latch.log.some((l) => l.action === 'NO-GO')).toBe(true)
    expect(s.team.mode).toBe('out')
    expect(teamNow(ctx, s).bar).toBeGreaterThan(ctx.air.whistleBar)
  })

  test('R6: once NO-GO, the shown verdict never returns to GO without the COS', () => {
    const { ctx, s } = demo()
    startFire(ctx, s, site.demo.fireAt)
    runUntil(ctx, s, 40, () => false)
    engage(ctx, s)
    runUntil(ctx, s, 600, (x) => x.latch.latched)
    expect(s.latch.latched).toBe(true)
    // Close the door between the store and the booth: conditions may ease, the verdict stays NO-GO.
    toggleDoor(ctx, s, site.doors.findIndex((d) => d.id === 'd-solvants-peinture'))
    for (let k = 0; k < 120; k++) {
      tick(ctx, s)
      expect(s.shown.verdict).toBe('NO-GO')
    }
    reengageTeam(ctx, s)
    expect(s.latch.log.at(-1)).toMatchObject({ action: 'RE-ENGAGE', by: 'COS' })
  })

  test('removing an objective re-plans the route', () => {
    const { ctx, s } = demo()
    setObjectives(ctx, s, ['victime-peinture', 'coupure-tgbt'], 'test')
    engage(ctx, s)
    const before = s.planVersion
    const cells = s.team.track.length
    setObjectives(ctx, s, ['coupure-tgbt'], 'Objectif cabine retiré par le PC')
    expect(s.planVersion).toBeGreaterThan(before)
    expect(s.team.track.length).not.toBe(cells)
    expect(s.notes.at(-1)?.text).toBe('Objectif cabine retiré par le PC')
  })
})

describe('R5 the verdict reads detectors only', { timeout: 30_000 }, () => {
  test('the same readings with a different fire truth give the same verdict', () => {
    const { ctx, s } = demo()
    startFire(ctx, s, site.demo.fireAt)
    runUntil(ctx, s, 40, () => false)
    engage(ctx, s)
    runUntil(ctx, s, 160, () => false)
    const twin: SimState = structuredClone(s)
    for (const r of twin.fire.rooms) {
      r.layerC = 2000
      r.qKw = 1e6
      r.layerZ = 0.1
      r.flashedAt = 0
    }
    for (const x of [s, twin]) {
      observe(ctx, x)
      judge(ctx, x)
    }
    expect(twin.shown).toEqual(s.shown)
    expect(twin.predictions).toEqual(s.predictions)
  })
})

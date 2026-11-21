// The digital twin's logic: the rolling record, the room it follows, and R1 made visible (the verdict without the AI).
// Fixture model: ml/model-v1, which alerts on the paint booth in the video scenario (the shipped v4 does not on our
// simulated readings, so it cannot exercise the alert, the followed room or the lead time).

import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { FEATURE_NAMES } from '../ml/features'
import { loadPredictorFrom } from '../ml/loadModelDir.node'
import { snapshot, type Snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { chainOf } from './chainView'
import { niceTicks, segments } from './chartMath'
import { featureRows, FEATURE_LABELS } from './featureLabels'
import { aiWorsened, leadS, pickFocus, pushSample, sampleOf, withoutAi } from './history'

/** The video scenario (fire at the solvent store, team engaged at 100 s): one snapshot per simulated second. */
function runScenario(untilS: number): Snapshot[] {
  const site = buildSite()
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictorFrom('model-v1'))
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  const out: Snapshot[] = []
  for (let k = 0; k < untilS; k++) {
    if (k === 100) engage(ctx, s)
    tick(ctx, s)
    out.push(snapshot(ctx, s))
  }
  return out
}

describe('the digital twin follows the video scenario', { timeout: 120_000 }, () => {
  const snaps = runScenario(300)
  const booth = buildSite().rooms.findIndex((r) => r.id === 'peinture')

  test('R1 made visible: the AI never improves a verdict, and it said NO-GO before the rules would have', () => {
    let firstAiOnly: number | null = null
    let firstRulesNoGo: number | null = null
    for (const s of snaps) {
      const sample = sampleOf(s)
      // Without the AI the verdict can only be as bad or better: the AI never turns a NO-GO into a GO.
      if (sample.noGoWithoutAi) expect(sample.noGo).toBe(true)
      if (aiWorsened(s) && firstAiOnly === null) firstAiOnly = s.t
      if (sample.noGoWithoutAi && firstRulesNoGo === null) firstRulesNoGo = s.t
    }
    expect(firstAiOnly).not.toBeNull()
    expect(firstRulesNoGo === null || firstAiOnly! < firstRulesNoGo).toBe(true)
  })

  test('the verdict without the AI keeps every reason that is not the AI’s', () => {
    const s = snaps.find((x) => x.computed.reasons.some((r) => r.source === 'ai'))!
    const base = withoutAi(s.computed)
    expect(base.reasons.some((r) => r.source === 'ai')).toBe(false)
    expect(base.reasons.length).toBe(s.computed.reasons.filter((r) => r.source !== 'ai').length)
  })

  test('the followed room is the booth once the model alerts, and a picked room always wins', () => {
    const alerted = snaps.find((x) => x.rooms[booth].pred?.alert)!
    expect(pickFocus(alerted, null)).toBe(booth)
    expect(pickFocus(alerted, 0)).toBe(0)
    expect(pickFocus(alerted, 999)).toBe(booth)
  })

  test('the lead time is known only once both the first alert and the real flashover have happened', () => {
    const before = snaps.find((x) => x.rooms[booth].firstAlertAt !== null && x.rooms[booth].truth.flashedAt === null)!
    expect(leadS(before.rooms[booth])).toBeNull()
    const after = snaps.at(-1)!
    expect(leadS(after.rooms[booth])).toBe(after.rooms[booth].truth.flashedAt! - after.rooms[booth].firstAlertAt!)
  })

  test('the model inputs travel in the snapshot, in contract order, and are detector statistics only', () => {
    const s = snaps.at(-1)!
    expect(s.rooms[booth].features).toHaveLength(FEATURE_NAMES.length)
    const hall = buildSite().rooms.findIndex((r) => !r.flashoverModel)
    expect(s.rooms[hall].features).toBeNull()
    // The booth's detectors have failed by now: its own temperature input is a missing value, not an invented one.
    const i = FEATURE_NAMES.indexOf('self_t_last')
    expect(Number.isNaN(s.rooms[booth].features![i])).toBe(true)
  })

  test('the chain reads the stages from the snapshot', () => {
    const site = buildSite()
    const s = snaps.at(-1)!
    const c = chainOf(site, s, booth)
    expect(c.roomName).toBe(site.rooms[booth].name)
    expect(c.sensors.roomFailed).toBe(c.sensors.roomTotal)
    expect(c.sensors.roomReadingC).toBeNull()
    expect(c.world.flashed).toBeGreaterThan(0)
    expect(c.merge.withAi).toBe(s.computed.verdict)
    expect(Object.values(c.rules.counts).reduce((a, b) => a + b, 0)).toBe(s.rooms.length)
  })
})

describe('the rolling record', () => {
  const snaps = runScenario(30)
  const at = (k: number) => snaps[k]

  test('appends, replaces a sample at the same instant, and starts over when the PC resets', () => {
    let h = pushSample([], at(5))
    h = pushSample(h, at(10))
    expect(h.map((x) => x.t)).toEqual([at(5).t, at(10).t])
    h = pushSample(h, at(10))
    expect(h).toHaveLength(2)
    h = pushSample(h, at(2))
    expect(h.map((x) => x.t)).toEqual([at(2).t])
  })

  test('does not mutate the record it was given', () => {
    const h = pushSample([], at(5))
    const next = pushSample(h, at(10))
    expect(h).toHaveLength(1)
    expect(next).toHaveLength(2)
  })
})

describe('curve maths', () => {
  test('ticks start at 0, step by 1, 2 or 5 × 10^n and reach the maximum', () => {
    expect(niceTicks(700, 4)).toEqual([0, 200, 400, 600, 800])
    expect(niceTicks(300, 4)).toEqual([0, 100, 200, 300])
    expect(niceTicks(100, 4)).toEqual([0, 50, 100])
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(NaN)).toEqual([0])
  })

  test('a gap breaks the line into runs', () => {
    expect(segments([0, 1, 2, 3, 4], [1, 2, null, 4, 5])).toEqual([
      [
        [0, 1],
        [1, 2],
      ],
      [
        [3, 4],
        [4, 5],
      ],
    ])
    expect(segments([0, 1], [null, NaN])).toEqual([])
  })
})

describe('feature labels', () => {
  test('every input of the model has a plain-French label, so a change of contract cannot go unnoticed', () => {
    for (const name of FEATURE_NAMES) expect(FEATURE_LABELS[name], name).toBeDefined()
  })

  test('fractions show as percentages and missing values as a dash with a reason', () => {
    const values = FEATURE_NAMES.map(() => NaN)
    values[FEATURE_NAMES.indexOf('self_frac_failed')] = 0.5
    values[FEATURE_NAMES.indexOf('self_t_last')] = 87.4
    const rows = featureRows(values)
    expect(rows.find((r) => r.name === 'self_frac_failed')!.value).toBe(50)
    expect(rows.find((r) => r.name === 'self_t_last')!.value).toBeCloseTo(87.4)
    const missing = rows.find((r) => r.name === 'self_s_since_fail')!
    expect(missing.value).toBeNull()
    expect(missing.missing).not.toBe('')
  })
})

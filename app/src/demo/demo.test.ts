// The automatic demo plays the video script (CLAUDE.md §9) by itself. These tests replay it on the real simulator, the way
// useDemo does (one decision per snapshot, one snapshot per action), and check the story, the pace and the safety rules.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { snapshot, type Action, type Snapshot } from '../sim/protocol'
import { initSim, makeContext, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { CAPTIONS, captionOf, STEPS, STEPS_WITHOUT_REHEARSAL } from './captions'
import { DEFAULT_OPTIONS, DEMO_SCENES, demoStep, initialDemo, type DemoOptions, type DemoScene } from './script'

interface Row {
  t: number
  acts: string[]
  speed: number
  scene: DemoScene
  done: boolean
  hold: boolean
}

/** Truth fields that must not matter: the script is blind to them (R5). */
function scramble(s: Snapshot): Snapshot {
  const c = structuredClone(s)
  for (const r of c.rooms) r.truth = { layerC: 9999, layerZ: 0, qKw: 1e6, ignitedAt: 0, flashedAt: 1, fireAt: null }
  c.drone.roofC = c.drone.roofC.map(() => 9999)
  return c
}

function play(blind: boolean, opts: DemoOptions = DEFAULT_OPTIONS) {
  const site = buildSite()
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), v(H.sim.seed))
  let st = initialDemo()
  let speed = v(H.demo.paceFastX)
  let realS = 0
  const rows: Row[] = []
  const seen: { t: number; latched: boolean; verdict: string; mode: string; doorOpen: boolean }[] = []
  const decide = (snap: Snapshot): void => {
    const step = demoStep(site, blind ? scramble(snap) : snap, st, opts)
    st = step.state
    speed = step.speed
    seen.push({ t: snap.t, latched: snap.latched, verdict: snap.shown.verdict, mode: snap.team.mode, doorOpen: snap.doorOpen[site.demo.closeDoor] })
    rows.push({ t: snap.t, acts: step.act.map((a: Action) => a.type), speed: step.speed, scene: step.scene, done: step.done, hold: step.hold })
    // One snapshot per action, as the worker answers them; the next decision sees the state after that action.
    for (const a of step.act) {
      applyAction(ctx, s, a)
      decide(snapshot(ctx, s))
    }
    // The simulation waits while the rehearsal replays; then the COS has read the plan and validates it (as useDemo does).
    if (step.hold) {
      realS += v(H.demo.rehearsalHoldS)
      st = { ...st, released: true }
      decide(snapshot(ctx, s))
    }
  }
  for (let k = 0; k < 2000 && !st.done; k++) {
    decide(snapshot(ctx, s))
    if (st.done) break
    realS += 1 / speed
    tick(ctx, s)
  }
  return { site, ctx, s, rows, seen, realS, done: st.done }
}

describe('automatic demo', { timeout: 120_000 }, () => {
  const run = play(false)
  const when = (type: string) => run.rows.filter((r) => r.acts.includes(type)).map((r) => r.t)

  test('plays the whole story in order, then stops by itself', () => {
    const [fire] = when('fire')
    const [drone] = when('drone')
    const [engage] = when('engage')
    const [door] = when('door')
    const [objectives] = when('objectives')
    const [reengage] = when('reengage')
    console.log(
      `demo: fire ${fire}, drone ${drone}, engage ${engage}, door closed ${door}, objectives ${objectives}, re-engage ${reengage}, ` +
        `done at t=${run.rows.at(-1)!.t}, about ${run.realS.toFixed(0)} s of real time`,
    )
    expect(fire).toBe(0)
    expect(drone).toBeGreaterThanOrEqual(v(H.demo.droneAtS))
    expect(engage).toBeGreaterThanOrEqual(v(H.demo.engageAtS))
    expect(engage).toBeGreaterThan(drone)
    expect(door).toBeGreaterThan(engage)
    expect(reengage).toBeGreaterThan(door)
    expect(objectives).toBe(reengage)
    for (const type of ['fire', 'drone', 'engage', 'door', 'reengage']) expect(when(type)).toHaveLength(1)
    expect(run.done).toBe(true)
    expect(run.rows.at(-1)!.t).toBeLessThan(v(H.demo.maxS))
    expect(run.rows.at(-1)!.scene).toBe('end')
  })

  test('the scenes come in the order of the story', () => {
    const order = run.rows.map((r) => DEMO_SCENES.indexOf(r.scene))
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1])
    // Without the rehearsal the indoor drone and the rehearsal scenes never come.
    expect(new Set(run.rows.map((r) => r.scene))).toEqual(new Set(DEMO_SCENES.filter((x) => x !== 'indoor' && x !== 'rehearsal')))
    expect(when('indoor')).toEqual([])
    expect(when('plan-validate')).toEqual([])
  })

  test('about a minute of real time, at speeds the PC offers', () => {
    expect(run.realS).toBeGreaterThan(35)
    expect(run.realS).toBeLessThan(110)
    for (const r of run.rows) expect(v(H.sim.playbackSpeeds)).toContain(r.speed)
    // Slow while the team walks, fast while nothing moves: both paces are used.
    expect(new Set(run.rows.map((r) => r.speed)).size).toBeGreaterThan(1)
  })

  test('R6: from the NO-GO to the re-engagement the verdict stays latched, and the re-engagement is logged as the COS', () => {
    const [door] = when('door')
    const [reengage] = when('reengage')
    // Up to the tick of the re-engagement: the snapshots taken after the COS action are of course open again.
    const between = run.seen.filter((x) => x.t >= door && x.t < reengage)
    expect(between.length).toBeGreaterThan(10)
    for (const x of between) {
      expect(x.latched).toBe(true)
      expect(x.verdict).toBe('NO-GO')
    }
    const snap = snapshot(run.ctx, run.s)
    expect(snap.latchLog.find((l) => l.action === 'RE-ENGAGE')).toMatchObject({ by: 'COS', t: reengage })
  })

  test('the door is closed once, after the NO-GO, and it was open', () => {
    const [door] = when('door')
    const before = run.seen.filter((x) => x.t < door)
    expect(before.at(-1)!.doorOpen).toBe(true)
    expect(run.seen.filter((x) => x.t > door).every((x) => !x.doorOpen)).toBe(true)
  })

  test('the team gets out above the whistle before the PC re-engages it', () => {
    const [reengage] = when('reengage')
    const out = run.seen.find((x) => x.mode === 'out')!
    expect(out.t).toBeLessThan(reengage)
    expect(run.rows.find((r) => r.t === out.t)).toBeDefined()
  })

  test('R5: the decisions do not change when the simulator truth and the thermal image are scrambled', () => {
    const blind = play(true)
    expect(blind.rows).toEqual(run.rows)
  })

  test('R5: the script never names the simulator truth', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./script.ts', import.meta.url), 'utf-8')
    expect(source).not.toMatch(/\.truth\b|roofC/)
  })

  test('captions: one per scene, numbered within the script, and without any verdict word (R2 keeps those on the PC and the tablet)', () => {
    for (const scene of DEMO_SCENES) {
      const c = CAPTIONS[scene]
      expect(c.text.length).toBeGreaterThan(20)
      expect(c.step).toBeGreaterThanOrEqual(1)
      expect(c.step).toBeLessThanOrEqual(STEPS)
      expect(c.text).not.toMatch(/\b(NO-)?GO\b/)
      expect(c.text).not.toMatch(/\d/)
    }
  })

  test('without the rehearsal the story is numbered over six steps, with it over eight', () => {
    for (const scene of DEMO_SCENES) {
      if (scene === 'indoor' || scene === 'rehearsal') continue
      const short = captionOf(scene, false)
      const long = captionOf(scene, true)
      expect(short.steps).toBe(STEPS_WITHOUT_REHEARSAL)
      expect(long.steps).toBe(STEPS)
      expect(short.step).toBeGreaterThanOrEqual(1)
      expect(short.step).toBeLessThanOrEqual(STEPS_WITHOUT_REHEARSAL)
    }
  })
})

// The new step of the script (CLAUDE.md §9, between the outdoor drone and the engagement): the indoor drone, the rehearsal,
// the COS validating the plan. The story that follows does not change.
describe('automatic demo with the rehearsal', { timeout: 120_000 }, () => {
  const opts: DemoOptions = { rehearsal: true, hold: true }
  const run = play(false, opts)
  const when = (type: string) => run.rows.filter((r) => r.acts.includes(type)).map((r) => r.t)

  test('the indoor drone goes in after the outdoor one, the COS validates the plan instead of engaging, then the same story', () => {
    const [drone] = when('drone')
    const [indoor] = when('indoor')
    const [validate] = when('plan-validate')
    const [door] = when('door')
    const [reengage] = when('reengage')
    console.log(`demo with rehearsal: drone ${drone}, indoor ${indoor}, plan validated ${validate}, door ${door}, re-engage ${reengage}, about ${run.realS.toFixed(0)} s of real time`)
    expect(indoor).toBeGreaterThanOrEqual(v(H.demo.indoorAtS))
    expect(indoor).toBeGreaterThan(drone)
    expect(validate).toBeGreaterThanOrEqual(v(H.demo.engageAtS))
    expect(validate - v(H.demo.engageAtS)).toBeLessThanOrEqual(2)
    expect(validate).toBeGreaterThan(indoor)
    expect(when('engage')).toEqual([])
    for (const type of ['fire', 'drone', 'indoor', 'plan-validate', 'door', 'reengage']) expect(when(type)).toHaveLength(1)
    expect(door).toBeGreaterThan(validate)
    expect(reengage).toBeGreaterThan(door)
    expect(run.done).toBe(true)
  })

  test('the rehearsal is rehearsed once, GO, and its scenes come in order', () => {
    const planned = run.rows.filter((r) => r.scene === 'rehearsal')
    expect(planned.length).toBeGreaterThan(0)
    expect(new Set(run.rows.map((r) => r.scene))).toEqual(new Set(DEMO_SCENES))
    const order = run.rows.map((r) => DEMO_SCENES.indexOf(r.scene))
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1])
  })

  test('the rehearsal sequence lasts under 10 s of real time, and the video still fits about a minute', () => {
    expect(v(H.demo.rehearsalHoldS)).toBeLessThanOrEqual(10)
    expect(v(H.demo.rehearsalHoldS)).toBeGreaterThanOrEqual(v(H.rehearsal.playbackS))
    expect(run.realS).toBeGreaterThan(40)
    expect(run.realS).toBeLessThan(80)
    for (const r of run.rows) expect(v(H.sim.playbackSpeeds)).toContain(r.speed)
  })

  test('R6 as before: after the NO-GO the verdict stays latched until the COS re-engages', () => {
    const [door] = when('door')
    const [reengage] = when('reengage')
    const between = run.seen.filter((x) => x.t >= door && x.t < reengage)
    expect(between.length).toBeGreaterThan(10)
    for (const x of between) {
      expect(x.latched).toBe(true)
      expect(x.verdict).toBe('NO-GO')
    }
  })

  test('R5 and R11: scrambling the simulator truth changes no decision, plan included', () => {
    const blind = play(true, opts)
    expect(blind.rows).toEqual(run.rows)
  })

  test('without the hold (the HUD and the tablet never show the rehearsal) the sim does not wait and the story is the same', () => {
    const noHold = play(false, { rehearsal: true, hold: false })
    expect(noHold.rows.every((r) => !r.hold)).toBe(true)
    expect(noHold.realS).toBeLessThan(run.realS)
    expect(noHold.rows.find((r) => r.acts.includes('plan-validate'))?.t).toBe(run.rows.find((r) => r.acts.includes('plan-validate'))?.t)
  })
})

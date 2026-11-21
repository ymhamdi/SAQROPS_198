// The video scenario with the model shipped in ml/model/: the model must flag the paint booth before it flashes over.
// Prints the timeline (useful for the video script and the report).

import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { buildSite } from '../site/site'
import { engage, initSim, launchDrone, makeContext, reengageTeam, setObjectives, startFire, teamNow, tick, toggleDoor } from './sim'

describe('video scenario with the shipped model', { timeout: 60_000 }, () => {
  test('booth alert before the booth flashes over; the team gets out above the whistle', () => {
    const site = buildSite()
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const boothDets = ctx.detByRoom[booth]
    startFire(ctx, s, site.demo.fireAt)
    const events: string[] = []
    let boothFailed: number | null = null
    let firstNoGo: number | null = null
    for (let k = 0; k < 600; k++) {
      if (k === 100) {
        engage(ctx, s)
        events.push(`t=${s.fire.t} engaged, verdict ${s.shown.verdict}`)
      }
      tick(ctx, s)
      if (boothFailed === null && boothDets.every((d) => s.fire.detectors[d].failed)) boothFailed = s.fire.t
      if (firstNoGo === null && s.shown.verdict === 'NO-GO') {
        firstNoGo = s.fire.t
        events.push(`t=${s.fire.t} NO-GO: ${s.shown.reasons.filter((r) => r.severity === 'no-go').map((r) => r.message).join(' | ')}`)
      }
      if (s.team.mode === 'out' && !events.some((e) => e.includes('out'))) events.push(`t=${s.fire.t} team out at ${teamNow(ctx, s).bar.toFixed(0)} bar`)
    }
    const boothFo = s.fire.rooms[booth].flashedAt
    events.push(`booth: first alert ${s.firstAlertAt[booth]}, detectors all failed ${boothFailed}, flashover ${boothFo}`)
    console.log(events.join('\n'))
    expect(s.firstAlertAt[booth]).not.toBeNull()
    expect(boothFo).not.toBeNull()
    expect(s.firstAlertAt[booth]!).toBeLessThan(boothFo!)
    expect(s.team.mode).toBe('out')
    expect(teamNow(ctx, s).bar).toBeGreaterThan(ctx.air.whistleBar)
  })

  test('the whole video script (CLAUDE.md §9), step by step', () => {
    const site = buildSite()
    const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
    const s = initSim(ctx, initialDoors(site), 42)
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const door = site.doors.findIndex((d) => d.id === 'd-solvants-peinture')
    const log: string[] = []
    const run = (until: (x: typeof s) => boolean, max = 600) => {
      for (let k = 0; k < max && !until(s); k++) tick(ctx, s)
    }
    // 1. Fire in the solvent store.
    startFire(ctx, s, site.demo.fireAt)
    // 2. Drone once the detectors locate the fire.
    run((x) => x.fire.t >= 60)
    launchDrone(ctx, s)
    expect(s.drone.status).toBe('flying')
    log.push(`t=${s.fire.t} drone up (${s.drone.reason ?? 'full loop'})`)
    // 3. Team engaged towards the victim then the switchboard: GO.
    run((x) => x.fire.t >= 100)
    engage(ctx, s)
    expect(s.shown.verdict).toBe('GO')
    log.push(`t=${s.fire.t} engaged GO, exit planned at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
    // 4. The model calls the booth's flashover: NO-GO, way out, above the whistle.
    run((x) => x.latch.latched)
    expect(s.shown.reasons.some((r) => r.code === 'FLASHOVER_PREDICTED' && r.severity === 'no-go')).toBe(true)
    expect(s.team.mode).toBe('evacuating')
    expect(teamNow(ctx, s).exitBar!).toBeGreaterThan(ctx.air.whistleBar)
    log.push(`t=${s.fire.t} NO-GO: ${s.shown.reasons[0].message}; exit at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
    // 5. The store ↔ booth door is closed: the predicted delay goes up, the verdict stays NO-GO.
    const before = s.predictions.find((p) => p.room === booth)!
    toggleDoor(ctx, s, door)
    run(() => false, 15)
    const after = s.predictions.find((p) => p.room === booth)!
    expect(after.p60).toBeLessThan(before.p60)
    expect(s.shown.verdict).toBe('NO-GO')
    log.push(`t=${s.fire.t} door closed: booth P60 ${before.p60.toFixed(2)} → ${after.p60.toFixed(2)}, estimate ${before.tffS.toFixed(0)} → ${after.tffS.toFixed(0)} s`)
    run((x) => x.team.mode === 'out')
    log.push(`t=${s.fire.t} team out at ${teamNow(ctx, s).bar.toFixed(0)} bar`)
    // 6. The PC removes the booth objective and re-engages (decision COS): a new route, sent live.
    const version = s.planVersion
    setObjectives(ctx, s, ['coupure-tgbt'], 'Objectif cabine retiré par le PC')
    reengageTeam(ctx, s)
    expect(s.planVersion).toBeGreaterThan(version)
    expect(s.team.mode).toBe('engaged')
    expect(s.latch.log.at(-1)).toMatchObject({ action: 'RE-ENGAGE', by: 'COS' })
    log.push(`t=${s.fire.t} re-engaged to the switchboard: ${s.shown.verdict}, exit planned at ${teamNow(ctx, s).exitBar?.toFixed(0)} bar`)
    console.log(log.join('\n'))
  })

  test('closing the store ↔ booth door after the NO-GO pushes the booth flashover back and the verdict stays NO-GO', () => {
    const site = buildSite()
    const door = site.doors.findIndex((d) => d.id === 'd-solvants-peinture')
    const booth = site.rooms.findIndex((r) => r.id === 'peinture')
    const runWith = (close: boolean) => {
      const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
      const s = initSim(ctx, initialDoors(site), 42)
      startFire(ctx, s, site.demo.fireAt)
      const trace: { t: number; p60: number; tff: number }[] = []
      for (let k = 0; k < 420; k++) {
        if (k === 100) engage(ctx, s)
        if (close && s.latch.latched && s.fire.doorOpen[door]) toggleDoor(ctx, s, door)
        tick(ctx, s)
        const p = s.predictions.find((x) => x.room === booth)!
        trace.push({ t: s.fire.t, p60: p.p60, tff: p.tffS })
        if (close && s.latch.latched) expect(s.shown.verdict).toBe('NO-GO')
      }
      return { s, trace }
    }
    const open = runWith(false)
    const shut = runWith(true)
    const at = (r: typeof open, t: number) => r.trace.find((x) => x.t === t)!
    console.log(`booth flashover: door open ${open.s.fire.rooms[booth].flashedAt}, door closed ${shut.s.fire.rooms[booth].flashedAt}`)
    console.log(`booth prediction at t=225: open p60 ${at(open, 225).p60.toFixed(2)} tff ${at(open, 225).tff.toFixed(0)} s | closed p60 ${at(shut, 225).p60.toFixed(2)} tff ${at(shut, 225).tff.toFixed(0)} s`)
    expect(shut.s.fire.rooms[booth].flashedAt ?? Infinity).toBeGreaterThan(open.s.fire.rooms[booth].flashedAt!)
  })
})

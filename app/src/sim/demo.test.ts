// The video scenario with the model shipped in ml/model/: the model must flag the paint booth before it flashes over.
// Prints the timeline (useful for the video script and the report).

import { describe, expect, test } from 'vitest'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { buildSite } from '../site/site'
import { engage, initSim, makeContext, startFire, teamNow, tick, toggleDoor } from './sim'

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

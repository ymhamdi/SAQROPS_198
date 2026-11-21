// R13 in the simulation: the USB hardware can only AGGRAVATE the verdict. A critical room and a mayday stay until the COS
// re-engages; a reading that falls, a silent sensor, a fuller cylinder never improve anything; the cylinder's live pressure
// can only make the point of no return worse.

import { describe, expect, test, vi } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { applyAction } from '../sim/actions'
import { snapshot } from '../sim/protocol'
import { engage, initSim, makeContext, startFire, tick, type SimContext, type SimState } from '../sim/sim'
import { buildSite } from '../site/site'
import type { HardwareEvent, HwStatus } from './ingest'

// Several of these run minutes of simulated time: give every test of the file room on a slow machine.
vi.setConfig({ testTimeout: 120_000 })

const site = buildSite()
const solvents = site.rooms.findIndex((r) => r.id === 'solvants')
const hall = site.rooms.findIndex((r) => r.id === 'halle')

function fresh(fire = false) {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  if (fire) startFire(ctx, s, site.demo.fireAt)
  return { ctx, s }
}

const hot = (room: number | null, valueC: number, status: HwStatus = 'OBSERVED'): HardwareEvent => ({ kind: 'critical-room', room, roomName: room === null ? 'cave' : 'x', valueC, thresholdC: 35, status })
const mayday = (status: HwStatus = 'OBSERVED'): HardwareEvent => ({ kind: 'mayday', status })
const ari = (bar: number, status: HwStatus = 'OBSERVED'): HardwareEvent => ({ kind: 'ari', bar, status })
const send = (ctx: SimContext, s: SimState, event: HardwareEvent) => applyAction(ctx, s, { type: 'hardware', event })
const run = (ctx: SimContext, s: SimState, n: number) => {
  for (let k = 0; k < n; k++) tick(ctx, s)
}

describe('a room the drone payload read above the threshold', () => {
  test('the verdict goes NO-GO at once, with the specified reason, labelled OBSERVED, and the COS is told', () => {
    const { ctx, s } = fresh()
    expect(s.shown.verdict).toBe('GO')
    send(ctx, s, hot(solvents, 54.2))
    expect(s.shown.verdict).toBe('NO-GO')
    const r = s.shown.reasons.find((x) => x.code === 'HARDWARE_HOT')!
    expect(r.message).toBe('Chaleur anormale relevée par la charge utile — Stockage solvants')
    expect(r).toMatchObject({ severity: 'no-go', source: 'hardware', status: 'OBSERVED', room: solvents })
    expect(s.latch.latched).toBe(true)
    expect(s.notes.some((n) => n.text.includes('chaleur anormale relevée par la charge utile — Stockage solvants (OBSERVED)'))).toBe(true)
  })

  test('a room the site does not know is still a danger for the whole site', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(null, 50))
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.find((x) => x.code === 'HARDWARE_HOT')!.message).toBe('Chaleur anormale relevée par la charge utile — cave')
  })

  test('it stays NO-GO with no new packet at all: a silent sensor never marks anything safe', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 54))
    run(ctx, s, 180)
    expect(s.computed.verdict).toBe('NO-GO')
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.hardware.critical).toHaveLength(1)
  })

  test('the same room read again lower keeps the highest reading: a fall is no downgrade', () => {
    const { ctx, s } = fresh()
    for (const c of [54, 48, 40, 36]) send(ctx, s, hot(solvents, c))
    expect(s.hardware.critical).toHaveLength(1)
    expect(s.hardware.critical[0].valueC).toBe(54)
    expect(s.shown.verdict).toBe('NO-GO')
  })

  test('a recording says REPLAY on the reason, never OBSERVED', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 48, 'REPLAY'))
    expect(s.shown.reasons.find((x) => x.code === 'HARDWARE_HOT')!.status).toBe('REPLAY')
    expect(s.notes.at(-1)!.text).toContain('(REPLAY)')
  })

  test('an engaged team is recalled', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    expect(s.team.mode).toBe('engaged')
    send(ctx, s, hot(hall, 40))
    expect(s.team.mode).toBe('evacuating')
  })
})

describe('the mayday of the binôme', () => {
  test('forces NO-GO with the specified wording and recalls the team', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    send(ctx, s, mayday())
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.shown.reasons.find((x) => x.code === 'HARDWARE_MAYDAY')!.message).toBe('ALERTE MAYDAY matérielle déclenchée par le chef de binôme')
    expect(s.team.mode).toBe('evacuating')
    expect(s.latch.latched).toBe(true)
  })

  test('stays up with no other packet, and a second mayday adds nothing', () => {
    const { ctx, s } = fresh()
    send(ctx, s, mayday())
    send(ctx, s, mayday())
    run(ctx, s, 60)
    expect(s.hardware.mayday).not.toBeNull()
    expect(s.shown.reasons.filter((x) => x.code === 'HARDWARE_MAYDAY')).toHaveLength(1)
    expect(s.shown.verdict).toBe('NO-GO')
  })
})

describe('only the COS clears what the hardware raised (R6, R13)', () => {
  test('nothing the hardware sends brings the verdict back to GO', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 54))
    send(ctx, s, mayday())
    for (const e of [ari(300), ari(250), hot(solvents, 20), ari(300)]) send(ctx, s, e)
    run(ctx, s, 30)
    expect(s.shown.verdict).toBe('NO-GO')
    expect(s.latch.latched).toBe(true)
  })

  test('« Ré-engager (décision COS) » clears the critical rooms and the mayday, and the verdict is GO again', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 54))
    send(ctx, s, mayday())
    applyAction(ctx, s, { type: 'reengage' })
    expect(s.hardware.critical).toEqual([])
    expect(s.hardware.mayday).toBeNull()
    expect(s.shown.verdict).toBe('GO')
    expect(s.latch.log.at(-1)).toMatchObject({ action: 'RE-ENGAGE', by: 'COS' })
    expect(s.notes.some((n) => n.text.includes('dangers remis à zéro par le COS'))).toBe(true)
  })

  test('if the room is still hot, its next packet raises the danger again', () => {
    const { ctx, s } = fresh()
    send(ctx, s, hot(solvents, 54))
    applyAction(ctx, s, { type: 'reengage' })
    expect(s.shown.verdict).toBe('GO')
    send(ctx, s, hot(solvents, 54))
    expect(s.shown.verdict).toBe('NO-GO')
  })
})

describe('R13 as a property: with the hardware the verdict is never better than without', () => {
  test('on random packet sequences over the video scenario, wherever the baseline is NO-GO so is the run with hardware, and dangers never shrink', () => {
    // A small deterministic generator.
    let seed = 7
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      return (seed >>> 0) / 4294967296
    }
    const T = 230
    const base = fresh(true)
    const baseline: string[] = []
    for (let k = 0; k < T; k++) {
      if (k === 100) engage(base.ctx, base.s)
      tick(base.ctx, base.s)
      baseline.push(base.s.computed.verdict)
    }
    expect(baseline).toContain('NO-GO')
    for (let run = 0; run < 3; run++) {
      const { ctx, s } = fresh(true)
      let maxCritical = 0
      let maydaySeen = false
      for (let k = 0; k < T; k++) {
        if (k === 100) engage(ctx, s)
        if (rnd() < 0.3) {
          const pick = rnd()
          const e = pick < 0.4 ? hot(rnd() < 0.5 ? solvents : hall, 20 + rnd() * 40) : pick < 0.5 ? mayday() : ari(Math.round(rnd() * 300))
          // The hardware may also stay silent for long stretches: nothing is sent most ticks.
          send(ctx, s, e)
        }
        tick(ctx, s)
        if (baseline[k] === 'NO-GO') expect(s.computed.verdict, `tick ${k}, run ${run}`).toBe('NO-GO')
        expect(s.hardware.critical.length).toBeGreaterThanOrEqual(maxCritical)
        maxCritical = s.hardware.critical.length
        if (s.hardware.mayday) maydaySeen = true
        if (maydaySeen) expect(s.hardware.mayday).not.toBeNull()
      }
    }
  }, 120_000)
})

describe('the cylinder’s live pressure feeds the point of no return', () => {
  test('before any reading, nothing changes', () => {
    const { ctx, s } = fresh()
    expect(snapshot(ctx, s).hardware).toMatchObject({ ari: null, ariBinding: false, critical: [], mayday: null })
  })

  test('a lower reading is the pressure the team has: the exit and the margin follow', () => {
    const { ctx, s } = fresh()
    const before = snapshot(ctx, s).team
    send(ctx, s, ari(220))
    const after = snapshot(ctx, s)
    expect(after.team.bar).toBeCloseTo(220, 6)
    expect(after.hardware).toMatchObject({ ari: { bar: 220, status: 'OBSERVED' }, ariBinding: true })
    expect(after.team.exitBar!).toBeLessThan(before.exitBar!)
    expect(after.team.pnrMarginBar!).toBeLessThan(before.pnrMarginBar!)
  })

  test('with 110 bar and the mission to do, the air budget fails: NO-GO from the PNR, labelled MODELED (an observed input, a modeled calculation)', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    send(ctx, s, ari(v(H.hardware.sampleAriEndBar)))
    expect(s.shown.verdict).toBe('NO-GO')
    const air = s.shown.reasons.find((r) => r.code === 'AIR_BUDGET' && r.severity === 'no-go')!
    expect(air.status).toBe('MODELED')
  })

  test('the PNR updates as the cylinder goes down: GO at 220 bar, NO-GO at 110', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    send(ctx, s, ari(v(H.hardware.sampleAriStartBar)))
    expect(s.shown.verdict).toBe('GO')
    send(ctx, s, ari(v(H.hardware.sampleAriEndBar)))
    expect(s.shown.verdict).toBe('NO-GO')
  })

  test('a cylinder that reads fuller than the model is ignored: the live pressure can only make things worse', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    run(ctx, s, 90)
    const model = snapshot(ctx, s).team.bar
    expect(model).toBeLessThan(v(H.ari.startBar))
    send(ctx, s, ari(v(H.ari.startBar)))
    const after = snapshot(ctx, s)
    expect(after.team.bar).toBeCloseTo(model, 6)
    expect(after.hardware.ariBinding).toBe(false)
  })

  test('a cylinder that stops reporting keeps its last reading as a floor: the model goes on using air, never refills', () => {
    const { ctx, s } = fresh()
    engage(ctx, s)
    send(ctx, s, ari(250))
    const a = snapshot(ctx, s).team.bar
    run(ctx, s, 60)
    expect(snapshot(ctx, s).team.bar).toBeLessThanOrEqual(a)
  })

  test('a reading of the replay says REPLAY on the pressure it feeds', () => {
    const { ctx, s } = fresh()
    send(ctx, s, ari(200, 'REPLAY'))
    expect(snapshot(ctx, s).hardware.ari).toEqual({ bar: 200, status: 'REPLAY' })
  })
})

// The rehearsal: a plan from what PNR knows, deterministic, and blind to the simulator's truth (R11).

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { defaultFireParams } from '../fire/params'
import { fireSetupOf, initialDoors } from '../fire/siteSetup'
import { loadPredictor } from '../ml/predict'
import { snapshot, type Snapshot } from '../sim/protocol'
import { initSim, launchIndoor, makeContext, startFire, tick } from '../sim/sim'
import { buildSite } from '../site/site'
import { CELL } from '../types'
import { barAt, pointAt, projectRooms, rehearse } from './engine'
import { knownInputOf } from './input'

const site = buildSite()
const booth = site.rooms.findIndex((r) => r.id === 'peinture')
const tgbt = site.rooms.findIndex((r) => r.id === 'tgbt')

let early: Snapshot
let late: Snapshot

beforeAll(() => {
  const ctx = makeContext(site, fireSetupOf(site), defaultFireParams(), loadPredictor())
  const s = initSim(ctx, initialDoors(site), 42)
  startFire(ctx, s, site.demo.fireAt)
  for (let k = 0; k < 220; k++) {
    if (k === 25) launchIndoor(ctx, s)
    tick(ctx, s)
    if (s.fire.t === 90) early = structuredClone(snapshot(ctx, s))
    // Just after the AI flags the booth (214 s in this scenario), before its detectors have all failed (226 s).
    if (s.fire.t === 216) late = structuredClone(snapshot(ctx, s))
  }
}, 60_000)

/** What the simulator really is, scrambled: the rehearsal must not notice. */
function scramble(s: Snapshot): Snapshot {
  const c = structuredClone(s)
  for (const r of c.rooms) r.truth = { layerC: 9999, layerZ: 0, qKw: 1e6, ignitedAt: 0, flashedAt: 1, fireAt: null }
  c.drone.roofC = c.drone.roofC.map(() => 9999)
  return c
}

describe('rehearsal plan', () => {
  test('a mission plan: entry, objectives in order, exit, times and pressures that make sense', () => {
    const plan = rehearse(site, knownInputOf(site, early))
    expect(plan.order.length).toBeGreaterThan(0)
    expect(new Set(plan.order)).toEqual(new Set(site.demo.objectives))
    expect(plan.track[0].cell).toBe(site.doors[site.demo.entry].cells[0])
    expect(site.kind[plan.track.at(-1)!.cell]).toBe(CELL.EXIT)
    const kinds = plan.timeline.map((e) => e.kind)
    expect(kinds[0]).toBe('entry')
    expect(kinds).toContain('objective')
    expect(kinds).toContain('turn-back')
    expect(kinds).toContain('exit')
    for (let i = 1; i < plan.timeline.length; i++) expect(plan.timeline[i].tS).toBeGreaterThanOrEqual(plan.timeline[i - 1].tS)
    // The latest time to turn back is no earlier than the team's last objective: it is a deadline, not the plan.
    const lastObjective = plan.timeline.filter((e) => e.kind === 'objective').at(-1)!
    expect(plan.turnBackS!).toBeGreaterThanOrEqual(lastObjective.tS)
    expect(plan.exitBar).toBeLessThan(v(H.ari.startBar))
    expect(plan.exitBar).toBeGreaterThan(v(H.ari.whistleBar))
    expect(plan.turnBackS).not.toBeNull()
    expect(plan.turnBackS!).toBeGreaterThan(0)
    expect(plan.phases.length).toBe(plan.order.length + 1)
    expect(plan.reasons[0].severity).not.toBe('info')
    expect(plan.status).toBe('SIMULATED')
  })

  test('same knowledge, same plan: it is deterministic', () => {
    expect(rehearse(site, knownInputOf(site, early))).toEqual(rehearse(site, knownInputOf(site, early)))
  })

  test('a fall-back exit other than the planned one is given', () => {
    const plan = rehearse(site, knownInputOf(site, early))
    expect(plan.fallback).not.toBeNull()
    expect(plan.fallback!.name).not.toBe(plan.exitName)
  })

  test('a room behind a door the drone found closed is UNKNOWN on the way: a caution, never a silent GO', () => {
    const plan = rehearse(site, knownInputOf(site, early))
    const phase = plan.phases.find((p) => p.label.includes('Coupure'))!
    expect(phase.reasons.some((r) => r.code === 'ROOM_UNKNOWN' && r.room === tgbt)).toBe(true)
  })

  test('it is fast: under a second, so that it never delays a rescue', () => {
    const input = knownInputOf(site, late)
    rehearse(site, input) // warm-up: the first call compiles the code
    const t0 = performance.now()
    rehearse(site, input)
    expect(performance.now() - t0).toBeLessThan(1000)
  })

  test('with nothing to do it does not fail', () => {
    const input = { ...knownInputOf(site, early), objectives: [] as string[] }
    const plan = rehearse(site, input)
    expect(plan.order).toEqual([])
    expect(plan.turnBackS).toBeNull()
  })
})

describe('rehearsal sees the fire coming', () => {
  test('before the booth is flagged the plan to the victim is a GO; once the AI flags it, the phase through the booth is a NO-GO with its hour', () => {
    const before = rehearse(site, knownInputOf(site, early))
    expect(before.phases.every((p) => p.verdict === 'GO')).toBe(true)
    const input = knownInputOf(site, late)
    expect(input.rooms[booth].pred?.alert).toBe(true)
    const plan = rehearse(site, input)
    expect(plan.closeAtS[booth]).toBeLessThan(Infinity)
    expect(plan.verdict).toBe('NO-GO')
    const risky = plan.phases.find((p) => p.verdict === 'NO-GO')!
    expect(risky.reasons.some((r) => r.code === 'FLASHOVER_PREDICTED' && r.severity === 'no-go' && r.room === booth)).toBe(true)
    expect(risky.reasons.find((r) => r.severity === 'no-go')!.message).toMatch(/T\+\d+:\d\d/)
  })

  test('a passage the drone found blocked is not on the route', () => {
    const base = rehearse(site, knownInputOf(site, early))
    const doorCells = site.doors.find((d) => d.id === 'd-peinture-halle')!.cells
    const input = knownInputOf(site, early)
    const blocked = { ...input, known: { ...input.known, blockedCells: doorCells } }
    const plan = rehearse(site, blocked)
    for (const p of plan.track) expect(doorCells).not.toContain(p.cell)
    expect(base.track.some((p) => doorCells.includes(p.cell))).toBe(true)
  })

  test('the projected rooms show a room as impassable once its hour has come', () => {
    const input = knownInputOf(site, late)
    const plan = rehearse(site, input)
    const t = plan.closeAtS[booth]
    expect(projectRooms(input, plan, t - 1).condition[booth]).not.toBe('failed')
    expect(projectRooms(input, plan, t + 1).condition[booth]).toBe('failed')
  })

  test('replaying the plan: the team advances along the track and the pressure only goes down', () => {
    const plan = rehearse(site, knownInputOf(site, early))
    expect(pointAt(plan, 0)).toBe(0)
    expect(pointAt(plan, 1e6)).toBe(plan.track.length - 1)
    let last = Infinity
    for (let t = 0; t <= plan.track.at(-1)!.arriveS; t += 5) {
      const b = barAt(plan, t)
      expect(b).toBeLessThanOrEqual(last + 1e-9)
      last = b
    }
    expect(barAt(plan, 0)).toBe(v(H.ari.startBar))
  })
})

describe('R11 the rehearsal never reads the simulator’s truth', () => {
  test('scrambling the truth and the thermal image changes nothing in the plan', () => {
    for (const s of [early, late]) expect(rehearse(site, knownInputOf(site, scramble(s)))).toEqual(rehearse(site, knownInputOf(site, s)))
  })

  test('the sources of the rehearsal do not name the truth', () => {
    for (const f of ['engine.ts', 'input.ts']) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf-8')
      expect(text, f).not.toMatch(/\.truth\b|roofC|\.fire\b|FireState|stepFire|fire\/engine/)
    }
  })
})

// The indoor drone: it never opens a door, never enters a room above its temperature limit, keeps its battery point of no
// return, and every observation is stamped (R10). Sensing reads the simulator's truth; planning reads only what PNR knows.

import { describe, expect, test } from 'vitest'
import { H, v } from '../config'
import { initialDoors } from '../fire/siteSetup'
import { confidenceAt, isExpired, receivedBy } from '../knowledge/observation'
import { buildSite } from '../site/site'
import { CELL } from '../types'
import { indoorParams, planIndoor, senseIndoor, wallCrossings, type IndoorKnown, type IndoorTruth } from './indoor'

const site = buildSite()
const params = indoorParams()
const entry = site.demo.entry
const targets = site.demo.objectives.map((id) => ({ id, cell: site.objectives.find((o) => o.id === id)!.cell }))
const roomIndex = (id: string) => site.rooms.findIndex((r) => r.id === id)
const known = (over: Partial<IndoorKnown> = {}): IndoorKnown => ({ doorOpen: initialDoors(site), roomTLastC: site.rooms.map(() => 20), ...over })
const truth = (over: Partial<IndoorTruth> = {}): IndoorTruth => ({ layerC: site.rooms.map(() => 20), doorOpen: initialDoors(site), hidden: [], ambientC: 20, ...over })

describe('indoor drone: where it may fly', () => {
  test('it never goes through a door that is closed, and stops short of the closed TGBT door', () => {
    const plan = planIndoor(site, known(), entry, targets, params)
    expect(plan.ok).toBe(true)
    const doors = initialDoors(site)
    for (const p of plan.points) {
      if (site.kind[p.cell] === CELL.DOOR) expect(doors[site.door[p.cell]]).toBe(true)
    }
    const tgbt = plan.targets.find((t) => t.id === 'coupure-tgbt')!
    expect(tgbt.reached).toBe(false)
    expect(plan.targets.find((t) => t.id === 'victime-peinture')!.reached).toBe(true)
    // The TGBT room itself is never entered.
    expect(plan.points.some((p) => site.room[p.cell] === roomIndex('tgbt'))).toBe(false)
    expect(plan.reason).toMatch(/ne l’ouvre pas/)
  })

  test('with every door shut it still never opens one: it can only look around the hall', () => {
    const shut = site.doors.map((d) => d.isExit)
    const plan = planIndoor(site, known({ doorOpen: shut }), entry, targets, params)
    for (const p of plan.points) expect(site.kind[p.cell] === CELL.DOOR ? shut[site.door[p.cell]] : true).toBe(true)
    expect(plan.points.some((p) => site.room[p.cell] === roomIndex('peinture'))).toBe(false)
  })

  test('it does not enter a room above its temperature limit', () => {
    const solvents = roomIndex('solvants')
    const t = site.rooms.map(() => 20)
    t[solvents] = v(H.droneIndoor.maxAmbientC) + 1
    const plan = planIndoor(site, known({ roomTLastC: t }), entry, [{ id: 'in-store', cell: site.rooms[solvents].cells[10] }], params)
    expect(plan.tooHot).toContain(solvents)
    expect(plan.points.some((p) => site.room[p.cell] === solvents)).toBe(false)
    expect(plan.targets[0].reached).toBe(false)
  })

  test('a room whose detectors have all failed counts as too hot', () => {
    const t = site.rooms.map(() => 20)
    t[roomIndex('peinture')] = NaN
    expect(planIndoor(site, known({ roomTLastC: t }), entry, targets, params).tooHot).toContain(roomIndex('peinture'))
  })
})

describe('indoor drone: battery', () => {
  test('from every point the way home still lands with the reserve, and the flight ends at the entry', () => {
    const plan = planIndoor(site, known(), entry, targets, params)
    for (const p of plan.points) expect(p.marginPct).toBeGreaterThanOrEqual(-1e-6)
    expect(plan.points.at(-1)!.cell).toBe(plan.entryCell)
    expect(plan.points.at(-1)!.batteryPct).toBeGreaterThanOrEqual(v(H.droneIndoor.batteryReservePct) - 1e-6)
    expect(plan.durationS).toBeGreaterThan(20)
    expect(plan.durationS).toBeLessThan(params.enduranceS)
  })

  test('with a small battery the flight is cut at the point of no return and still gets home', () => {
    // A battery the full tour would take past the reserve (it needs 1 / 1.2 = 83 % of it, the reserve is 25 %).
    const full = planIndoor(site, known(), entry, targets, params)
    const small = { ...params, enduranceS: full.durationS * 1.2 }
    const plan = planIndoor(site, known(), entry, targets, small)
    expect(plan.ok).toBe(true)
    expect(plan.reason).toMatch(/point de non-retour batterie/)
    for (const p of plan.points) expect(p.marginPct).toBeGreaterThanOrEqual(-1e-6)
    expect(plan.points.at(-1)!.cell).toBe(plan.entryCell)
    expect(plan.points.at(-1)!.batteryPct).toBeGreaterThanOrEqual(small.enduranceS > 0 ? v(H.droneIndoor.batteryReservePct) - 1e-6 : 0)
  })

  test('a battery too small for any round trip refuses the flight', () => {
    expect(planIndoor(site, known(), entry, targets, { ...params, enduranceS: 5 }).ok).toBe(false)
  })
})

describe('indoor drone: what it reports (R10)', () => {
  const plan = planIndoor(site, known(), entry, targets, params)

  test('every observation carries when, where, how sure, and from what', () => {
    const obs = senseIndoor(site, plan, truth(), 30, params, 7)
    expect(obs.length).toBeGreaterThan(2)
    expect(new Set(obs.map((o) => o.id)).size).toBe(obs.length)
    for (const o of obs) {
      expect(o.takenAtS).toBeGreaterThanOrEqual(30)
      expect(o.receivedAtS).toBeGreaterThanOrEqual(o.takenAtS)
      expect(Number.isFinite(o.at.x) && Number.isFinite(o.at.y)).toBe(true)
      expect(o.confidence).toBeGreaterThan(0)
      expect(o.confidence).toBeLessThanOrEqual(1)
      expect(o.source).toBe('drone-indoor')
      expect(o.status).toBe('SIMULATED')
      expect(o.label.length).toBeGreaterThan(5)
    }
    expect(obs.some((o) => o.kind === 'room-thermal' && o.room === roomIndex('peinture'))).toBe(true)
    expect(obs.some((o) => o.kind === 'door-state' && o.open === false)).toBe(true)
  })

  test('in smoke the confidence is the lower one', () => {
    const hall = roomIndex('halle')
    const layer = site.rooms.map(() => 20)
    layer[hall] = 20 + v(H.progression.smokeAboveAmbientC) + 5
    const obs = senseIndoor(site, plan, truth({ layerC: layer }), 0, params, 7)
    const inHall = obs.find((o) => o.kind === 'room-thermal' && o.room === hall)!
    expect(inHall.confidence).toBe(v(H.knowledge.confidenceSmoke))
    expect(obs.find((o) => o.kind === 'room-thermal' && o.room === roomIndex('peinture'))!.confidence).toBe(v(H.knowledge.confidenceClear))
  })

  test('it reports a door it saw closed, never opening it, and a room it could see into but not enter', () => {
    const solvents = roomIndex('solvants')
    const layer = site.rooms.map(() => 20)
    layer[solvents] = 400
    const t = site.rooms.map(() => 20)
    t[solvents] = 400
    const doors = initialDoors(site)
    const viaPeinture = site.doors.findIndex((d) => d.id === 'd-solvants-peinture')
    expect(doors[viaPeinture]).toBe(true)
    const p = planIndoor(site, known({ roomTLastC: t }), entry, targets, params)
    const obs = senseIndoor(site, p, truth({ layerC: layer }), 0, params, 7)
    const hot = obs.find((o) => o.kind === 'too-hot' && o.room === solvents)
    expect(hot?.valueC).toBeGreaterThan(v(H.droneIndoor.maxAmbientC))
    expect(p.points.some((q) => site.room[q.cell] === solvents)).toBe(false)
  })

  test('an obstacle the plan does not show is found only when the drone passes near it', () => {
    const near = site.objectives.find((o) => o.id === 'victime-peinture')!.cell
    const far = site.rooms[roomIndex('bureaux')].cells[0]
    const seen = senseIndoor(site, plan, truth({ hidden: [{ id: 'rack', name: 'rack effondré', cells: [near] }] }), 0, params, 7)
    expect(seen.find((o) => o.kind === 'obstacle')?.cells).toEqual([near])
    const unseen = senseIndoor(site, plan, truth({ hidden: [{ id: 'rack', name: 'rack effondré', cells: [far] }] }), 0, params, 7)
    expect(unseen.some((o) => o.kind === 'obstacle')).toBe(false)
  })

  test('sensor noise is repeatable for a seed', () => {
    const a = senseIndoor(site, plan, truth(), 0, params, 3)
    const b = senseIndoor(site, plan, truth(), 0, params, 3)
    expect(a).toEqual(b)
  })

  test('in a radio dead zone an observation arrives only when the link is back', () => {
    const open = senseIndoor(site, plan, truth(), 0, params, 7)
    expect(open.every((o) => o.receivedAtS === o.takenAtS)).toBe(true)
    // One wall is enough to cut the link: everything taken inside the building waits for the way out.
    const poor = senseIndoor(site, plan, truth(), 0, { ...params, deadZoneWalls: 1 }, 7)
    expect(poor.some((o) => o.receivedAtS > o.takenAtS)).toBe(true)
    for (const o of poor) expect(o.receivedAtS).toBeGreaterThanOrEqual(o.takenAtS)
    expect(wallCrossings(site, site.engine.at, site.rooms[roomIndex('bureaux')].centre)).toBeGreaterThanOrEqual(1)
  })
})

describe('observations age (R10)', () => {
  const plan = planIndoor(site, known(), entry, targets, params)
  const o = senseIndoor(site, plan, truth(), 0, params, 7)[0]

  test('confidence halves every half-life and the observation expires', () => {
    const half = v(H.knowledge.confidenceHalfLifeS)
    expect(confidenceAt(o, o.takenAtS)).toBeCloseTo(o.confidence, 9)
    expect(confidenceAt(o, o.takenAtS + half)).toBeCloseTo(o.confidence / 2, 9)
    expect(isExpired(o, o.takenAtS)).toBe(false)
    expect(isExpired(o, o.takenAtS + 20 * half)).toBe(true)
  })

  test('an observation inside a dead zone is not visible before it is received', () => {
    const delayed = { ...o, takenAtS: 10, receivedAtS: 40 }
    expect(receivedBy([delayed], 39)).toHaveLength(0)
    expect(receivedBy([delayed], 40)).toHaveLength(1)
  })
})

import { describe, expect, test } from 'vitest'
import { DEFAULT_ROUTE_PARAMS, prepareGrid, ROVER_ROUTE_PARAMS } from './cost'
import { annotateRover, nearestRoverCell, planRide, planRoute, type Leg } from './route'
import { walkHomeField } from './search'
import { routeStats, safetyS } from '../stats/stats'
import { evaluateEva } from '../stats/goNoGo'
import { commsGaps } from '../stats/comms'
import { gridFrom, idx } from '../testing/grids'
import type { Conditions } from '../types'

// 600 m of flat open ground (2 m cells), with a rocky patch (walkable, not drivable) in rows 0-3, columns 140-160.
const rows = Array.from({ length: 9 }, (_, r) => (r <= 3 ? '.'.repeat(140) + 'b'.repeat(21) + '.'.repeat(139) : '.'.repeat(300)))
const g = gridFrom(rows)
const walk = prepareGrid(g, DEFAULT_ROUTE_PARAMS)
const drive = prepareGrid(g, ROVER_ROUTE_PARAMS)
const base = idx(g, 4, 0)
const reach = walkHomeField(drive, base)
const BOARD = 120
// Two stops 10 m apart near the habitat, then one 550 m away.
const near1 = idx(g, 4, 10)
const near2 = idx(g, 4, 15)
const far = idx(g, 4, 290)
const plan = [base, near1, near2, far, base]

const rodeOn = (l: Leg) => l.ride!.some((x) => x === 1)

describe('rover-assisted Marswalk', () => {
  test('the rover parks at the drivable cell nearest a stop', () => {
    const rocky = idx(g, 1, 150)
    expect(nearestRoverCell(drive, reach, rocky, 100)).toBe(idx(g, 4, 150))
    expect(nearestRoverCell(drive, reach, rocky, 5)).toBe(-1) // nothing drivable within 5 m
  })

  test('far-apart stops are ridden between, close ones walked', () => {
    const r = planRide(walk, drive, reach, plan, 400, BOARD)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.legs.map((l) => [l.from, l.to])).toEqual([[base, near1], [near1, near2], [near2, far], [far, base]])
    expect(rodeOn(r.legs[1])).toBe(false) // 10 m: walked
    expect(rodeOn(r.legs[2])).toBe(true) // 550 m between two middle stops: ridden
    expect(rodeOn(r.legs[3])).toBe(true) // and home
    expect(r.ride!.riddenLegs).toBeGreaterThanOrEqual(2)
  })

  test('the rover never moves without the crew and ends at the habitat', () => {
    const r = planRide(walk, drive, reach, plan, 400, BOARD)
    if (!r.ok) throw new Error('no route')
    let at = base
    for (const l of r.legs) {
      expect(l.cells.length).toBe(l.ride!.length)
      expect(l.cells.length).toBe(l.rover!.length)
      for (let k = 0; k < l.cells.length; k++) {
        if (l.ride![k] === 1) {
          // a driven step starts where the rover is (the crew is aboard)
          if (l.ride![k - 1] !== 1) expect(l.cells[k - 1]).toBe(at)
          at = l.cells[k]
          expect(l.rover![k]).toBe(-1)
        } else if (l.rover![k] >= 0) {
          expect(l.rover![k]).toBe(at)
        }
      }
    }
    expect(at).toBe(base)
  })

  test('riding is timed at rover speed and beats walking the same stops', () => {
    const ride = planRide(walk, drive, reach, plan, 400, BOARD)
    const foot = planRoute(walk, plan)
    if (!ride.ok || !foot.ok) throw new Error('no route')
    const a = routeStats(walk, ride.legs, 0, drive)
    const b = routeStats(walk, foot.legs, 0)
    expect(a.rideS).toBeGreaterThan(0)
    expect(a.walkS + a.rideS).toBeCloseTo(a.totalS, 6)
    expect(a.totalS).toBeLessThan(b.totalS - 300)
    expect(b.rideS).toBe(0)
  })

  test('a stop the rover cannot get near is walked to; the plan still works', () => {
    const rocky = idx(g, 1, 150)
    const r = planRide(walk, drive, reach, [base, rocky, far, base], 5, BOARD)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // nothing to park by the rocky stop, so the crew never rides into it: the leg into it ends on foot
    expect(r.legs[0].ride!.at(-1)).toBe(0)
    expect(r.legs[0].rover!.at(-1)).not.toBe(rocky)
  })

  test('safety uses the parked rover: emergency times, radio contact, point of no return', () => {
    const planned = planRide(walk, drive, reach, plan, 400, BOARD)
    if (!planned.ok) throw new Error('no route')
    const legs = annotateRover(walk, planned.legs, 3, 1.8)
    const st = routeStats(walk, legs, 0, drive)
    const home = walkHomeField(walk, base)
    // the rover drives right up to the far stop (it is drivable); the habitat is 580 m away
    const atFar = st.track.find((t) => t.cell === far)!
    expect(atFar.toRoverS).toBe(0)
    expect(safetyS(home, atFar)).toBe(0)
    expect(home[far]).toBeGreaterThan(600)
    // walked points: time to the rover is a real walk time, never more than to the habitat by way of the rover
    for (const t of st.track) if (!t.riding) expect(Number.isFinite(t.toRoverS!)).toBe(true)
    // radio: the habitat sees nothing, the rover on flat ground sees everything
    const blind = new Uint8Array(g.width * g.height)
    expect(commsGaps(st.track, blind).outS).toBe(0)
    const day = Array.from({ length: 25 }, (_, h) => ({
      time: new Date(Date.UTC(2026, 0, 1, h)).toISOString(), tempC: -50, pressurePa: 700, dustTau: 0.5,
      sunElevationDeg: 45, radiationAlert: false, source: 't', status: 'MOCK',
    })) as Conditions[]
    const v = evaluateEva({ prepared: walk, route: { ...planned, legs }, walkHome: home, startTime: day[1].time, conditions: day, dwellS: 0, drive })
    expect(v.stats!.rideS).toBeGreaterThan(0)
    expect(v.reasons.find((r) => r.code === 'POINT_OF_NO_RETURN')?.severity).toBe('info')
  })
})

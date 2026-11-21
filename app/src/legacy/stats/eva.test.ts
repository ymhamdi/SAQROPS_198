import { describe, expect, test } from 'vitest'
import { prepareGrid } from '../route/cost'
import { planLoop } from '../route/route'
import { gridFrom } from '../testing/grids'
import type { Conditions, PovImage, ScienceTarget, Waypoint } from '../types'
import { buildTimeline, compassPoint, currentLegEnd, initialBearingDeg, nearestPov, povsNear, positionAt, roverSolsAt, withSimulatedStorm } from './eva'
import { routeStats } from './stats'

function loop() {
  const g = gridFrom(['.........'])
  const p = prepareGrid(g)
  const r = planLoop(p, 0, [8])
  if (!r.ok) throw new Error('no route')
  return routeStats(p, r.legs, 600)
}

describe('positionAt', () => {
  test('starts at the habitat, dwells at the stop, ends back home', () => {
    const s = loop()
    const stop = s.track.findIndex((t) => t.departS > t.arriveS)
    expect(positionAt(s.track, 0)).toMatchObject({ index: 0, atStop: false, nextStation: 1 })
    const mid = (s.track[stop].arriveS + s.track[stop].departS) / 2
    expect(positionAt(s.track, mid)).toMatchObject({ index: stop, atStop: true, nextStation: 1 })
    const after = positionAt(s.track, s.track[stop].departS + 1)
    expect(after.atStop).toBe(false)
    expect(after.nextStation).toBe(2)
    expect(positionAt(s.track, s.totalS + 100).index).toBe(s.track.length - 1)
  })

  test('interpolates between cells while walking', () => {
    const s = loop()
    const t = (s.track[1].arriveS + s.track[2].arriveS) / 2
    const p = positionAt(s.track, t)
    expect(p.lon).toBeGreaterThan(s.track[1].lon)
    expect(p.lon).toBeLessThan(s.track[2].lon)
  })
})

describe('bearing', () => {
  test('cardinal directions', () => {
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6)
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6)
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6)
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 6)
    expect([0, 44, 46, 180, 315, 359].map(compassPoint)).toEqual(['N', 'NE', 'NE', 'S', 'NW', 'N'])
  })
})

describe('buildTimeline', () => {
  test('both crew walk each leg with the rover; instruments split between them at a science stop', () => {
    const s = loop()
    const stops: Waypoint[] = [{ id: 't', lat: 0, lon: 0, kind: 'science', name: 'Ridge' }]
    const targets = [{ id: 't', instrumentsNeeded: ['camera', 'rock hammer', 'sample bags'] }] as ScienceTarget[]
    const tl = buildTimeline(s, stops, targets)
    expect(tl.filter((x) => x.kind === 'walk')).toHaveLength(4)
    expect(tl.find((x) => x.actor === 'EV1' && x.kind === 'task')?.label).toBe('Camera, sample bags')
    expect(tl.find((x) => x.actor === 'EV2' && x.kind === 'task')?.label).toBe('Rock hammer')
    expect(tl.find((x) => x.actor === 'Rover' && x.kind === 'parked')?.label).toContain('safe haven')
    expect(Math.max(...tl.map((x) => x.endS))).toBeCloseTo(s.totalS, 9)
  })
})

test('buildTimeline survives a zero-length leg (two stops on the same cell)', () => {
  const g = gridFrom(['.....'])
  const p = prepareGrid(g)
  const r = planLoop(p, 0, [4, 4])
  if (!r.ok) throw new Error('no route')
  const s = routeStats(p, r.legs, 600)
  const stops: Waypoint[] = [
    { id: 'a', lat: 0, lon: 0, kind: 'via', name: 'A' },
    { id: 'b', lat: 0, lon: 0, kind: 'via', name: 'B' },
  ]
  expect(() => buildTimeline(s, stops, [])).not.toThrow()
})

describe('nearestPov / withSimulatedStorm', () => {
  test('nearest panorama within range only', () => {
    const povs = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }] as PovImage[]
    expect(nearestPov(povs, 0, 0.0009)).toBe(povs[1])
    expect(nearestPov(povs, 1, 1)).toBeNull()
  })

  test('only the images from the nearest camera spot, in file order', () => {
    // a: a neighbouring stop ~6 m away; b and c: taken from the same spot as each other, at the stop
    const a = { lat: 0, lon: 0.0001, url: 'a' }, b = { lat: 0, lon: 0, url: 'b' }, c = { lat: 0, lon: 0, url: 'c' }
    const far = { lat: 0, lon: 0.01, url: 'far' }
    expect(povsNear([a, b, far, c] as PovImage[], 0, 0).map((p) => p.url)).toEqual(['b', 'c'])
    expect(povsNear([a, b, c] as PovImage[], 0, 0.0001).map((p) => p.url)).toEqual(['a'])
    expect(povsNear([far] as PovImage[], 0, 0)).toEqual([])
  })

  test('storm raises the alert across the EVA window only', () => {
    const c = [0, 1, 2, 5].map((h) => ({ time: new Date(h * 3600_000).toISOString(), radiationAlert: false }) as Conditions)
    const out = withSimulatedStorm(c, 2 * 3600_000, 3 * 3600_000)
    expect(out.map((x) => x.radiationAlert)).toEqual([false, true, true, false])
    expect(c.every((x) => !x.radiationAlert)).toBe(true)
  })
})

test('crewAtStop: the rover is staged at one stop and stands by elsewhere', async () => {
  const { crewAtStop } = await import('./eva')
  const stop: Waypoint = { id: 's', lat: 0, lon: 0, kind: 'science', name: 'Ridge' }
  expect(crewAtStop(stop, [], 'Ridge').rover).toContain('Staged here')
  expect(crewAtStop(stop, [], 'Scarp').rover).toBe('Standing by at Scarp as safe haven')
  expect(crewAtStop(stop, [], null).rover).toBe('Standing by at the habitat')
})

describe('roverSolsAt', () => {
  const points = [
    { sol: 100, lat: 0, lon: 0 },
    { sol: 105, lat: 0, lon: 0.001 }, // ~59 m east
    { sol: 140, lat: 0, lon: 0.01 }, // ~590 m east
  ]
  test('first to last sol of the traverse points near the stops', () => {
    expect(roverSolsAt(points, [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }])).toEqual({ first: 100, last: 140, sols: 41, earthDays: 42, stopsMatched: 2 })
  })
  test('one stop on the traverse', () => {
    expect(roverSolsAt(points, [{ lat: 0, lon: 0.001 }, { lat: 1, lon: 1 }])).toMatchObject({ first: 105, last: 105, sols: 1, stopsMatched: 1 })
  })
  test('no stop on the traverse', () => {
    expect(roverSolsAt(points, [{ lat: 1, lon: 1 }])).toBeNull()
  })
})


describe('the leg being walked', () => {
  // legs: 0 = points 0-3 (stop at 3), 1 = points 4-6 (stop at 6), 2 = points 7-9 (home at 9)
  const legs = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]
  const track = legs.map((leg) => ({ leg })) as Parameters<typeof currentLegEnd>[0]
  test('ends at the next stop, mid-leg and while working at a stop', () => {
    expect(currentLegEnd(track, 0)).toBe(3) // leaving the habitat
    expect(currentLegEnd(track, 2)).toBe(3)
    expect(currentLegEnd(track, 3)).toBe(6) // at stop 1: the next leg is the one ahead
    expect(currentLegEnd(track, 5)).toBe(6)
    expect(currentLegEnd(track, 8)).toBe(9)
    expect(currentLegEnd(track, 9)).toBe(9) // home
  })
  test('carries on through via points to the next real stop', () => {
    const viaAtEndOfLeg0 = (leg: number) => leg !== 0
    expect(currentLegEnd(track, 1, viaAtEndOfLeg0)).toBe(6)
    expect(currentLegEnd(track, 3, viaAtEndOfLeg0)).toBe(6)
    expect(currentLegEnd(track, 5, () => false)).toBe(9) // nothing but via points: home
  })
})

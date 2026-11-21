import { describe, expect, test } from 'vitest'
import { prepareGrid } from '../route/cost'
import { cellAt, cellCenter, planLoop } from '../route/route'
import { findPath, findPathToAny } from '../route/search'
import { positionAt } from '../stats/eva'
import { routeStats, sphericalDistanceM } from '../stats/stats'
import { gridFrom, idx, TEST_CELL_M as CELL } from '../testing/grids'
import { activeDetour, planDetour, rejoinCandidates, walkStateAt, walkTotalS, withDetour, type Detour } from './detour'
import { getRealPosition, offsetPoint, simulateFix } from './getRealPosition'

/** Repeatable "random" numbers for the tests. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const open = (w: number, h: number) => Array.from({ length: h }, () => '.'.repeat(w))

describe('findPathToAny', () => {
  test('walks to the quickest goal, not the first listed', () => {
    const g = gridFrom(open(9, 3))
    const p = prepareGrid(g)
    const path = findPathToAny(p, idx(g, 1, 4), [idx(g, 1, 0), idx(g, 1, 6)])!
    expect(path.goal).toBe(idx(g, 1, 6))
    expect(path.cells[0]).toBe(idx(g, 1, 4))
    expect(path.cells.at(-1)).toBe(idx(g, 1, 6))
    expect(path.timeS).toBeCloseTo(findPath(p, idx(g, 1, 4), idx(g, 1, 6))!.timeS, 9)
  })

  test('goes around no-go ground', () => {
    const g = gridFrom([
      '.....', //
      '.###.',
      '.....',
    ])
    const path = findPathToAny(prepareGrid(g), idx(g, 0, 2), [idx(g, 2, 2)])!
    expect(path.cells.some((c) => g.terrainClass[c] === 3)).toBe(false)
  })

  test('start on a goal → zero-length path; unreachable or impassable → null', () => {
    const g = gridFrom(['..#..'])
    const p = prepareGrid(g)
    expect(findPathToAny(p, 0, [0, 1])).toEqual({ cells: [0], timeS: 0, goal: 0 })
    expect(findPathToAny(p, 0, [4])).toBeNull()
    expect(findPathToAny(p, 2, [0])).toBeNull()
    expect(findPathToAny(p, 0, [])).toBeNull()
  })
})

describe('simulated position fix', () => {
  test('lands on walkable ground within the drift range, labelled MOCK', () => {
    const g = gridFrom(open(60, 60))
    const p = prepareGrid(g)
    const estimate = cellCenter(g, idx(g, 30, 30))
    const random = seeded(7)
    for (let i = 0; i < 25; i++) {
      const fix = simulateFix({ prepared: p, estimate, random, offsetM: [12, 35] })!
      expect(fix.status).toBe('MOCK')
      // The fix snaps to a cell centre, so allow half a cell diagonal either side of the range.
      expect(fix.offsetM).toBeGreaterThanOrEqual(12 - CELL)
      expect(fix.offsetM).toBeLessThanOrEqual(35 + CELL)
      expect(fix.cell).toBe(cellAt(g, fix.lat, fix.lon))
      expect(fix.offsetM).toBeCloseTo(sphericalDistanceM(estimate, fix), 6)
    }
  })

  test('with a walking direction, the drift goes sideways (within 30° of perpendicular)', () => {
    const g = gridFrom(open(60, 60))
    const p = prepareGrid(g)
    const estimate = cellCenter(g, idx(g, 30, 30))
    const random = seeded(11)
    for (let i = 0; i < 25; i++) {
      const fix = simulateFix({ prepared: p, estimate, random, offsetM: [15, 25], headingDeg: 0 })! // walking north
      const fromNorth = Math.min(fix.bearingDeg, 360 - fix.bearingDeg) // 0..180
      // Cell snapping can turn the bearing by up to ~atan(1/7) ≈ 8° at 15 m with 2 m cells.
      expect(fromNorth).toBeGreaterThanOrEqual(60 - 8)
      expect(fromNorth).toBeLessThanOrEqual(120 + 8)
    }
  })

  test('respects the accept test, and falls back to the planned cell when boxed in', () => {
    const g = gridFrom(open(60, 60))
    const p = prepareGrid(g)
    const estimate = cellCenter(g, idx(g, 30, 30))
    const east = simulateFix({ prepared: p, estimate, random: seeded(3), accept: (c) => c % g.width > 30 })!
    expect(east.cell % g.width).toBeGreaterThan(30)
    const boxed = simulateFix({ prepared: p, estimate, random: seeded(3), accept: (c) => c === idx(g, 30, 30) })!
    expect(boxed.cell).toBe(idx(g, 30, 30))
    expect(boxed.offsetM).toBeCloseTo(sphericalDistanceM(estimate, cellCenter(g, idx(g, 30, 30))), 9)
    expect(simulateFix({ prepared: p, estimate, random: seeded(3), accept: () => false })).toBeNull()
  })

  test('getRealPosition resolves with the simulated fix, or rejects when there is none', async () => {
    const g = gridFrom(open(40, 40))
    const p = prepareGrid(g)
    const estimate = cellCenter(g, idx(g, 20, 20))
    const fix = await getRealPosition({ prepared: p, estimate, random: seeded(1), delayMs: 0 })
    expect(fix.status).toBe('MOCK')
    await expect(getRealPosition({ prepared: p, estimate, delayMs: 0, accept: () => false })).rejects.toThrow()
  })

  test('offsetPoint moves the right distance and direction', () => {
    const from = { lat: -4.8, lon: 137.38 }
    const q = offsetPoint(from, 30, 90)
    expect(sphericalDistanceM(from, q)).toBeCloseTo(30, 1)
    expect(q.lon).toBeGreaterThan(from.lon)
    expect(q.lat).toBeCloseTo(from.lat, 7)
  })
})

describe('detour back to the plan', () => {
  // A straight walk west → east along row 5 to a stop at column 30, then home: a loop on open ground.
  const g = gridFrom(open(40, 11))
  const p = prepareGrid(g)
  const home = idx(g, 5, 2)
  const stop = idx(g, 5, 30)
  const route = planLoop(p, home, [stop])
  if (!route.ok) throw new Error('test route failed')
  const stats = routeStats(p, route.legs, 600)
  const track = stats.track

  /** The crew 1/4 of the way along the first leg, believed on the plan; the fix puts them 4 rows north of it. */
  function scenario() {
    const t = track.find((q) => q.cell === idx(g, 5, 10))!.arriveS
    const state = walkStateAt(track, [], t)
    const fixCell = idx(g, 1, 12)
    const d = planDetour(p, track, state, t, { cell: fixCell })!
    return { t, state, fixCell, d }
  }

  test('rejoins ahead on the current leg, never behind and never past the next stop', () => {
    const { state, d } = scenario()
    const candidates = rejoinCandidates(track, state)
    expect(candidates[0]).toBe(state.index + 1)
    expect(candidates.every((i) => track[i].leg === 0)).toBe(true)
    expect(d.rejoinIndex).toBeGreaterThan(state.index)
    expect(track[d.rejoinIndex].leg).toBe(0)
    expect(d.cells[0]).toBe(idx(g, 1, 12))
    expect(d.cells.at(-1)).toBe(track[d.rejoinIndex].cell)
  })

  test('the clock: plan before the fix, the detour after it, then the plan shifted by the detour', () => {
    const { t, d } = scenario()
    const detours = [d]
    // Before the fix: exactly the plan.
    expect(walkStateAt(track, detours, t - 1)).toMatchObject({ onDetour: false, detour: null, ...positionAt(track, t - 1) })
    // At the fix: standing on the fixed position.
    const at = walkStateAt(track, detours, t)
    expect(at.onDetour).toBe(true)
    expect(at.cell).toBe(idx(g, 1, 12))
    expect(at.nextStation).toBe(1)
    // Halfway along the detour: between its ends.
    const mid = walkStateAt(track, detours, t + d.timeS / 2)
    expect(mid.onDetour).toBe(true)
    // After rejoining: the plan, as if it had reached the rejoin point at t + detour time.
    const later = t + d.timeS + 120
    const after = walkStateAt(track, detours, later)
    const plan = positionAt(track, d.rejoinPlanS + 120)
    expect(after.onDetour).toBe(false)
    expect(after.lat).toBeCloseTo(plan.lat, 12)
    expect(after.lon).toBeCloseTo(plan.lon, 12)
    // The walk now ends later (or earlier) by exactly the shift.
    expect(d.shiftS).toBeCloseTo(t + d.timeS - track[d.rejoinIndex].arriveS, 9)
    expect(walkTotalS(stats.totalS, detours)).toBeCloseTo(stats.totalS + d.shiftS, 9)
  })

  test('the detour time is the walking time of its path', () => {
    const { fixCell, d } = scenario()
    expect(d.timeS).toBeCloseTo(findPath(p, fixCell, track[d.rejoinIndex].cell)!.timeS, 6)
    expect(d.times).toHaveLength(d.cells.length)
    expect(d.distanceM).toBeGreaterThan(0)
  })

  test('a fix taken earlier replaces the detours after it; the latest one applies', () => {
    const { t, d } = scenario()
    const earlier: Detour = { ...d, atT: t - 100 }
    const kept = withDetour([d], earlier)
    expect(kept).toEqual([earlier])
    const later: Detour = { ...d, atT: t + 500 }
    expect(withDetour([d], later)).toEqual([d, later])
    expect(activeDetour([d, later], t + 10)).toBe(d)
    expect(activeDetour([d, later], t + 600)).toBe(later)
    expect(activeDetour([d, later], t - 10)).toBeNull()
  })

  test('no way back to the route → null', () => {
    const walled = gridFrom([
      '..........', //
      '##########',
      '..........',
    ])
    const wp = prepareGrid(walled)
    const r = planLoop(wp, idx(walled, 2, 0), [idx(walled, 2, 9)])
    if (!r.ok) throw new Error('test route failed')
    const tr = routeStats(wp, r.legs, 0).track
    const state = walkStateAt(tr, [], 1)
    expect(planDetour(wp, tr, state, 1, { cell: idx(walled, 0, 5) })).toBeNull()
  })
})

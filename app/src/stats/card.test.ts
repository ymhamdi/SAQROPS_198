import { describe, expect, test } from 'vitest'
import { DEFAULT_ROUTE_PARAMS, prepareGrid } from '../route/cost'
import { cellCenter, planLoop } from '../route/route'
import { gridFrom } from '../testing/grids'
import type { ScienceTarget, Waypoint } from '../types'
import { cardStations, cropAround, farthestFromSafety, hillshadePixels, marsClockAt } from './card'
import { routeStats } from './stats'

const row = '.'.repeat(10) + 's'.repeat(20) + '.'.repeat(10)

function walk() {
  const grid = gridFrom([row])
  const p = prepareGrid(grid)
  const r = planLoop(p, 0, [39])
  if (!r.ok) throw new Error('no route')
  const stats = routeStats(p, r.legs, 600)
  const at = (cell: number, w: Omit<Waypoint, 'lat' | 'lon'>): Waypoint => ({ ...cellCenter(grid, cell), ...w })
  const base = at(0, { id: 'base', kind: 'base', name: 'Habitat' })
  const stop = at(39, { id: 'vein', kind: 'science', name: 'Vein' })
  const target: ScienceTarget = { id: 'vein', lat: stop.lat, lon: stop.lon, name: 'Vein', why: 'Fluids', instrumentsNeeded: ['hand lens', 'drill'], source: 't', status: 'MOCK' }
  return { grid, stats, stations: [base, stop, base], targets: [target] }
}

describe('Marswalk card', () => {
  test('one row per station with times, the next leg, its hazards and the crew plan', () => {
    const { grid, stats, stations, targets } = walk()
    const rows = cardStations(stats, stations, targets, grid, DEFAULT_ROUTE_PARAMS, 'Habitat')
    expect(rows).toHaveLength(3)

    expect(rows[0]).toMatchObject({ number: 0, arriveS: null, leaveS: 0, crew: null })
    expect(rows[0].next).toMatchObject({ compass: 'E' })
    expect(rows[0].next!.distanceM).toBeCloseTo(stats.legs[0].distanceM)
    expect(rows[0].next!.hazards.map((h) => h.label)).toEqual(['Loose sand'])

    expect(rows[1].arriveS).toBeCloseTo(stats.legs[0].walkS)
    expect(rows[1].leaveS).toBeCloseTo(stats.legs[0].walkS + 600)
    expect(rows[1].target?.why).toBe('Fluids')
    expect(rows[1].crew).toMatchObject({ ev1: 'Hand lens', ev2: 'Drill' })
    expect(rows[1].next).toMatchObject({ compass: 'W' })

    expect(rows[2]).toMatchObject({ arriveS: stats.totalS, leaveS: null, next: null, crew: null })
  })

  test('the farthest point from safety is the track cell with the longest walk home', () => {
    const { stats } = walk()
    const field = new Float32Array(40).map((_, i) => i * 10)
    field[20] = Infinity // unreachable cells are not "far", they are reported elsewhere
    expect(farthestFromSafety(stats.track, field)).toMatchObject({ s: 390, point: { cell: 39 } })
  })

  test('the map crop covers the walk with a margin, keeps a sane aspect and stays on the grid', () => {
    const grid = gridFrom(Array.from({ length: 100 }, () => '.'.repeat(100)))
    const crop = cropAround(grid, [10 * 100 + 10, 10 * 100 + 20], 5)
    expect(crop).toMatchObject({ cols: 21, rows: 13 })
    expect(crop.col0).toBe(5)
    expect(crop.row0).toBeGreaterThanOrEqual(0)
    // at the corner the window keeps its size and shifts inside the grid
    expect(cropAround(grid, [0], 5)).toMatchObject({ col0: 0, row0: 0, cols: 11, rows: 11 })
  })

  test('hillshade: flat ground is even; slopes facing the north-west sun are lighter than slopes facing away', () => {
    const flat = gridFrom(['....', '....', '....'])
    const all = { col0: 0, row0: 0, cols: 4, rows: 3 }
    expect(new Set(hillshadePixels(flat, all).filter((_, i) => i % 4 === 0)).size).toBe(1)
    const facingWest = gridFrom(['....', '....', '....'], (_, c) => c) // rises to the east
    const facingEast = gridFrom(['....', '....', '....'], (_, c) => -c)
    const centre = 4 * (1 * 4 + 1)
    expect(hillshadePixels(facingWest, all)[centre]).toBeGreaterThan(hillshadePixels(facingEast, all)[centre])
  })

  test('Mars local clock along the walk', () => {
    const start = Date.parse('2026-11-15T10:25:00.000Z')
    expect(marsClockAt(start, 0, 137.389)).toMatch(/^\d\d:\d\d$/)
    // one Mars hour is ~3699 s
    const [h0] = marsClockAt(start, 0, 137.389).split(':').map(Number)
    const [h1] = marsClockAt(start, 3700 * 2, 137.389).split(':').map(Number)
    expect((h1 - h0 + 24) % 24).toBe(2)
  })
})

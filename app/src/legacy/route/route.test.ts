import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SLOPE_PENALTY_PER_DEG, SUIT_SPEED_FACTOR } from '../config'
import { parseCostGrid } from '../costGrid'
import { TERRAIN, type CostGrid, type CostGridMeta, type DataConfig, type ScienceTarget, type Waypoint } from '../types'
import { DEFAULT_ROUTE_PARAMS, prepareGrid, stepTime, walkingSpeedMs } from './cost'
import { cellAt, cellCenter, planLoop, planRoute } from './route'
import { findPath, walkHomeField } from './search'
import { gridFrom, idx, TEST_CELL_M as CELL } from '../testing/grids'
import { handleRequest, type WorkerState } from './workerHandler'

const FLAT_SPEED = walkingSpeedMs(0, SUIT_SPEED_FACTOR) // m/s on level bedrock

describe('walking speed', () => {
  test("Tobler's function × suit factor", () => {
    expect(walkingSpeedMs(-0.05, 1)).toBeCloseTo(6 / 3.6, 10) // peak at 5% downhill
    expect(walkingSpeedMs(0, 1)).toBeCloseTo((6 * Math.exp(-3.5 * 0.05)) / 3.6, 10) // ~5.04 km/h on the flat
    expect(walkingSpeedMs(0, 0.6)).toBeCloseTo(0.6 * walkingSpeedMs(0, 1), 10)
  })

  test('uphill and downhill are asymmetric', () => {
    expect(walkingSpeedMs(0.2, 1)).toBeLessThan(walkingSpeedMs(-0.2, 1))
  })
})

describe('findPath', () => {
  test('flat ground: straight line, time = distance / speed', () => {
    const g = gridFrom(['.....'])
    const path = findPath(prepareGrid(g), 0, 4)!
    expect(path.cells).toEqual([0, 1, 2, 3, 4])
    expect(path.timeS).toBeCloseTo((4 * CELL) / FLAT_SPEED, 6)
  })

  test('flat ground diagonal uses √2 steps', () => {
    const g = gridFrom(['....', '....', '....', '....'])
    const path = findPath(prepareGrid(g), 0, idx(g, 3, 3))!
    expect(path.cells).toHaveLength(4)
    expect(path.timeS).toBeCloseTo((3 * Math.SQRT2 * CELL) / FLAT_SPEED, 6)
  })

  test('wall: goes through the only gap', () => {
    const g = gridFrom([
      '..#..', //
      '..#..',
      '..#..',
      '.....',
    ])
    const path = findPath(prepareGrid(g), idx(g, 0, 0), idx(g, 0, 4))!
    expect(path.cells).toContain(idx(g, 3, 2))
    expect(path.cells.some((c) => g.terrainClass[c] === TERRAIN.NO_GO)).toBe(false)
  })

  test('no path → null', () => {
    const g = gridFrom(['..#..', '..#..', '..#..'])
    expect(findPath(prepareGrid(g), 0, 4)).toBeNull()
  })

  test('goal or start on an impassable cell → null', () => {
    const g = gridFrom(['..^', '...'])
    expect(findPath(prepareGrid(g), 0, 2)).toBeNull()
    expect(findPath(prepareGrid(g), 2, 0)).toBeNull()
  })

  test('pit: steep-sided depression on the straight line is walked around', () => {
    const rows = [
      '.......', //
      '.......',
      '..^^^..',
      '..^^^..',
      '..^^^..',
      '.......',
      '.......',
    ]
    const g = gridFrom(rows, (r, c) => (r >= 2 && r <= 4 && c >= 2 && c <= 4 ? -3 : 0))
    const path = findPath(prepareGrid(g), idx(g, 3, 0), idx(g, 3, 6))!
    expect(path).not.toBeNull()
    for (const c of path.cells) expect(g.slopeDeg[c]).toBe(0)
  })

  test('diagonal steps cannot squeeze between two blocked cells', () => {
    const g = gridFrom([
      '.#', //
      '#.',
    ])
    expect(findPath(prepareGrid(g), 0, 3)).toBeNull()
  })

  test('sand doubles the cost and is avoided when a bedrock detour is cheaper', () => {
    const sand = gridFrom(['sss'])
    expect(findPath(prepareGrid(sand), 0, 2)!.timeS).toBeCloseTo((2 * 2 * CELL) / FLAT_SPEED, 6)

    const g = gridFrom([
      '.....', //
      '.sss.',
    ])
    const path = findPath(prepareGrid(g), idx(g, 1, 0), idx(g, 1, 4))!
    expect(path.cells.some((c) => g.terrainClass[c] === TERRAIN.SAND)).toBe(false)
  })

  test('slope above the penalty threshold multiplies cost', () => {
    const g = gridFrom(['...'])
    g.slopeDeg.fill(20)
    const expected = 1 + SLOPE_PENALTY_PER_DEG * (20 - DEFAULT_ROUTE_PARAMS.slopePenaltyStartDeg)
    expect(findPath(prepareGrid(g), 0, 2)!.timeS).toBeCloseTo(((2 * CELL) / FLAT_SPEED) * expected, 6)
  })

  test('asymmetric slope: uphill takes longer than downhill on the same line', () => {
    const g = gridFrom(['......'], (_r, c) => c * 0.4) // 20% grade rising east
    const p = prepareGrid(g)
    const up = findPath(p, 0, 5)!
    const down = findPath(p, 5, 0)!
    expect(up.timeS).toBeCloseTo((5 * CELL) / walkingSpeedMs(0.2, SUIT_SPEED_FACTOR), 6)
    expect(down.timeS).toBeCloseTo((5 * CELL) / walkingSpeedMs(-0.2, SUIT_SPEED_FACTOR), 6)
    expect(up.timeS).toBeGreaterThan(down.timeS)
  })
})

describe('walkHomeField', () => {
  test('equals the A* time from each cell to base, in the walking direction', () => {
    const g = gridFrom(
      [
        '......', //
        '.ss#..',
        '...#b.',
        '......',
      ],
      (r, c) => 0.3 * c - 0.2 * r,
    )
    const p = prepareGrid(g)
    const base = idx(g, 0, 5)
    const field = walkHomeField(p, base)
    for (let cell = 0; cell < g.width * g.height; cell++) {
      const path = findPath(p, cell, base)
      if (path === null) expect(field[cell]).toBe(Infinity)
      else expect(field[cell]).toBeCloseTo(path.timeS, 2)
    }
    expect(field[base]).toBe(0)
  })

  test('unreachable cells are Infinity', () => {
    const g = gridFrom(['..#..'])
    const field = walkHomeField(prepareGrid(g), 0)
    expect(field[1]).toBeGreaterThan(0)
    expect(field[3]).toBe(Infinity)
    expect(field[4]).toBe(Infinity)
  })
})

describe('planRoute / planLoop', () => {
  test('base → stops → base: legs chain and times add up', () => {
    const g = gridFrom(['.....', '.....', '.....'])
    const p = prepareGrid(g)
    const r = planLoop(p, 0, [4, idx(g, 2, 4)])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.legs.map((l) => [l.from, l.to])).toEqual([
      [0, 4],
      [4, idx(g, 2, 4)],
      [idx(g, 2, 4), 0],
    ])
    expect(r.timeS).toBeCloseTo(
      r.legs.reduce((s, l) => s + l.timeS, 0),
      9,
    )
    expect(r.legs[0].timeS).toBeCloseTo(stepTime(p, 0, 1, CELL) * 4, 9)
  })

  test('reports the first leg without a path', () => {
    const g = gridFrom(['...#.'])
    expect(planRoute(prepareGrid(g), [0, 2, 4, 0])).toEqual({ ok: false, failedLeg: 1 })
  })
})

describe('cellAt / cellCenter', () => {
  test('round trip and outside → -1', () => {
    const g = gridFrom(['....', '....'])
    for (let cell = 0; cell < 8; cell++) {
      const { lat, lon } = cellCenter(g, cell)
      expect(cellAt(g, lat, lon)).toBe(cell)
    }
    const { latMax, lonMin } = g.bounds
    expect(cellAt(g, latMax * 0.99, lonMin + 1e-9)).toBe(0) // north-west corner is row 0
    expect(cellAt(g, latMax * 1.5, lonMin)).toBe(-1)
  })
})

describe('worker protocol', () => {
  test('init then route and walkHome', () => {
    const n = 6
    const buffer = new ArrayBuffer(9 * n)
    const meta: CostGridMeta = {
      width: 3,
      height: 2,
      cellSizeM: 2,
      bounds: { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 },
      binary: 'x.bin',
      status: 'MOCK',
      source: 'test',
    }
    const state: WorkerState = { prepared: null }
    expect(handleRequest(state, { type: 'route', id: 1, stops: [0, 2] }).response.type).toBe('error')
    expect(handleRequest(state, { type: 'init', id: 2, meta, buffer }).response).toEqual({ type: 'init', id: 2 })
    const route = handleRequest(state, { type: 'route', id: 3, stops: [0, 2] }).response
    expect(route.type === 'route' && route.result.ok).toBe(true)
    const home = handleRequest(state, { type: 'walkHome', id: 4, base: 0 })
    expect(home.response.type).toBe('walkHome')
    expect(home.transfer).toHaveLength(1)
  })
})

/** Rolling synthetic terrain: smooth hills, sand patches, scattered blocked cells. */
function syntheticGrid(size: number): CostGrid {
  const g = gridFrom(Array.from({ length: size }, () => '.'.repeat(size)))
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c
      g.elevation[i] = 20 * Math.sin(r / 90) * Math.cos(c / 70)
      g.slopeDeg[i] = 8 + 6 * Math.sin(r / 40 + c / 55)
      const v = rand()
      g.terrainClass[i] = v < 0.02 ? TERRAIN.NO_GO : v < 0.25 ? TERRAIN.SAND : TERRAIN.BEDROCK
    }
  }
  return g
}

describe('performance (CLAUDE.md §7 Phase 3: route on 1000 × 1000 in under 1 s)', () => {
  test('corner-to-corner A* on a synthetic 1000 × 1000 grid', () => {
    const g = syntheticGrid(1000)
    const p = prepareGrid(g)
    const start = idx(g, 5, 5)
    const goal = idx(g, 994, 994)
    g.terrainClass[start] = g.terrainClass[goal] = TERRAIN.BEDROCK
    p.mult[start] = p.mult[goal] = 1
    const t0 = performance.now()
    const path = findPath(p, start, goal)
    const ms = performance.now() - t0
    console.log(`A* 1000x1000 corner to corner: ${ms.toFixed(0)} ms, ${path?.cells.length} cells`)
    expect(path).not.toBeNull()
    expect(ms).toBeLessThan(1000)
  })
})

// The real mock site (data/ is git-ignored, so this runs only locally).
const DATA = new URL('../../../data/', import.meta.url)
const hasData = existsSync(new URL('config.json', DATA))

describe.skipIf(!hasData)('mock site in data/', () => {
  test('base → every science target → base, and the walk-home field', () => {
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, DATA), 'utf-8'))
    const config = read('config.json') as DataConfig
    const meta = read(config.costGrid) as CostGridMeta
    const bytes = readFileSync(new URL(meta.binary, new URL(config.costGrid, DATA)))
    const grid = parseCostGrid(meta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const p = prepareGrid(grid)
    const base = (read(config.waypoints.path) as Waypoint[]).find((w) => w.kind === 'base')!
    const targets = read(config.scienceTargets.path) as ScienceTarget[]
    const baseCell = cellAt(grid, base.lat, base.lon)

    const t0 = performance.now()
    const route = planLoop(
      p,
      baseCell,
      targets.map((t) => cellAt(grid, t.lat, t.lon)),
    )
    const routeMs = performance.now() - t0
    expect(route.ok).toBe(true)
    if (!route.ok) return

    const t1 = performance.now()
    const field = walkHomeField(p, baseCell)
    const fieldMs = performance.now() - t1
    const lengthM = route.legs.reduce((s, l) => s + l.cells.length * grid.cellSizeM, 0)
    const share = (cells: Iterable<number>, code: number) => {
      let hit = 0
      let all = 0
      for (const c of cells) {
        all++
        if (grid.terrainClass[c] === code) hit++
      }
      return `${((100 * hit) / all).toFixed(0)}%`
    }
    const routeCells = route.legs.flatMap((l) => l.cells)
    console.log(
      `sand: ${share(routeCells, TERRAIN.SAND)} of route cells vs ${share(grid.terrainClass.keys(), TERRAIN.SAND)} of the site`,
    )
    console.log(
      `mock loop: ${route.legs.length} legs, ~${(lengthM / 1000).toFixed(1)} km, ${(route.timeS / 3600).toFixed(2)} h walking, ` +
        `${routeMs.toFixed(0)} ms (${(routeMs / route.legs.length).toFixed(0)} ms/leg); walk-home field ${fieldMs.toFixed(0)} ms`,
    )
    for (const leg of route.legs) expect(field[leg.from]).toBeLessThan(Infinity)
    expect(routeMs / route.legs.length).toBeLessThan(1000)
  })
})

describe('safest route profile', () => {
  test('detours around sand that the fastest route crosses', async () => {
    const { SAFEST_ROUTE_PARAMS } = await import('./cost')
    // A thick sand field: crossing it (8 steps at ×2) beats walking round it (~18 steps), unless sand costs ×6.
    const g = gridFrom([
      '.........', //
      ...Array.from({ length: 9 }, () => '.sssssss.'),
      '.........',
    ])
    const start = idx(g, 5, 0)
    const goal = idx(g, 5, 8)
    const fastest = findPath(prepareGrid(g), start, goal)!
    const safest = findPath(prepareGrid(g, SAFEST_ROUTE_PARAMS), start, goal)!
    const onSand = (cells: number[]) => cells.filter((c) => g.terrainClass[c] === TERRAIN.SAND).length
    expect(onSand(fastest.cells)).toBeGreaterThan(0)
    expect(onSand(safest.cells)).toBe(0)
  })

  test('worker answers both profiles', () => {
    const buffer = new ArrayBuffer(9 * 6)
    const meta: CostGridMeta = {
      width: 3,
      height: 2,
      cellSizeM: 2,
      bounds: { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 },
      binary: 'x.bin',
      status: 'MOCK',
      source: 'test',
    }
    const state: WorkerState = { prepared: null }
    handleRequest(state, { type: 'init', id: 1, meta, buffer })
    const safe = handleRequest(state, { type: 'route', id: 2, stops: [0, 2], profile: 'safest' }).response
    expect(safe.type === 'route' && safe.result.ok).toBe(true)
    expect(state.safest).toBeDefined()
  })
})

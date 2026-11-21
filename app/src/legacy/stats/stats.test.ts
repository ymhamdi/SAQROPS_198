import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { MARS_MEAN_RADIUS_M } from '../config'
import { parseCostGrid } from '../costGrid'
import { prepareGrid } from '../route/cost'
import { cellAt, planLoop, planRoute, type RouteResult } from '../route/route'
import { walkHomeField } from '../route/search'
import { gridFrom, idx, TEST_CELL_M } from '../testing/grids'
import { TERRAIN, type Conditions, type CostGridMeta, type DataConfig, type ScienceTarget, type Waypoint } from '../types'
import { findSunset, sunElevationAt } from './conditions'
import { formatDuration } from './format'
import { DEFAULT_EVA_PARAMS, evaluateEva, type EvaInput } from './goNoGo'
import { routeStats, sphericalDistanceM } from './stats'
import { worstStatus } from './status'

const START = '2026-11-15T08:00:00.000Z'
const HOUR = 3600_000

/** Hourly conditions from `fromHour` before START to `toHour` after; sun(h) gives elevation at START + h hours. */
function conditions(sun: (h: number) => number, opts: { alertHours?: number[]; fromHour?: number; toHour?: number } = {}): Conditions[] {
  const out: Conditions[] = []
  for (let h = opts.fromHour ?? -2; h <= (opts.toHour ?? 12); h++) {
    out.push({
      time: new Date(Date.parse(START) + h * HOUR).toISOString(),
      tempC: -30,
      pressurePa: 800,
      dustTau: 0.6,
      sunElevationDeg: sun(h),
      radiationAlert: opts.alertHours?.includes(h) ?? false,
      source: 'test',
      status: 'MOCK',
    })
  }
  return out
}

const DAY = (h: number) => 40 - 10 * h // sets 4 h after START

function evaInput(rows: string[], stops: [number, number][], extra: Partial<EvaInput> = {}): EvaInput {
  const g = gridFrom(rows)
  const p = prepareGrid(g)
  const cells = stops.map(([r, c]) => idx(g, r, c))
  return {
    prepared: p,
    route: planRoute(p, cells),
    walkHome: walkHomeField(p, cells[0]),
    startTime: START,
    conditions: conditions(DAY),
    dwellS: 0,
    ...extra,
  }
}

const codes = (v: { reasons: { code: string; severity: string }[] }, severity: string) =>
  v.reasons.filter((r) => r.severity === severity).map((r) => r.code)

describe('sphericalDistanceM', () => {
  test('one degree of latitude on the mean sphere', () => {
    expect(sphericalDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo((2 * Math.PI * MARS_MEAN_RADIUS_M) / 360, 3)
  })

  test('longitude shrinks with cos(latitude)', () => {
    const atEquator = sphericalDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 })
    const at60 = sphericalDistanceM({ lat: 60, lon: 0 }, { lat: 60, lon: 0.01 })
    expect(at60 / atEquator).toBeCloseTo(0.5, 4)
  })
})

describe('routeStats', () => {
  test('out-and-back: distance, timeline with dwell, per-leg times match the engine', () => {
    const g = gridFrom(['.....'])
    const p = prepareGrid(g)
    const r = planLoop(p, 0, [4])
    if (!r.ok) throw new Error('no route')
    const s = routeStats(p, r.legs, 600)

    expect(s.track.map((t) => t.cell)).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0])
    expect(s.distanceM).toBeCloseTo(8 * TEST_CELL_M, 1) // within ~0.2%: mean vs equatorial radius
    expect(s.legs.map((l) => l.walkS)).toEqual(r.legs.map((l) => expect.closeTo(l.timeS, 9)))
    expect(s.dwellS).toBe(600)
    expect(s.totalS).toBeCloseTo(s.walkS + 600, 9)
    const stop = s.track[4]
    expect(stop.departS - stop.arriveS).toBe(600)
    expect(s.track[5].arriveS).toBeGreaterThan(stop.departS)
    expect(s.track.at(-1)!.arriveS).toBeCloseTo(s.totalS, 9)
  })

  test('elevation profile, ascent and descent', () => {
    const g = gridFrom(['....'], (_r, c) => [0, 1, 3, 2][c])
    const p = prepareGrid(g)
    const r = planRoute(p, [0, 3])
    if (!r.ok) throw new Error('no route')
    const s = routeStats(p, r.legs)
    expect(s.track.map((t) => t.elevationM)).toEqual([0, 1, 3, 2])
    expect(s.ascentM).toBe(3)
    expect(s.descentM).toBe(1)
    expect(s.track.map((t) => Math.round(t.distanceM))).toEqual([0, 2, 4, 6])
  })

  test('time per terrain splits each step between its two cells', () => {
    const g = gridFrom(['ss..'])
    const p = prepareGrid(g)
    const r = planRoute(p, [0, 3])
    if (!r.ok) throw new Error('no route')
    const s = routeStats(p, r.legs)
    const flatStep = s.walkS / (2 + 1.5 + 1) // step costs: sand-sand ×2, sand-bedrock ×1.5, bedrock ×1
    expect(s.timeByTerrainS[TERRAIN.SAND]).toBeCloseTo(flatStep * (2 + 0.75), 6)
    expect(s.timeByTerrainS[TERRAIN.BEDROCK]).toBeCloseTo(flatStep * (0.75 + 1), 6)
    expect(Object.values(s.timeByTerrainS).reduce((a, b) => a + b)).toBeCloseTo(s.walkS, 9)
  })

  test('max slope and its cell', () => {
    const g = gridFrom(['....'])
    g.slopeDeg.set([3, 18, 7, 2])
    const p = prepareGrid(g)
    const r = planRoute(p, [0, 3])
    if (!r.ok) throw new Error('no route')
    const s = routeStats(p, r.legs)
    expect(s.maxSlopeDeg).toBe(18)
    expect(s.maxSlopeCell).toBe(1)
  })

  test('status: never better than DERIVED (distance) / MODELED (time); MOCK grid → MOCK', () => {
    for (const [gridStatus, distance, time] of [
      ['OBSERVED', 'DERIVED', 'MODELED'],
      ['MOCK', 'MOCK', 'MOCK'],
    ] as const) {
      const p = prepareGrid(gridFrom(['..'], undefined, gridStatus))
      const r = planRoute(p, [0, 1])
      if (!r.ok) throw new Error('no route')
      expect(routeStats(p, r.legs).status).toEqual({ distance, time })
    }
  })
})

describe('worstStatus / formatDuration', () => {
  test('ordering OBSERVED < DERIVED < MODELED < MOCK', () => {
    expect(worstStatus('OBSERVED', 'DERIVED')).toBe('DERIVED')
    expect(worstStatus('MODELED', 'DERIVED', 'OBSERVED')).toBe('MODELED')
    expect(worstStatus('MOCK', 'OBSERVED')).toBe('MOCK')
  })

  test('durations', () => {
    expect(formatDuration(20)).toBe('under 1 min')
    expect(formatDuration(45 * 60)).toBe('45 min')
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe('2 h 05 min')
  })
})

describe('conditions series', () => {
  test('sun elevation interpolates and sunset is the downward zero crossing', () => {
    const c = conditions(DAY)
    expect(sunElevationAt(c, Date.parse(START) + 0.5 * HOUR)).toBeCloseTo(35, 6)
    expect(findSunset(c, Date.parse(START))).toBe(Date.parse(START) + 4 * HOUR)
    expect(sunElevationAt(c, Date.parse(START) + 100 * HOUR)).toBeNull()
  })
})

describe('evaluateEva', () => {
  const ROWS = ['..........', '..........']

  test('short daytime walk: GO, and every passed check says why', () => {
    const v = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]]))
    expect(v.verdict).toBe('GO')
    expect(codes(v, 'no-go')).toEqual([])
    expect(codes(v, 'info')).toEqual(expect.arrayContaining(['O2_BUDGET', 'POINT_OF_NO_RETURN', 'SUNSET', 'RADIATION']))
    expect(v.status).not.toBe('OBSERVED') // never better than MODELED: suit and O2 are assumptions
    expect(v.status).not.toBe('DERIVED')
    expect(v.endTime).not.toBeNull()
  })

  test('no path → NO-GO naming the leg', () => {
    const v = evaluateEva(evaInput(['..#..'], [[0, 0], [0, 4]]))
    expect(v.verdict).toBe('NO-GO')
    expect(v.reasons[0]).toMatchObject({ code: 'NO_PATH', severity: 'no-go' })
    expect(v.reasons[0].message).toContain('leg 1')
    expect(v.stats).toBeNull()
  })

  test('O2 budget exceeded → NO-GO', () => {
    const params = { ...DEFAULT_EVA_PARAMS, o2DurationS: DEFAULT_EVA_PARAMS.o2ReserveS + 5 }
    const v = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { params }))
    expect(codes(v, 'no-go')).toContain('O2_BUDGET')
  })

  test('point of no return: fits the plan but not an emergency walk home from the far end', () => {
    const base = evaInput(ROWS, [[0, 0], [0, 9], [0, 0]])
    const out = (base.route as Extract<RouteResult, { ok: true }>).legs[0].timeS
    // usable O2 = 2.2 × one-way time: the plan (2×) fits, an emergency return from the far end (1 + 1.5 = 2.5×) does not.
    const params = { ...DEFAULT_EVA_PARAMS, o2DurationS: DEFAULT_EVA_PARAMS.o2ReserveS + 2.2 * out }
    const v = evaluateEva({ ...base, params })
    expect(codes(v, 'no-go')).toEqual(['POINT_OF_NO_RETURN'])
    expect(codes(v, 'info')).toContain('O2_BUDGET')
    expect(v.reasons[0].message).toMatch(/Point of no return passed .* \(leg 1\)/)
  })

  test('route through a no-go cell (not engine-built) → NO-GO', () => {
    const input = evaInput(['.#.'], [[0, 0], [0, 0]])
    const route: RouteResult = { ok: true, legs: [{ from: 0, to: 2, cells: [0, 1, 2], timeS: 10 }], timeS: 10 }
    const v = evaluateEva({ ...input, route })
    expect(codes(v, 'no-go')).toContain('NO_GO_CELLS')
  })

  test('back too close to sunset → NO-GO; dark start → NO-GO', () => {
    const late = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { conditions: conditions((h) => 2 - 120 * h, { fromHour: -1, toHour: 2 }) }))
    expect(codes(late, 'no-go')).toContain('SUNSET') // sunset ~1 min after start
    const dark = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { conditions: conditions(() => -20) }))
    expect(codes(dark, 'no-go')).toContain('DARK_START')
  })

  test('radiation alert inside the window → NO-GO; after the window → GO', () => {
    const during = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { conditions: conditions(DAY, { alertHours: [0] }) }))
    expect(codes(during, 'no-go')).toContain('RADIATION')
    const later = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { conditions: conditions(DAY, { alertHours: [6] }) }))
    expect(later.verdict).toBe('GO')
  })

  test('no conditions → caution, not a silent pass', () => {
    const v = evaluateEva(evaInput(ROWS, [[0, 0], [0, 9], [0, 0]], { conditions: [] }))
    expect(v.verdict).toBe('GO')
    expect(codes(v, 'caution')).toContain('NO_CONDITIONS')
  })

  test('sand and steep ground raise cautions; reasons sorted no-go → caution → info', () => {
    const input = evaInput(['s'.repeat(40)], [[0, 0], [0, 39]])
    input.prepared.grid.slopeDeg.fill(18)
    const p = prepareGrid(input.prepared.grid)
    const v = evaluateEva({ ...input, prepared: p, route: planRoute(p, [0, 39]), walkHome: walkHomeField(p, 0) })
    expect(codes(v, 'caution')).toEqual(expect.arrayContaining(['SAND', 'STEEP_SECTIONS']))
    const order = v.reasons.map((r) => r.severity)
    expect(order).toEqual([...order].sort((a, b) => ['no-go', 'caution', 'info'].indexOf(a) - ['no-go', 'caution', 'info'].indexOf(b)))
  })
})

// The configured site in data/ (runs only where data/ exists).
const DATA = new URL('../../../data/', import.meta.url)
const hasData = existsSync(new URL('config.json', DATA))

describe.skipIf(!hasData)('site in data/', () => {
  test('loop through every target, started in the morning', () => {
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, DATA), 'utf-8'))
    const config = read('config.json') as DataConfig
    const meta = read(config.costGrid) as CostGridMeta
    const bytes = readFileSync(new URL(meta.binary, new URL(config.costGrid, DATA)))
    const grid = parseCostGrid(meta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const p = prepareGrid(grid)
    const base = cellAt(grid, ...latLon((read(config.waypoints.path) as Waypoint[]).find((w) => w.kind === 'base')!))
    const stops = (read(config.scienceTargets.path) as ScienceTarget[]).map((t) => cellAt(grid, ...latLon(t)))
    const series = read(config.conditions.path) as Conditions[]
    const start = series.find((c) => c.sunElevationDeg > 20)!.time

    const v = evaluateEva({ prepared: p, route: planLoop(p, base, stops), walkHome: walkHomeField(p, base), startTime: start, conditions: series })
    console.log(
      `site EVA from ${start}: ${v.verdict} [${v.status}], ${formatDuration(v.stats!.totalS)}\n` +
        v.reasons.map((r) => `  ${r.severity.padEnd(7)} ${r.code}: ${r.message}`).join('\n'),
    )
    expect(v.stats).not.toBeNull()
    expect(v.status).not.toBe('OBSERVED') // never better than MODELED: suit and O2 are assumptions
    expect(v.status).not.toBe('DERIVED')
  })
})

function latLon(p: { lat: number; lon: number }): [number, number] {
  return [p.lat, p.lon]
}

describe('radiation dose', () => {
  test('background dose scales with EVA length at the RAD rate', async () => {
    const { evaDoseMSv } = await import('./goNoGo')
    expect(evaDoseMSv(86400)).toBeCloseTo(0.64, 9)
    expect(evaDoseMSv(4 * 3600)).toBeCloseTo(0.64 / 6, 9)
  })

  test('every verdict reports the dose as a passed check', () => {
    const v = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]]))
    expect(v.reasons.find((r) => r.code === 'DOSE')?.severity).toBe('info')
    expect(v.doseMSv).toBeGreaterThan(0)
  })
})

describe('radio line of sight check', () => {
  test('no line-of-sight data: no COMMS reason at all', () => {
    const v = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]]))
    expect(v.reasons.some((r) => r.code === 'COMMS')).toBe(false)
  })

  test('always in sight: a passed check; long out of sight: a caution, never a NO-GO by itself', () => {
    const seen = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]], { lineOfSight: new Uint8Array(10).fill(1) }))
    expect(seen.reasons.find((r) => r.code === 'COMMS')?.severity).toBe('info')
    const hidden = new Uint8Array(10).fill(1)
    hidden.fill(0, 3)
    const v = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]], { lineOfSight: hidden, dwellS: 120 }))
    const r = v.reasons.find((x) => x.code === 'COMMS')
    expect(r?.severity).toBe('caution')
    expect(r?.message).toMatch(/Out of radio line of sight/)
    expect(v.verdict).toBe('GO')
  })
})

describe('space-weather advisory check', () => {
  const win = (start: string, end: string, level: 'alert' | 'advisory' = 'advisory') => ({ start, end, level, reason: 'CME forecast.', link: 'https://x' })
  test('an advisory overlapping the walk gives a caution, not a NO-GO', () => {
    const v = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]], { spaceWeather: [win('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')] }))
    const r = v.reasons.find((x) => x.code === 'SPACE_WEATHER')
    expect(r?.severity).toBe('caution')
    expect(r?.message).toMatch(/Space-weather advisory until/)
    expect(v.verdict).toBe('GO')
  })
  test('no overlapping advisory: a passed check; alert windows are left to the conditions (radiationAlert)', () => {
    const v = evaluateEva(evaInput(['..........'], [[0, 0], [0, 9], [0, 0]], { spaceWeather: [win('1990-01-01T00:00:00.000Z', '1990-01-02T00:00:00.000Z'), win('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z', 'alert')] }))
    expect(v.reasons.find((x) => x.code === 'SPACE_WEATHER')?.severity).toBe('info')
  })
})

describe('shortReason (helmet visor text)', () => {
  test('first clause only', async () => {
    const { shortReason } = await import('./format')
    expect(shortReason('Space-weather advisory until 16:00 UTC: CME launched 2025-11-09. Watch.')).toBe('Space-weather advisory until 16:00 UTC')
    expect(shortReason('Out of radio line of sight with the habitat and the rover for 3 h 15 min in total (longest 2 h 32 min). Agree.')).toBe(
      'Out of radio line of sight with the habitat and the rover for 3 h 15 min in total',
    )
    expect(shortReason('About 600 m of route on slopes over 15° (max 25°).')).toBe('About 600 m of route on slopes over 15°')
    expect(shortReason('Sunset comes 1 h 28 min before the crew is back.')).toBe('Sunset comes 1 h 28 min before the crew is back')
  })
})


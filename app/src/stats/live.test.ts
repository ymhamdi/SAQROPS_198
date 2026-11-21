import { describe, expect, test } from 'vitest'
import type { Conditions } from '../types'
import { DEFAULT_EVA_PARAMS } from './goNoGo'
import { liveWarnings } from './live'

const START = '2026-11-15T08:00:00.000Z'
const HOUR = 3600_000

function sky(sunAt: (h: number) => number, alertHours: number[] = []): Conditions[] {
  return Array.from({ length: 13 }, (_, h) => ({
    time: new Date(Date.parse(START) + h * HOUR).toISOString(),
    tempC: -30,
    pressurePa: 800,
    dustTau: 0.6,
    sunElevationDeg: sunAt(h),
    radiationAlert: alertHours.includes(h),
    source: 'test',
    status: 'MOCK',
  }))
}

const calm = sky((h) => 60 - 5 * h) // sunset 12 h after start
const codes = (w: { code: string }[]) => w.map((x) => x.code)

describe('liveWarnings', () => {
  test('quiet early in a short walk', () => {
    expect(liveWarnings({ t: 600, startTime: START, emergencyHomeS: 900, conditions: calm, params: DEFAULT_EVA_PARAMS })).toEqual([])
  })

  test('margin low, then past the point of no return', () => {
    const usable = DEFAULT_EVA_PARAMS.o2DurationS - DEFAULT_EVA_PARAMS.o2ReserveS
    const low = liveWarnings({ t: usable - 2400, startTime: START, emergencyHomeS: 1200, conditions: calm, params: DEFAULT_EVA_PARAMS })
    expect(codes(low)).toContain('MARGIN_LOW')
    const past = liveWarnings({ t: usable - 600, startTime: START, emergencyHomeS: 1200, conditions: calm, params: DEFAULT_EVA_PARAMS })
    expect(past[0].code).toBe('NO_RETURN')
    expect(past[0].severity).toBe('no-go')
  })

  test('O2 low near the reserve; radiation now; sunset soon', () => {
    const t = DEFAULT_EVA_PARAMS.o2DurationS - DEFAULT_EVA_PARAMS.o2ReserveS - 600
    expect(codes(liveWarnings({ t, startTime: START, emergencyHomeS: 0, conditions: calm, params: DEFAULT_EVA_PARAMS }))).toContain('O2_LOW')
    const storm = sky((h) => 60 - 5 * h, [1])
    expect(codes(liveWarnings({ t: 1.5 * 3600, startTime: START, emergencyHomeS: 0, conditions: storm, params: DEFAULT_EVA_PARAMS }))).toEqual(['RADIATION_NOW'])
    const dusk = sky((h) => 10 - 10 * h) // sunset 1 h after start
    expect(codes(liveWarnings({ t: 1200, startTime: START, emergencyHomeS: 0, conditions: dusk, params: DEFAULT_EVA_PARAMS }))).toEqual(['SUNSET_SOON'])
  })
})

import { describe, expect, test } from 'vitest'
import { ltstHours, marsTime, nextLtstMs, solarElevationDeg } from '../marsTime'
import type { Conditions } from '../types'
import { defaultStartOption, describeTime, startOptions, withMarsSun } from './sun'

const LAT = -4.788
const LON = 137.389
const T0 = Date.parse('2026-11-15T00:00:00.000Z')

/** One sol of hourly samples with a deliberately wrong sun, like the mock file. */
const series: Conditions[] = Array.from({ length: 26 }, (_, h) => ({
  time: new Date(T0 + h * 3_698_968).toISOString(),
  tempC: -40,
  pressurePa: 820,
  dustTau: 0.6,
  sunElevationDeg: 99,
  radiationAlert: false,
  source: 'MOCK weather',
  status: 'MOCK',
}))

describe('nextLtstMs', () => {
  test('lands on the requested Mars local time, after the start, within one sol', () => {
    for (const hour of [0, 6.5, 12, 18.25, 23.9]) {
      const ms = nextLtstMs(T0, LON, hour)
      expect(ms).toBeGreaterThanOrEqual(T0)
      expect(ms - T0).toBeLessThan(88_775_244 + 1000)
      const got = ltstHours(marsTime(ms), LON)
      expect(Math.min(Math.abs(got - hour), 24 - Math.abs(got - hour))).toBeLessThan(0.001)
    }
  })
})

describe('sun from the Mars clock', () => {
  test('replaces the file sun with Mars24 and keeps the weather', () => {
    const out = withMarsSun(series, LAT, LON)
    expect(out[3].sunElevationDeg).toBeCloseTo(solarElevationDeg(marsTime(Date.parse(series[3].time)), LAT, LON), 1)
    expect(out[3].tempC).toBe(-40)
    expect(out[3].source).toContain('Mars24')
    expect(out.some((c) => c.sunElevationDeg < 0) && out.some((c) => c.sunElevationDeg > 45)).toBe(true)
  })

  test('start options are daylight times in order; the default has the sun at least 20° up', () => {
    const options = startOptions(series, LAT, LON)
    expect(options.length).toBeGreaterThan(15)
    expect(options.every((o) => o.sunDeg > 0)).toBe(true)
    expect(options.map((o) => Date.parse(o.time))).toEqual([...options.map((o) => Date.parse(o.time))].sort((a, b) => a - b))
    const d = defaultStartOption(options)!
    expect(d.sunDeg).toBeGreaterThanOrEqual(20)
    expect(Number(d.ltst.slice(0, 2))).toBeGreaterThanOrEqual(6)
    expect(Number(d.ltst.slice(0, 2))).toBeLessThan(10)
  })

  test('describeTime shows Mars local and UTC', () => {
    const ms = nextLtstMs(T0, LON, 10.5)
    expect(describeTime(new Date(ms).toISOString(), LON)).toMatch(/^10:(29|30) Mars local \(\d\d:\d\d UTC\)$/)
  })
})

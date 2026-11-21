import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  formatMarsClock,
  lmstHours,
  ltstHours,
  marsTime,
  nextSunriseMs,
  nextSunsetMs,
  solarAzimuthDeg,
  solarElevationDeg,
  solarZenithDeg,
  ttMinusUtcS,
} from './marsTime'
import type { Conditions, DataConfig, Waypoint } from './types'

// Worked examples from https://www.giss.nasa.gov/tools/mars24/help/algorithm.html (Part II),
// published to 5 decimals, so compared to within 5e-5.
const P = 4

describe('Mars24 worked example 1: 2000-01-06 00:00:00 UTC at 0°W, 0°N', () => {
  const t = marsTime(947116800000)
  const lon = 0
  const lat = 0

  test('A: Julian dates and TT − UTC', () => {
    expect(t.jdUT).toBeCloseTo(2451549.5, P)
    expect(t.ttMinusUtcS).toBeCloseTo(64.184, 6)
    expect(t.jdTT).toBeCloseTo(2451549.50074, P)
    expect(t.deltaJ2000).toBeCloseTo(4.50074, P)
  })

  test('B: orbital parameters and Ls', () => {
    expect(t.meanAnomalyDeg).toBeCloseTo(21.74558, P)
    expect(t.fictitiousMeanSunDeg).toBeCloseTo(272.74566, P)
    expect(t.perturbersDeg).toBeCloseTo(0.00142, P)
    expect(t.equationOfCenterDeg).toBeCloseTo(4.44193, P)
    expect(t.lsDeg).toBeCloseTo(277.18758, P)
  })

  test('C: equation of time, MTC, LMST, LTST, subsolar longitude', () => {
    expect(t.eotDeg).toBeCloseTo(-5.18774, P)
    expect(t.eotDeg / 15).toBeCloseTo(-0.34585, P)
    expect(t.mtcHours).toBeCloseTo(23.99425, P)
    expect(formatMarsClock(t.mtcHours)).toBe('23:59:39')
    expect(lmstHours(t, lon)).toBeCloseTo(23.99425, P)
    expect(ltstHours(t, lon)).toBeCloseTo(23.6484, P)
    expect(formatMarsClock(ltstHours(t, lon))).toBe('23:38:54')
    expect(t.subsolarLonWestDeg).toBeCloseTo(174.726, P)
  })

  test('D: declination, distance, zenith, azimuth', () => {
    expect(t.declinationDeg).toBeCloseTo(-25.22825, P)
    expect(t.heliocentricDistanceAU).toBeCloseTo(1.39358, P)
    // Published 154.26182; the page's own D-5 formula on its own published δs and Λs gives 154.26175 (rounding in the table).
    expect(Math.abs(solarZenithDeg(t, lat, lon) - 154.26182)).toBeLessThan(1e-4)
    expect(solarElevationDeg(t, lat, lon)).toBeCloseTo(90 - solarZenithDeg(t, lat, lon), 9)
    expect(solarAzimuthDeg(t, lat, lon)).toBeCloseTo(191.03905, P)
  })
})

describe('Mars24 worked example 2: MER-A Spirit landing, 2004-01-03 13:46:31 UTC at 184.702°W, -14.640°N (Gusev)', () => {
  const t = marsTime(1073137591000)
  const lon = -184.702 // east-positive
  const lat = -14.64

  test('A: Julian dates and TT − UTC', () => {
    expect(t.jdUT).toBeCloseTo(2453008.07397, P)
    expect(t.ttMinusUtcS).toBeCloseTo(64.184, 6)
    expect(t.jdTT).toBeCloseTo(2453008.07471, P)
    expect(t.deltaJ2000).toBeCloseTo(1463.07471, P)
  })

  test('B: orbital parameters and Ls', () => {
    expect(t.meanAnomalyDeg).toBeCloseTo(66.06858, P)
    expect(t.fictitiousMeanSunDeg).toBeCloseTo(317.09457, P)
    expect(t.perturbersDeg).toBeCloseTo(0.01614, P)
    expect(t.equationOfCenterDeg).toBeCloseTo(10.22959, P)
    expect(t.lsDeg).toBeCloseTo(327.32416, P)
  })

  test('C: local midnight at the landing site', () => {
    expect(t.eotDeg).toBeCloseTo(-12.77553, P)
    expect(t.mtcHours).toBeCloseTo(13.16537, P)
    expect(formatMarsClock(t.mtcHours)).toBe('13:09:55')
    expect(lmstHours(t, lon)).toBeCloseTo(0.8519, P)
    expect(ltstHours(t, lon)).toBeCloseTo(0.00025, P)
    expect(formatMarsClock(ltstHours(t, lon))).toBe('00:00:00')
    expect(t.subsolarLonWestDeg).toBeCloseTo(4.705, P)
  })

  test('D: declination, distance, zenith, azimuth (sun due south below the horizon at midnight)', () => {
    // Published −13.42065; the page's own D-1 formula on its own published Ls (327.32416) gives −13.42040.
    expect(Math.abs(t.declinationDeg - -13.42065)).toBeLessThan(3e-4)
    expect(t.heliocentricDistanceAU).toBeCloseTo(1.47767, P)
    // Off by the same ~2.5e-4° as δs above.
    expect(Math.abs(solarZenithDeg(t, lat, lon) - 151.93895)).toBeLessThan(1e-3)
    expect(solarAzimuthDeg(t, lat, lon)).toBeCloseTo(179.99383, P)
    // Local midnight (H = 180°): the sun is at lower culmination, Z = 180° − |φ + δ|.
    expect(solarZenithDeg(t, lat, lon)).toBeCloseTo(180 - Math.abs(lat + t.declinationDeg), 2)
  })
})

describe('TT − UTC', () => {
  test('leap-second table and the pre-1972 polynomial', () => {
    expect(ttMinusUtcS(Date.parse('1972-03-01T00:00:00Z'))).toBeCloseTo(42.184, 9)
    expect(ttMinusUtcS(Date.parse('2016-12-31T23:59:59Z'))).toBeCloseTo(68.184, 9)
    expect(ttMinusUtcS(Date.parse('2017-01-01T00:00:00Z'))).toBeCloseTo(69.184, 9)
    expect(ttMinusUtcS(Date.parse('2026-11-15T00:00:00Z'))).toBeCloseTo(69.184, 9)
    const t1960 = (2440587.5 + Date.parse('1960-01-01T00:00:00Z') / 8.64e7 - 2451545.0) / 36525
    expect(ttMinusUtcS(Date.parse('1960-01-01T00:00:00Z'))).toBeCloseTo(
      64.184 + 59 * t1960 - 51.2 * t1960 ** 2 - 67.1 * t1960 ** 3 - 16.4 * t1960 ** 4,
      9,
    )
  })
})

describe('sunrise / sunset', () => {
  test('sun is up between sunrise and sunset, about half a sol apart near the equator', () => {
    const lat = -4.8
    const lon = 137.38
    const from = Date.parse('2026-11-15T00:00:00Z')
    const rise = nextSunriseMs(from, lat, lon)!
    const set = nextSunsetMs(rise, lat, lon)!
    expect(Math.abs(solarElevationDeg(marsTime(rise), lat, lon))).toBeLessThan(0.01)
    expect(Math.abs(solarElevationDeg(marsTime(set), lat, lon))).toBeLessThan(0.01)
    expect(solarElevationDeg(marsTime((rise + set) / 2), lat, lon)).toBeGreaterThan(45)
    const dayHours = (set - rise) / 3600_000
    expect(dayHours).toBeGreaterThan(11)
    expect(dayHours).toBeLessThan(14) // ~half of a 24.66 h sol
    // Sun crosses the meridian near local true noon.
    expect(ltstHours(marsTime((rise + set) / 2), lon)).toBeCloseTo(12, 0)
  })

  test('polar night → null', () => {
    // Ls ≈ 277° (example 1 date): southern summer, so the north pole is in darkness.
    expect(nextSunsetMs(947116800000, 89, 0)).toBeNull()
  })
})

// Compare the configured conditions series with the real clock (runs only where data/ exists).
const DATA = new URL('../../data/', import.meta.url)
describe.skipIf(!existsSync(new URL('config.json', DATA)))('site conditions vs Mars24', () => {
  test('the series is in time order and covers a full sol at the base', () => {
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, DATA), 'utf-8'))
    const config = read('config.json') as DataConfig
    const base = (read(config.waypoints.path) as Waypoint[]).find((w) => w.kind === 'base')!
    const series = read(config.conditions.path) as Conditions[]
    const times = series.map((c) => Date.parse(c.time))
    const first = marsTime(times[0])
    console.log(
      `conditions start ${series[0].time}: LMST ${formatMarsClock(lmstHours(first, base.lon))}, ` +
        `LTST ${formatMarsClock(ltstHours(first, base.lon))} at the base, Ls ${first.lsDeg.toFixed(1)}° [${series[0].status}]`,
    )
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true)
    expect((times[times.length - 1] - times[0]) / 1000).toBeGreaterThanOrEqual(88_775 - 60) // at least one sol
  })
})

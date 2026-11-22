// The TypeScript features equal the Python reference (ml/features.py) on ml/model/golden-features.json.

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { FEATURE_NAMES, featureVector, roomStats, trimHistory, type RoomHistory } from './features'

interface Case {
  tNow: number
  rooms: { t: number[]; readings: (number | null)[][] }[]
  features: (number | null)[][]
}

const fixture = JSON.parse(readFileSync(new URL('../../../ml/model/golden-features.json', import.meta.url), 'utf-8')) as { cases: Case[] }
const toNaN = (v: number | null) => (v === null ? NaN : v)

describe('feature parity with ml/features.py', () => {
  test('fixture is not empty', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
  })

  test('every case matches to 1e-9', () => {
    for (const c of fixture.cases) {
      const rooms: RoomHistory[] = c.rooms.map((r) => ({ t: r.t, readings: r.readings.map((d) => d.map(toNaN)) }))
      const stats = rooms.map((h) => roomStats(h, c.tNow))
      stats.forEach((s, i) => {
        const got = featureVector(s, stats.filter((_, j) => j !== i))
        const want = c.features[i].map(toNaN)
        expect(got).toHaveLength(FEATURE_NAMES.length)
        got.forEach((g, k) => {
          if (Number.isNaN(want[k])) expect(g, `${FEATURE_NAMES[k]} at t=${c.tNow}`).toBeNaN()
          else expect(Math.abs(g - want[k]), `${FEATURE_NAMES[k]} at t=${c.tNow}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[k])))
        })
      })
    }
  })
})

describe('trimHistory', () => {
  test('gives exactly the same statistics as the whole history, on every parity case', () => {
    for (const c of fixture.cases) {
      for (const r of c.rooms) {
        const h: RoomHistory = { t: r.t, readings: r.readings.map((d) => d.map(toNaN)) }
        const full = roomStats(h, c.tNow)
        const trimmed = roomStats(trimHistory(h, c.tNow), c.tNow)
        for (const k of Object.keys(full) as (keyof typeof full)[]) {
          if (Number.isNaN(full[k])) expect(trimmed[k], k).toBeNaN()
          else expect(trimmed[k], k).toBeCloseTo(full[k], 9)
        }
      }
    }
  })
})

describe('roomStats', () => {
  test('a detector that fails keeps the history that led to it', () => {
    const t = Array.from({ length: 101 }, (_, i) => i)
    const det = t.map((x) => (20 + 2 * x <= 150 ? 20 + 2 * x : NaN)) // fails at 66 s
    const s = roomStats({ t, readings: [det] }, 100)
    expect(s.tLast).toBeNaN()
    expect(s.fracFailed).toBe(1)
    expect(s.sSinceFail).toBe(34)
    expect(s.slopeAtFail).toBeCloseTo(2, 9)
  })

  test('an empty room has no signal and no failure', () => {
    const s = roomStats({ t: [], readings: [] }, 10)
    expect(s.tLast).toBeNaN()
    expect(s.fracFailed).toBe(0)
  })
})

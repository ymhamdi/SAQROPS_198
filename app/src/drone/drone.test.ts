// R7: the drone always gets home with the battery reserve, never flies in high wind, never enters the plume.

import { describe, expect, test } from 'vitest'
import { buildSite } from '../site/site'
import { bearingDeg, droneAt, droneParams, inPlume, loopAround, planFlight, plumeOf, type Flight, type Plume, type Wind } from './drone'

const site = buildSite()
const p = droneParams()
const m = site.marginM
const loop = loopAround({ x0: m, y0: m, x1: m + 60, y1: m + 40 }, p.loopOffsetM)
const home = site.engine.at
const fire = site.demo.fireAt
const calm: Wind = { speedMs: 1.6, fromDeg: 248, status: 'DERIVED' }

function neverInPlume(f: Flight, pl: Plume) {
  for (let i = 0; i < f.points.length; i++) {
    expect(inPlume(pl, f.points[i])).toBe(false)
    if (i > 0) {
      // the straight leg between two points, sampled every 0.5 m
      const a = f.points[i - 1]
      const b = f.points[i]
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5)
      for (let k = 0; k <= n; k++) expect(inPlume(pl, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })).toBe(false)
    }
  }
}

describe('R7 drone safety', () => {
  test('no fire: the whole loop, landing with at least the reserve', () => {
    const f = planFlight(loop, home, null, calm, p)
    expect(f.ok).toBe(true)
    expect(f.reason).toBeNull()
    expect(f.points.at(-1)!.batteryPct).toBeGreaterThanOrEqual(p.reservePct)
  })

  test('flight refused above the wind limit', () => {
    const f = planFlight(loop, home, null, { ...calm, speedMs: p.maxWindMs + 0.1 }, p)
    expect(f.ok).toBe(false)
    expect(f.points).toHaveLength(0)
    expect(f.reason).toMatch(/vent/)
  })

  test('flight refused when the engine is under the plume', () => {
    const towardEngine = { ...calm, fromDeg: (bearingDeg(fire, home) + 180) % 360 } // the wind blows the smoke onto the engine
    const pl = plumeOf(fire, towardEngine, p)
    expect(inPlume(pl, home)).toBe(true)
    const f = planFlight(loop, home, pl, towardEngine, p)
    expect(f.ok).toBe(false)
    expect(f.reason).toMatch(/panache/)
  })

  test.each([200, 248, 300, 340, 20])('wind from %i°: never in the plume, every point keeps the battery reserve', (fromDeg) => {
    const wind = { ...calm, fromDeg }
    const pl = plumeOf(fire, wind, p)
    const f = planFlight(loop, home, pl, wind, p)
    if (!f.ok) return // refused is safe too
    neverInPlume(f, pl)
    for (const pt of f.points) expect(pt.marginPct).toBeGreaterThanOrEqual(-1e-9)
    expect(f.points.at(-1)!.batteryPct).toBeGreaterThanOrEqual(p.reservePct)
  })

  test('a short battery cuts the flight at its point of no return and still lands with the reserve', () => {
    const short = { ...p, enduranceS: 50 }
    const f = planFlight(loop, home, null, calm, short)
    expect(f.ok).toBe(true)
    expect(f.reason).toMatch(/non-retour batterie/)
    expect(f.points.at(-1)!.batteryPct).toBeGreaterThanOrEqual(short.reservePct - 1e-9)
  })

  test('droneAt interpolates along the flight and ends landed', () => {
    const f = planFlight(loop, home, null, calm, p)
    const mid = droneAt(f, f.landedS / 2)!
    expect(mid.aloft).toBe(true)
    expect(droneAt(f, f.landedS + 10)!.aloft).toBe(false)
  })
})

// The sun for the site from the Mars24 clock (DERIVED), replacing the sun in the conditions file, plus the choice of
// EVA start times in Mars local time.

import { formatMarsClock, ltstHours, marsTime, nextLtstMs, solarElevationDeg } from '../marsTime'
import type { Conditions } from '../types'

/** The conditions series with each sample's sun elevation recomputed by Mars24 for (lat, lon). Weather is kept. */
export function withMarsSun(conditions: Conditions[], latDeg: number, lonEastDeg: number): Conditions[] {
  return conditions.map((c) => ({
    ...c,
    sunElevationDeg: Math.round(solarElevationDeg(marsTime(Date.parse(c.time)), latDeg, lonEastDeg) * 10) / 10,
    source: `${c.source} · sun: Mars24 clock (DERIVED)`,
  }))
}

export interface StartOption {
  /** ISO UTC */
  time: string
  /** "10:30" Mars local true solar time */
  ltst: string
  sunDeg: number
}

/** Planned start minimum sun elevation by default, degrees. MODELED: team assumption. */
export const DEFAULT_START_SUN_DEG = 20

/**
 * EVA start choices every `stepMin` minutes of Mars local time while the sun is up, within the conditions series
 * (so weather and radiation are known for the start).
 */
export function startOptions(conditions: Conditions[], latDeg: number, lonEastDeg: number, stepMin = 30): StartOption[] {
  if (conditions.length === 0) return []
  const from = Date.parse(conditions[0].time)
  const to = Date.parse(conditions[conditions.length - 1].time)
  const out: StartOption[] = []
  for (let k = 0; k < (24 * 60) / stepMin; k++) {
    const hour = (k * stepMin) / 60
    const ms = nextLtstMs(from, lonEastDeg, hour)
    if (ms > to) continue
    const sunDeg = solarElevationDeg(marsTime(ms), latDeg, lonEastDeg)
    if (sunDeg > 0) out.push({ time: new Date(ms).toISOString(), ltst: formatMarsClock(hour).slice(0, 5), sunDeg })
  }
  return out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
}

/** The first start with the sun at least DEFAULT_START_SUN_DEG up (or the first daylight start). */
export function defaultStartOption(options: StartOption[]): StartOption | null {
  return options.find((o) => o.sunDeg >= DEFAULT_START_SUN_DEG) ?? options[0] ?? null
}

/** "10:30 Mars local (13:12 UTC)" for a UTC time at the site. */
export function describeTime(iso: string, lonEastDeg: number): string {
  const ms = Date.parse(iso)
  return `${formatMarsClock(ltstHours(marsTime(ms), lonEastDeg)).slice(0, 5)} Mars local (${new Date(ms).toISOString().slice(11, 16)} UTC)`
}

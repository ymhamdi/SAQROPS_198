// Reading a Conditions time series (sorted by time) at arbitrary instants.

import type { Conditions } from '../types'

const ms = (c: Conditions) => Date.parse(c.time)

/** Sun elevation at tMs by linear interpolation; null outside the series. */
export function sunElevationAt(conditions: Conditions[], tMs: number): number | null {
  for (let i = 0; i + 1 < conditions.length; i++) {
    const t0 = ms(conditions[i])
    const t1 = ms(conditions[i + 1])
    if (tMs >= t0 && tMs <= t1) {
      const f = t1 === t0 ? 0 : (tMs - t0) / (t1 - t0)
      return conditions[i].sunElevationDeg + f * (conditions[i + 1].sunElevationDeg - conditions[i].sunElevationDeg)
    }
  }
  return null
}

/** First time at or after fromMs when the sun goes down through 0°, interpolated; null if not in the series. */
export function findSunset(conditions: Conditions[], fromMs: number): number | null {
  for (let i = 0; i + 1 < conditions.length; i++) {
    const e0 = conditions[i].sunElevationDeg
    const e1 = conditions[i + 1].sunElevationDeg
    if (!(e0 > 0 && e1 <= 0)) continue
    const t0 = ms(conditions[i])
    const t1 = ms(conditions[i + 1])
    const t = t0 + ((t1 - t0) * e0) / (e0 - e1)
    if (t >= fromMs) return t
  }
  return null
}

/** Whether the series covers the whole window [startMs, endMs]. */
export function coversWindow(conditions: Conditions[], startMs: number, endMs: number): boolean {
  return conditions.length > 0 && ms(conditions[0]) <= startMs && ms(conditions[conditions.length - 1]) >= endMs
}

/** Samples with a radiation alert whose interval (until the next sample) overlaps the window. */
export function radiationAlertsIn(conditions: Conditions[], startMs: number, endMs: number): Conditions[] {
  return conditions.filter((c, i) => {
    const from = ms(c)
    const until = i + 1 < conditions.length ? ms(conditions[i + 1]) : from
    return c.radiationAlert && from <= endMs && until >= startMs
  })
}

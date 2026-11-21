// Warnings that change while the walk is under way, for the tablet and the HUD: evaluated at one EVA time.

import type { Conditions } from '../types'
import { findSunset, radiationAlertsIn } from './conditions'
import { formatDuration } from './format'
import type { EvaParams, Severity } from './goNoGo'

export interface LiveWarning {
  code: 'NO_RETURN' | 'MARGIN_LOW' | 'O2_LOW' | 'SUNSET_SOON' | 'RADIATION_NOW'
  severity: Exclude<Severity, 'info'>
  message: string
}

/** Thresholds for the live warnings. MODELED: team assumptions. */
export const LIVE_WARNING_LIMITS = {
  /** warn when the emergency walk-home margin drops below this, s */
  marginLowS: 3600,
  /** warn when O2 left drops below reserve + this, s */
  o2LowAboveReserveS: 1800,
  /** warn when sunset is closer than this, s */
  sunsetSoonS: 3600,
}

export interface LiveInput {
  /** EVA clock, s since the start */
  t: number
  startTime: string
  /** emergency walk home from where the crew is now, s (walk-home field × contingency) */
  emergencyHomeS: number
  conditions: Conditions[]
  params: EvaParams
}

export function liveWarnings({ t, startTime, emergencyHomeS, conditions, params }: LiveInput): LiveWarning[] {
  const out: LiveWarning[] = []
  const now = Date.parse(startTime) + t * 1000
  const o2Left = params.o2DurationS - t
  const margin = params.o2DurationS - params.o2ReserveS - (t + emergencyHomeS)

  if (radiationAlertsIn(conditions, now, now).length > 0) {
    out.push({ code: 'RADIATION_NOW', severity: 'no-go', message: 'Radiation alert now: head to the nearest shelter.' })
  }
  if (!Number.isFinite(emergencyHomeS) || margin < 0) {
    out.push({ code: 'NO_RETURN', severity: 'no-go', message: 'Past the point of no return: turn back to safety now.' })
  } else if (margin < LIVE_WARNING_LIMITS.marginLowS) {
    out.push({ code: 'MARGIN_LOW', severity: 'caution', message: `Walk-home margin down to ${formatDuration(margin)}.` })
  }
  if (o2Left < params.o2ReserveS + LIVE_WARNING_LIMITS.o2LowAboveReserveS) {
    out.push({ code: 'O2_LOW', severity: o2Left < params.o2ReserveS ? 'no-go' : 'caution', message: `O₂ left ${formatDuration(o2Left)}.` })
  }
  const sunset = findSunset(conditions, now)
  if (sunset !== null && (sunset - now) / 1000 < LIVE_WARNING_LIMITS.sunsetSoonS) {
    out.push({ code: 'SUNSET_SOON', severity: 'caution', message: `Sunset in ${formatDuration((sunset - now) / 1000)}.` })
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'no-go' ? -1 : 1))
}

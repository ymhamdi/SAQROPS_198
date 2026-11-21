// One ranked alert list for the walk views (HUD, tablet, and later drone or storm feeds): live warnings first, then
// the plan's no-go reasons, then cautions. Only the first one takes the alert slot; a live warning takes over the
// visor. Wording only: every threshold stays in stats/live.ts and stats/goNoGo.ts.

import { formatDuration } from '../stats/format'
import type { Reason, ReasonCode } from '../stats/goNoGo'
import type { LiveWarning } from '../stats/live'

export type AlertLevel = 'warning' | 'caution'

export interface WalkAlert {
  key: string
  /** warning = act now (red); caution = watch (amber) */
  level: AlertLevel
  /** a few words, read in under a second */
  title: string
  /** what to do, imperative, for warnings */
  action: string | null
  /** the full sentence, for the tablet and screen readers */
  detail: string
  /** happening now (from the walk clock), not a property of the plan */
  live: boolean
  /** raised by the simulated storm drill: always labelled SIMULATED */
  drill: boolean
}

export interface LiveNumbers {
  /** emergency walk-home margin now, s */
  marginS: number
  /** suit O₂ left now, s */
  o2LeftS: number
}

const PLAN_TITLE: Partial<Record<ReasonCode, string>> = {
  NO_PATH: 'No walkable path',
  NO_GO_CELLS: 'Route crosses impassable ground',
  O2_BUDGET: 'Plan exceeds the O₂ budget',
  POINT_OF_NO_RETURN: 'Plan passes the point of no return',
  DARK_START: 'Starts before sunrise',
  SUNSET: 'Plan ends too close to sunset',
  RADIATION: 'Radiation alert during the walk',
  NO_CONDITIONS: 'Weather data incomplete',
  STEEP_SECTIONS: 'Steep sections on the route',
  SAND: 'Loose sand on the route',
  BOULDERS: 'Boulders on the route',
  COMMS: 'Radio shadow on the route',
  SPACE_WEATHER: 'Space-weather advisory',
}

function fromLive(w: LiveWarning, n: LiveNumbers, drill: boolean): WalkAlert {
  const base = { key: `live-${w.code}`, live: true, drill: false, detail: w.message }
  switch (w.code) {
    case 'RADIATION_NOW':
      return { ...base, level: 'warning', title: 'Radiation alert', action: 'Take shelter now', drill }
    case 'NO_RETURN':
      return { ...base, level: 'warning', title: 'Past the point of no return', action: 'Turn back now' }
    case 'O2_LOW':
      return w.severity === 'no-go'
        ? { ...base, level: 'warning', title: 'O₂ below reserve', action: 'Turn back now' }
        : { ...base, level: 'caution', title: `O₂ low · ${formatDuration(n.o2LeftS)} left`, action: null }
    case 'MARGIN_LOW':
      return { ...base, level: 'caution', title: `Point of no return in ${formatDuration(n.marginS)}`, action: null }
    case 'SUNSET_SOON':
      return { ...base, level: 'caution', title: w.message.replace(/\.$/, ''), action: null }
  }
}

function fromPlan(r: Reason, drill: boolean): WalkAlert {
  return {
    key: `plan-${r.code}`,
    level: r.severity === 'no-go' ? 'warning' : 'caution',
    title: PLAN_TITLE[r.code] ?? r.message,
    action: r.severity === 'no-go' ? 'Plan is NO-GO' : null,
    detail: r.message,
    live: false,
    drill: drill && r.code === 'RADIATION',
  }
}

/**
 * Ranked alerts: live warnings → plan no-go → live cautions → plan cautions. A plan reason that a live alert already
 * covers (radiation now, past the point of no return) is dropped, so one fact never shows twice.
 */
export function walkAlerts(live: LiveWarning[], plan: Reason[], numbers: LiveNumbers, drill = false): WalkAlert[] {
  const l = live.map((w) => fromLive(w, numbers, drill))
  const liveCodes = new Set(live.map((w) => w.code))
  const covered: Partial<Record<ReasonCode, boolean>> = {
    RADIATION: liveCodes.has('RADIATION_NOW'),
    POINT_OF_NO_RETURN: liveCodes.has('NO_RETURN'),
    O2_BUDGET: liveCodes.has('O2_LOW'),
  }
  const p = plan.filter((r) => r.severity !== 'info' && !covered[r.code]).map((r) => fromPlan(r, drill))
  const rank = (a: WalkAlert) => (a.level === 'warning' ? (a.live ? 0 : 1) : a.live ? 2 : 3)
  return [...l, ...p].sort((a, b) => rank(a) - rank(b))
}

/** True when the first alert must take over the visor: a live warning. */
export const takesOver = (alerts: WalkAlert[]) => alerts[0]?.level === 'warning' && alerts[0].live

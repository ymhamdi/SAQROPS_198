// GO / NO-GO for one planned EVA, always with reasons (CLAUDE.md §2 Safety).

import { COMMS_CAUTION_MIN, O2_RESERVE_MIN, RAD_BASELINE_DOSE_MSV_PER_DAY, SUIT_O2_DURATION_MIN, SUNSET_MARGIN_MIN, WALK_HOME_CONTINGENCY_FACTOR } from '../config'
import { isPassable, type PreparedGrid } from '../route/cost'
import type { RouteResult } from '../route/route'
import { TERRAIN, type Conditions, type DataStatus, type SpaceWeather } from '../types'
import { commsGaps } from './comms'
import { coversWindow, findSunset, radiationAlertsIn, sunElevationAt } from './conditions'
import { formatDistance, formatDuration } from './format'
import { routeStats, safetyS, type RouteStats } from './stats'
import { worstStatus } from './status'

export type Severity = 'no-go' | 'caution' | 'info'

export type ReasonCode =
  | 'NO_PATH'
  | 'NO_GO_CELLS'
  | 'O2_BUDGET'
  | 'POINT_OF_NO_RETURN'
  | 'DARK_START'
  | 'SUNSET'
  | 'RADIATION'
  | 'NO_CONDITIONS'
  | 'DOSE'
  | 'STEEP_SECTIONS'
  | 'SAND'
  | 'BOULDERS'
  | 'COMMS'
  | 'SPACE_WEATHER'

export interface Reason {
  code: ReasonCode
  severity: Severity
  message: string
}

export interface EvaParams {
  o2DurationS: number
  o2ReserveS: number
  sunsetMarginS: number
  walkHomeContingency: number
}

export const DEFAULT_EVA_PARAMS: EvaParams = {
  o2DurationS: SUIT_O2_DURATION_MIN * 60,
  o2ReserveS: O2_RESERVE_MIN * 60,
  sunsetMarginS: SUNSET_MARGIN_MIN * 60,
  walkHomeContingency: WALK_HOME_CONTINGENCY_FACTOR,
}

export interface EvaInput {
  prepared: PreparedGrid
  route: RouteResult
  /** walkHomeField(prepared, base): seconds from every cell back to base */
  walkHome: Float32Array
  /** EVA start, ISO 8601 UTC */
  startTime: string
  conditions: Conditions[]
  dwellS?: number | number[]
  params?: EvaParams
  /** 1 per cell with radio line of sight to the habitat or the staged rover; omitted = not checked */
  lineOfSight?: Uint8Array
  /** space-weather windows (NASA DONKI); 'advisory' ones overlapping the EVA give a caution. Omitted = not checked */
  spaceWeather?: SpaceWeather['windows']
  /** the rover's prepared grid, to time the driven steps of a rover-assisted route (route legs with `ride`) */
  drive?: PreparedGrid
}

export interface EvaVerdict {
  verdict: 'GO' | 'NO-GO'
  reasons: Reason[]
  stats: RouteStats | null
  endTime: string | null
  /** surface background radiation dose over the EVA, mSv (rate OBSERVED by Curiosity RAD, duration MODELED) */
  doseMSv: number | null
  /** weakest data status behind the verdict; never better than MODELED (suit and O2 are assumptions) */
  status: DataStatus
}

export function evaluateEva(input: EvaInput): EvaVerdict {
  const { prepared: p, route, walkHome, conditions } = input
  const params = input.params ?? DEFAULT_EVA_PARAMS
  const status = worstStatus('MODELED', p.grid.status, ...conditions.map((c) => c.status))
  const reasons: Reason[] = []
  const add = (code: ReasonCode, severity: Severity, message: string) => reasons.push({ code, severity, message })
  const done = (stats: RouteStats | null, endTime: string | null): EvaVerdict => ({
    verdict: reasons.some((r) => r.severity === 'no-go') ? 'NO-GO' : 'GO',
    reasons: [...reasons].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    stats,
    endTime,
    doseMSv: stats ? evaDoseMSv(stats.totalS) : null,
    status,
  })

  if (!route.ok) {
    add(
      'NO_PATH',
      'no-go',
      route.reason
        ? `No rover-assisted route: ${route.reason}. Walk this plan, or change the first or last stop.`
        : `No walkable path for leg ${route.failedLeg + 1}: blocked by steep ground or no-go terrain.`,
    )
    return done(null, null)
  }

  const stats = routeStats(p, route.legs, input.dwellS, input.drive)
  const usableO2 = params.o2DurationS - params.o2ReserveS
  const startMs = Date.parse(input.startTime)
  const endMs = startMs + stats.totalS * 1000
  const at = (i: number) => `${formatDistance(stats.track[i].distanceM)} into the route (leg ${stats.track[i].leg + 1})`

  // Impassable cells on the route (only possible if the route was not built by the engine with these params).
  const blocked = stats.track.filter((t) => !t.riding && (!isPassable(p, t.cell) || p.grid.terrainClass[t.cell] === TERRAIN.NO_GO))
  if (blocked.length > 0) {
    add('NO_GO_CELLS', 'no-go', `Route crosses ${blocked.length} impassable cells (no-go terrain or slope ≥ ${p.params.slopeImpassableDeg}°).`)
  }

  // O2 budget.
  if (stats.totalS > usableO2) {
    add(
      'O2_BUDGET',
      'no-go',
      `The Marswalk takes ${formatDuration(stats.totalS)} but O₂ allows ${formatDuration(usableO2)} before the ` +
        `${formatDuration(params.o2ReserveS)} reserve (short by ${formatDuration(stats.totalS - usableO2)}).`,
    )
  } else {
    add('O2_BUDGET', 'info', `Back at base with ${formatDuration(params.o2DurationS - stats.totalS)} of O₂ left (reserve ${formatDuration(params.o2ReserveS)}).`)
  }

  // Point of no return: from every point, an emergency walk home must still fit in the O₂ above reserve.
  let worst = Infinity
  let worstIndex = 0
  let passedIndex = -1
  stats.track.forEach((t, i) => {
    if (t.riding) return // in the rover: it is the way home
    const margin = usableO2 - (t.departS + params.walkHomeContingency * safetyS(walkHome, t))
    if (margin < worst) {
      worst = margin
      worstIndex = i
    }
    if (margin < 0 && passedIndex === -1) passedIndex = i
  })
  if (passedIndex !== -1) {
    const t = stats.track[passedIndex]
    const home = safetyS(walkHome, t)
    add(
      'POINT_OF_NO_RETURN',
      'no-go',
      Number.isFinite(home)
        ? `Point of no return passed ${at(passedIndex)}: an emergency walk home from there takes ` +
            `${formatDuration(params.walkHomeContingency * home)} but only ${formatDuration(usableO2 - t.departS)} of O₂ is left above reserve.`
        : `No way back to the habitat or the rover from ${at(passedIndex)}.`,
    )
  } else {
    add(
      'POINT_OF_NO_RETURN',
      'info',
      `Never past the point of no return: the tightest emergency-return margin is ${formatDuration(worst)}, ${at(worstIndex)} ` +
        `(walk home assumed ${params.walkHomeContingency}× slower than planned).`,
    )
  }

  // Daylight.
  const sunAtStart = sunElevationAt(conditions, startMs)
  const sunset = findSunset(conditions, startMs)
  if (sunAtStart !== null && sunAtStart <= 0) {
    add('DARK_START', 'no-go', `Sun is below the horizon at the planned start (${sunAtStart.toFixed(0)}°).`)
  } else if (sunset !== null) {
    const spare = (sunset - endMs) / 1000
    if (spare < params.sunsetMarginS) {
      add(
        'SUNSET',
        'no-go',
        spare < 0
          ? `Sunset comes ${formatDuration(-spare)} before the crew is back.`
          : `Back only ${formatDuration(spare)} before sunset; the rule is at least ${formatDuration(params.sunsetMarginS)}.`,
      )
    } else {
      add('SUNSET', 'info', `Back ${formatDuration(spare)} before sunset.`)
    }
  }

  // Radiation / space weather.
  const covered = coversWindow(conditions, startMs, endMs)
  const alerts = radiationAlertsIn(conditions, startMs, endMs)
  if (alerts.length > 0) {
    const from = new Date(Math.max(Date.parse(alerts[0].time), startMs)).toISOString().slice(11, 16)
    add('RADIATION', 'no-go', `Radiation alert during the Marswalk (from ${from} UTC): stay in the habitat or a shelter.`)
  } else if (covered) {
    add('RADIATION', 'info', 'No radiation alert during the Marswalk.')
  }
  // Space-weather advisories (minor or glancing CME forecasts for Mars) overlapping the walk.
  if (input.spaceWeather) {
    const overlapping = input.spaceWeather.filter((w) => w.level === 'advisory' && Date.parse(w.start) < endMs && Date.parse(w.end) > startMs)
    if (overlapping.length > 0) {
      const until = new Date(Math.max(...overlapping.map((w) => Date.parse(w.end)))).toISOString().slice(11, 16)
      add('SPACE_WEATHER', 'caution', `Space-weather advisory until ${until} UTC: ${overlapping[0].reason} Watch the radiation monitor and be ready to shelter.`)
    } else {
      add('SPACE_WEATHER', 'info', 'No CME forecast to reach Mars during the Marswalk (NASA DONKI).')
    }
  }

  // Background dose of the walk itself (suit shielding not counted, so this is an upper bound for the background).
  const dose = evaDoseMSv(stats.totalS)
  add(
    'DOSE',
    'info',
    `Radiation dose for this Marswalk about ${dose.toFixed(2)} mSv at the Gale surface background (Curiosity RAD, ` +
      `${RAD_BASELINE_DOSE_MSV_PER_DAY} mSv/day; suit shielding not counted)${alerts.length ? '; a solar storm adds more' : ''}.`,
  )
  if (!covered) {
    add('NO_CONDITIONS', 'caution', 'Conditions data does not cover the whole Marswalk: daylight and radiation are not fully checked.')
  }

  // Radio contact: time out of line of sight with every antenna (habitat mast, staged rover).
  if (input.lineOfSight) {
    const gaps = commsGaps(stats.track, input.lineOfSight)
    if (gaps.outS >= COMMS_CAUTION_MIN * 60) {
      add(
        'COMMS',
        'caution',
        `Out of radio line of sight with the habitat and the rover for ${formatDuration(gaps.outS)} in total ` +
          `(longest ${formatDuration(gaps.longestS)}, from ${at(gaps.longestStart)}). Agree check-in points, or stage the rover with a view of the route.`,
      )
    } else {
      add('COMMS', 'info', 'In radio line of sight with the habitat or the rover for the whole Marswalk.')
    }
  }

  // Hazards along the route.
  const steepCells = stats.track.filter((t) => !t.riding && p.grid.slopeDeg[t.cell] > p.params.slopePenaltyStartDeg).length
  if (steepCells > 0) {
    add(
      'STEEP_SECTIONS',
      'caution',
      `About ${formatDistance(steepCells * p.grid.cellSizeM)} of route on slopes over ${p.params.slopePenaltyStartDeg}° (max ${stats.maxSlopeDeg.toFixed(0)}°).`,
    )
  }
  if (stats.timeByTerrainS[TERRAIN.SAND] >= 60) {
    add('SAND', 'caution', `${formatDuration(stats.timeByTerrainS[TERRAIN.SAND])} of walking on loose sand.`)
  }
  if (stats.timeByTerrainS[TERRAIN.BOULDERS] >= 60) {
    add('BOULDERS', 'caution', `${formatDuration(stats.timeByTerrainS[TERRAIN.BOULDERS])} of walking through boulder fields.`)
  }

  return done(stats, Number.isFinite(endMs) ? new Date(endMs).toISOString() : null)
}

/** Surface background dose over an EVA of totalS seconds, mSv (Hassler et al. 2014 rate x MODELED duration). */
export function evaDoseMSv(totalS: number): number {
  return (RAD_BASELINE_DOSE_MSV_PER_DAY * totalS) / 86400
}

const SEVERITY_ORDER: Record<Severity, number> = { 'no-go': 0, caution: 1, info: 2 }

// The plan in the URL hash, so a link opens the same Marswalk: stops (science targets by id, via points by
// position), planned start, rover staging, chosen route and the storm drill. Layers, panels and views are not shared.
// Example: #stops=t:drill-1,v:-4.712345:137.384567&start=2026-11-15T10:25:03.000Z&rover=2&route=fastest&storm=1&prio=hl
// (prio: one letter per stop, h / m / l, left out when every stop is medium)

import type { RouteProfile } from './route/cost'
import { DEFAULT_PRIORITY, PRIORITIES, priorityOf, type Priorities } from './stats/risk'
import type { ScienceTarget, Waypoint } from './types'

export interface SharedPlan {
  stops: Waypoint[]
  /** ISO UTC; null = the default start */
  startTime: string | null
  /** 'habitat' or the id of the stop where the rover is staged */
  roverAt: string
  profile: RouteProfile
  storm: boolean
  /** rover-assisted: ride the rover to the first stop and back */
  ride?: boolean
  /** stop priorities by stop id (missing = medium) */
  priorities?: Priorities
}

export interface DecodedPlan extends SharedPlan {
  /** what the link asked for but could not be restored, one line each */
  skipped: string[]
}

/** Via point coordinates in the link: 6 decimals ≈ 6 cm on Mars, well inside a 2 m cell. */
const COORD_DECIMALS = 6

/** The hash for a plan ('' for an empty plan with defaults). */
export function encodePlan(plan: SharedPlan): string {
  const parts: string[] = []
  if (plan.stops.length > 0) {
    const tokens = plan.stops.map((s) =>
      s.kind === 'via' ? `v:${s.lat.toFixed(COORD_DECIMALS)}:${s.lon.toFixed(COORD_DECIMALS)}` : `t:${encodeURIComponent(s.id)}`,
    )
    parts.push(`stops=${tokens.join(',')}`)
  }
  if (plan.startTime) parts.push(`start=${plan.startTime}`)
  const rover = plan.stops.findIndex((s) => s.id === plan.roverAt)
  if (rover >= 0) parts.push(`rover=${rover + 1}`)
  if (plan.profile === 'fastest') parts.push('route=fastest')
  if (plan.storm) parts.push('storm=1')
  if (plan.ride) parts.push('ride=1')
  const prio = plan.stops.map((s) => priorityOf(plan.priorities ?? {}, s.id))
  if (prio.some((p) => p !== DEFAULT_PRIORITY)) parts.push(`prio=${prio.map((p) => p[0]).join('')}`)
  return parts.length > 0 ? `#${parts.join('&')}` : ''
}

/**
 * The plan in a hash, or null when the hash holds none. `problem` judges each stop as a clicked stop would be
 * (outside the site, impassable) and returns a reason to skip it, or null.
 */
export function decodePlan(hash: string, targets: ScienceTarget[], problem: (w: Waypoint) => string | null): DecodedPlan | null {
  const fields = new Map<string, string>()
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=')
    if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1))
  }
  if (!['stops', 'start', 'rover', 'route', 'storm', 'ride', 'prio'].some((k) => fields.has(k))) return null

  const skipped: string[] = []
  const stops: Waypoint[] = []
  /** encoded position (1-based) → restored stop id, for the rover */
  const restored = new Map<number, string>()
  let via = 0
  const tokens = (fields.get('stops') ?? '').split(',').filter(Boolean)
  tokens.forEach((token, i) => {
    const colon = token.indexOf(':')
    const kind = token.slice(0, colon)
    const rest = token.slice(colon + 1)
    let w: Waypoint | null = null
    if (kind === 't') {
      let id = rest
      try {
        id = decodeURIComponent(rest)
      } catch {
        // keep the raw text
      }
      const t = targets.find((x) => x.id === id)
      if (!t) return skipped.push(`Stop ${i + 1}: no science target "${id}" at this site.`)
      if (stops.some((s) => s.id === t.id)) return
      w = { id: t.id, lat: t.lat, lon: t.lon, kind: 'science', name: t.name }
    } else if (kind === 'v') {
      const [lat, lon] = rest.split(':').map((x) => (x === '' ? NaN : Number(x)))
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        via += 1
        w = { id: `via-${via}`, lat, lon, kind: 'via', name: `Via point ${via}` }
      }
    }
    if (!w) return skipped.push(`Stop ${i + 1}: unreadable in the link.`)
    const why = problem(w)
    if (why) {
      if (w.kind === 'via') via -= 1
      return skipped.push(`Stop ${i + 1} (${w.name}): ${why}`)
    }
    stops.push(w)
    restored.set(i + 1, w.id)
  })

  let startTime: string | null = null
  const start = fields.get('start')
  if (start !== undefined) {
    const ms = Date.parse(decodeSafe(start))
    if (Number.isFinite(ms)) startTime = new Date(ms).toISOString()
    else skipped.push('The start time in the link is unreadable: the default start is used.')
  }

  let roverAt = 'habitat'
  const rover = fields.get('rover')
  if (rover !== undefined) {
    const id = restored.get(Number(rover))
    if (id) roverAt = id
    else skipped.push('The rover stop in the link was not restored: the rover stays at the habitat.')
  }

  // Priorities follow the stops' positions in the link; letters for stops that were not restored are dropped with them.
  const priorities: Priorities = {}
  ;[...(fields.get('prio') ?? '')].forEach((letter, i) => {
    const id = restored.get(i + 1)
    const p = PRIORITIES.find((x) => x[0] === letter)
    if (id && p && p !== DEFAULT_PRIORITY) priorities[id] = p
  })

  return {
    stops,
    startTime,
    roverAt,
    profile: fields.get('route') === 'fastest' ? 'fastest' : 'safest',
    storm: fields.get('storm') === '1',
    ride: fields.get('ride') === '1',
    priorities,
    skipped,
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

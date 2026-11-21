// Walking the plan in time: where the crew is at an EVA time, where the next stop lies, who does what, and the
// inputs the panels need (nearest panorama, simulated storm).

import type { Conditions, PovImage, ScienceTarget, Waypoint } from '../types'
import { sphericalDistanceM, type RouteStats, type TrackPoint } from './stats'

export interface Position {
  lat: number
  lon: number
  /** track index at or just before the position */
  index: number
  /** true while dwelling at a stop */
  atStop: boolean
  /** index into stations = [base, ...stops, base] of the next stop to reach (or the one being worked) */
  nextStation: number
}

/** Where the crew is at EVA time t (seconds), interpolated along the track; clamped to the walk. */
export function positionAt(track: TrackPoint[], t: number): Position {
  const last = track.length - 1
  if (t <= 0) return { lat: track[0].lat, lon: track[0].lon, index: 0, atStop: false, nextStation: 1 }
  if (t >= track[last].arriveS) return { lat: track[last].lat, lon: track[last].lon, index: last, atStop: true, nextStation: track[last].leg + 1 }
  // Last point that has been reached by t.
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (track[mid].arriveS <= t) lo = mid
    else hi = mid - 1
  }
  const p = track[lo]
  const q = track[lo + 1]
  if (t <= p.departS) {
    // Dwelling at a stop (or exactly on a point): the stop worked is the end of p's leg.
    const isStop = p.departS > p.arriveS
    return { lat: p.lat, lon: p.lon, index: lo, atStop: isStop, nextStation: isStop ? p.leg + 1 : q.leg + 1 }
  }
  const f = (t - p.departS) / (q.arriveS - p.departS)
  return { lat: p.lat + f * (q.lat - p.lat), lon: p.lon + f * (q.lon - p.lon), index: lo, atStop: false, nextStation: q.leg + 1 }
}

/**
 * Track index of the next stop: where the stretch the crew is on (or about to start, when working at a stop) ends.
 * `index` = track index at or just before the crew; `isStop(leg)` = the leg ends at a real stop (legs ending at a via
 * point carry on to the next one). Default: every leg ends at a stop.
 */
export function currentLegEnd(track: TrackPoint[], index: number, isStop: (leg: number) => boolean = () => true): number {
  const last = track.length - 1
  const i = Math.max(0, Math.min(index, last))
  if (i === last) return last
  let end = i + 1
  for (;;) {
    const leg = track[end].leg
    while (end < last && track[end + 1].leg === leg) end++
    if (end >= last || isStop(leg)) return end
    end++
  }
}

/** A via point mission control puts where it cut the route: passed through, never announced as the next stop. */
export const isRouteChangePoint = (w: { id: string; kind: string }) => w.kind === 'via' && w.id.startsWith('reroute-')

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function initialBearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const φ1 = a.lat * rad
  const φ2 = b.lat * rad
  const Δλ = (b.lon - a.lon) * rad
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360
}

export function compassPoint(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}

export type Actor = 'EV1' | 'EV2' | 'Rover'

export interface Segment {
  actor: Actor
  startS: number
  endS: number
  kind: 'walk' | 'task' | 'drive' | 'parked'
  label: string
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface CrewTasks {
  ev1: string
  ev2: string
  rover: string
}

/**
 * Who does what at one stop (MODELED: our crew rule, not a NASA procedure). The target's instruments alternate
 * between the pair (EV1 takes the 1st, 3rd, …; EV2 the 2nd, 4th, …); the rover parks as tool carrier and safe haven.
 */
/** `roverStagedAt` value for a rover-assisted Marswalk, where the rover travels with the crew. */
export const ROVER_WITH_CREW = 'with the crew'

export function crewAtStop(stop: Waypoint, targets: ScienceTarget[], roverStagedAt: string | null = stop.name): CrewTasks {
  const kit = targets.find((t) => t.id === stop.id)?.instrumentsNeeded ?? []
  const ev1 = kit.filter((_, k) => k % 2 === 0)
  const ev2 = kit.filter((_, k) => k % 2 === 1)
  return {
    ev1: ev1.length ? sentence(ev1.join(', ')) : 'Survey and photograph',
    ev2: ev2.length ? sentence(ev2.join(', ')) : 'Survey and photograph',
    rover:
      roverStagedAt === ROVER_WITH_CREW
        ? `Travels with the crew and parks nearby: tools, safe haven and radio relay`
        : roverStagedAt === stop.name
        ? `Staged here: tools and safe haven`
        : roverStagedAt
          ? `Standing by at ${roverStagedAt} as safe haven`
          : `Standing by at the habitat`,
  }
}

/**
 * The EVA as segments per actor (MODELED). Both astronauts walk every leg together while the rover escorts them;
 * at each stop they work as `crewAtStop` assigns.
 */
export function buildTimeline(stats: RouteStats, stops: Waypoint[], targets: ScienceTarget[]): Segment[] {
  const out: Segment[] = []
  const lastOfLeg: (TrackPoint | undefined)[] = []
  for (const p of stats.track) lastOfLeg[p.leg] = p
  let legStart = 0
  stats.legs.forEach((_, i) => {
    // A zero-length leg (two stops on the same cell) has no track points of its own: it ends where it starts.
    const end = lastOfLeg[i] ?? { arriveS: legStart, departS: legStart }
    const to = i < stops.length ? stops[i] : null
    const toName = to ? to.name : 'habitat'
    out.push({ actor: 'EV1', startS: legStart, endS: end.arriveS, kind: 'walk', label: `Walk to ${toName}` })
    out.push({ actor: 'EV2', startS: legStart, endS: end.arriveS, kind: 'walk', label: `Walk to ${toName}` })
    out.push({ actor: 'Rover', startS: legStart, endS: end.arriveS, kind: 'drive', label: `Escort to ${toName}` })
    if (to && end.departS > end.arriveS) {
      const crew = crewAtStop(to, targets)
      out.push({ actor: 'EV1', startS: end.arriveS, endS: end.departS, kind: 'task', label: crew.ev1 })
      out.push({ actor: 'EV2', startS: end.arriveS, endS: end.departS, kind: 'task', label: crew.ev2 })
      out.push({ actor: 'Rover', startS: end.arriveS, endS: end.departS, kind: 'parked', label: crew.rover })
    }
    legStart = end.departS
  })
  return out
}

/** The panorama nearest to a point, if one lies within maxM metres. */
/**
 * The images taken from the camera position nearest (lat, lon), within maxM, in file order. Only that one spot:
 * neighbouring stops a few metres away have their own images, which must not mix in.
 */
export function povsNear(povs: PovImage[], lat: number, lon: number, maxM = 30): PovImage[] {
  const nearest = nearestPov(povs, lat, lon, maxM)
  if (!nearest) return []
  return povs.filter((p) => sphericalDistanceM(p, nearest) < 0.5)
}

export function nearestPov(povs: PovImage[], lat: number, lon: number, maxM = 30): PovImage | null {
  let best: PovImage | null = null
  let bestD = maxM
  for (const p of povs) {
    const d = sphericalDistanceM(p, { lat, lon })
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/**
 * A simulated solar particle event: radiation alert on every conditions sample from one hour before `fromMs`
 * to `toMs`. Used by the "simulate solar storm" switch; the panels label it SIMULATED.
 */
export function withSimulatedStorm(conditions: Conditions[], fromMs: number, toMs: number): Conditions[] {
  return conditions.map((c) => {
    const t = Date.parse(c.time)
    return t >= fromMs - 3600_000 && t <= toMs ? { ...c, radiationAlert: true } : c
  })
}

/** Earth days per Mars sol (Mars24). */
const DAYS_PER_SOL = 1.0274912517

/**
 * When the rover worked at the given stops: the sols of its traverse points within maxM of any stop.
 * Null when no stop is on the traverse. `sols` counts first to last, inclusive.
 */
export function roverSolsAt(points: { sol: number; lat: number; lon: number }[], stops: { lat: number; lon: number }[], maxM = 30) {
  const sols = points.filter((p) => stops.some((s) => sphericalDistanceM(p, s) <= maxM)).map((p) => p.sol)
  if (sols.length === 0) return null
  const first = Math.min(...sols)
  const last = Math.max(...sols)
  const matched = stops.filter((s) => points.some((p) => sphericalDistanceM(p, s) <= maxM)).length
  return { first, last, sols: last - first + 1, earthDays: Math.round((last - first + 1) * DAYS_PER_SOL), stopsMatched: matched }
}


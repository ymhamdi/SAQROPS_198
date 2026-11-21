// Changing the rest of a Marswalk while the crew is out (mission control). The plan is cut where the crew is: the part
// already walked is kept exactly, and only the rest is planned again, from the crew's position (and, on a
// rover-assisted plan, from where the rover really is). Pure: the caller plans the rest in its worker and judges it.

import type { TrackPoint } from '../stats/stats'
import { rideInfo, roverAtLegEnd, type Leg, type RouteResult } from './route'

type OkRoute = Extract<RouteResult, { ok: true }>

/** Where the crew is on the plan's track. */
export interface CrewAt {
  /** track index at or just before the crew */
  index: number
  /** working at a stop (not walking) */
  atStop: boolean
}

export type Split =
  /** the walk is over (or nearly home): nothing left to change */
  | { kind: 'done' }
  | {
      kind: 'split'
      /** stops reached (or being worked) that stay on the plan as they are: stops.slice(0, kept) */
      kept: number
      /** legs kept exactly, up to the cut */
      prefix: Leg[]
      /** cell the rest of the walk is planned from */
      fromCell: number
      /** mid-leg cut: a via point is placed on this cell, so legs keep matching stops; null when cut at a stop */
      reroute: number | null
      /** rover-assisted plan: where the rover is at the cut (the crew's cell when they are riding) */
      roverStart?: number
    }

/** Track index of the first point that belongs to leg `leg` (for leg 0 the habitat itself). */
function legStart(track: TrackPoint[], leg: number): number {
  let i = 0
  while (i < track.length && track[i].leg < leg) i++
  return i
}

/** The first k + 1 cells of a leg, with the rover annotations that go with them. */
function sliceLeg(leg: Leg, k: number): Leg {
  const n = k + 1
  return {
    from: leg.from,
    to: leg.cells[k],
    cells: leg.cells.slice(0, n),
    timeS: leg.cells.length > 1 ? (leg.timeS * k) / (leg.cells.length - 1) : 0, // re-timed by routeStats
    ...(leg.ride ? { ride: leg.ride.slice(0, n) } : {}),
    ...(leg.rover ? { rover: leg.rover.slice(0, n) } : {}),
    ...(leg.toRoverS ? { toRoverS: leg.toRoverS.slice(0, n) } : {}),
    ...(leg.roverInSight ? { roverInSight: leg.roverInSight.slice(0, n) } : {}),
  }
}

const atStopSplit = (route: OkRoute, at: number, fromCell: number): Split => ({
  kind: 'split',
  kept: at + 1,
  prefix: route.legs.slice(0, at + 1),
  fromCell,
  reroute: null,
  roverStart: roverAtLegEnd(route.legs[at]),
})

/**
 * Where to cut the plan for a change sent now. Mid-leg the cut is `leadCells` ahead of the crew on the same leg, so the
 * crew does not have to turn back to reach it; at a stop (or arriving at one) the cut is the stop, which stays on the
 * plan. Before the walk starts the whole plan can change.
 */
export function splitAt(route: OkRoute, track: TrackPoint[], crew: CrewAt, leadCells = 0): Split {
  const last = track.length - 1
  const i = Math.max(0, Math.min(crew.index, last))
  if (i >= last) return { kind: 'done' }
  if (crew.atStop) return atStopSplit(route, track[i].leg, track[i].cell)
  if (i === 0) return { kind: 'split', kept: 0, prefix: [], fromCell: track[0].cell, reroute: null }
  const leg = track[i + 1].leg
  let j = Math.min(i + 1 + leadCells, last)
  while (track[j].leg !== leg) j--
  const legEnd = j === last || track[j + 1].leg !== leg
  if (legEnd) {
    // Arriving at a stop: cut there. Arriving home: cut one cell before it, if the crew is not already there.
    if (leg < route.legs.length - 1) return atStopSplit(route, leg, track[j].cell)
    if (j - 1 <= i) return { kind: 'done' }
    j -= 1
  }
  const k = j - legStart(track, leg) + (leg === 0 ? 0 : 1)
  const partial = sliceLeg(route.legs[leg], k)
  const cell = partial.cells[k]
  const rover = track[j].riding ? cell : track[j].roverCell
  return { kind: 'split', kept: leg, prefix: [...route.legs.slice(0, leg), partial], fromCell: cell, reroute: cell, ...(rover !== undefined ? { roverStart: rover } : {}) }
}

/** The kept part and the newly planned rest as one plan. `base` = the habitat cell. */
export function joinRoute(split: Extract<Split, { kind: 'split' }>, rest: OkRoute, base: number, ride: boolean): OkRoute {
  const legs = [...split.prefix, ...rest.legs]
  return { ok: true, legs, timeS: legs.reduce((t, l) => t + l.timeS, 0), ...(ride ? { ride: rideInfo(legs, base) } : {}) }
}

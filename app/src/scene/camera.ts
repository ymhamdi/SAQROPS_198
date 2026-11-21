// Where the crew views look from and towards, and how the view glides there. The pose follows the team along the route
// the PC broadcast: position = the team's cell, heading = towards a point a few metres further along the route. The
// views only display; nothing here feeds the verdict (R5).

import { cellAt, cellCentre, type Site } from '../site/site'
import { CELL } from '../types'
import type { SceneState } from './render'

/** A viewpoint on the plan (site metres, x eastwards, y southwards). `heading` is a math angle: 0 = east, π/2 = south. */
export interface Pose {
  x: number
  y: number
  heading: number
}

/** How far ahead along the route the view looks, in cells: far enough to take a corner early, near enough to follow the way. */
const LOOK_AHEAD_CELLS = 10
/** Below this (m) there is no direction to speak of (the team stands at the end of its route): keep the last heading. */
const NO_DIRECTION_M = 0.3
/** A jump longer than this (m) is a re-plan or a reset, not walking: the view cuts instead of gliding. */
const CUT_M = 12

/** Heading in degrees clockwise from north, the convention of the plan's bearings. */
export const bearingOf = (heading: number) => (((heading * 180) / Math.PI + 90) % 360 + 360) % 360

/** Smallest signed difference a − b between two angles, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

/** Once out, the view stands this far (m) outside the exit, looking back at the door: as far as the site's outdoor margin allows. */
const OUTSIDE_STANDOFF_M = 4

/** The first-person viewpoint: the team's, along its route; once the team is out, outside the exit looking back at the door. */
export function poseTarget(site: Site, s: SceneState, previous: Pose | null): Pose | null {
  const { track, cell, mode } = s.team
  if (mode === 'out' && cell >= 0 && track.length > 1) {
    const here = cellCentre(site, cell)
    const back = cellCentre(site, track[Math.max(0, track.length - 1 - LOOK_AHEAD_CELLS)])
    const ox = here.x - back.x
    const oy = here.y - back.y
    const len = Math.hypot(ox, oy)
    if (len > NO_DIRECTION_M) return { x: here.x + (ox / len) * OUTSIDE_STANDOFF_M, y: here.y + (oy / len) * OUTSIDE_STANDOFF_M, heading: Math.atan2(-oy, -ox) }
  }
  const pose = routePose(site, s, previous)
  return pose && intoTheRoom(site, pose)
}

/** Eye steps of the nudge out of a doorway, and its reach (m). */
const NUDGE_STEP_M = 0.25
const NUDGE_MAX_M = 1.5

/**
 * A viewpoint standing in a doorway sees only the frame beside it. When the team is in a door or an exit, the eye is
 * moved forward, along the route, into the room beyond (the map still shows the team where it is).
 */
function intoTheRoom(site: Site, pose: Pose): Pose {
  const kindAt = (x: number, y: number) => {
    const c = cellAt(site, { x, y })
    return c >= 0 ? site.kind[c] : CELL.OUTSIDE
  }
  const here = kindAt(pose.x, pose.y)
  if (here !== CELL.DOOR && here !== CELL.EXIT) return pose
  for (let d = NUDGE_STEP_M; d <= NUDGE_MAX_M; d += NUDGE_STEP_M) {
    const x = pose.x + Math.cos(pose.heading) * d
    const y = pose.y + Math.sin(pose.heading) * d
    if (kindAt(x, y) === CELL.FLOOR) return { ...pose, x, y }
  }
  return pose
}

/** Where the team is on the plan and which way its route leads, or null when there is no route yet. `previous` keeps the heading when there is no direction. */
export function routePose(site: Site, s: Pick<SceneState, 'team'>, previous: Pose | null): Pose | null {
  const { track, index, cell } = s.team
  if (cell < 0) return previous
  const here = cellCentre(site, cell)
  let heading = previous?.heading ?? 0
  if (track.length > 1) {
    const i = Math.min(index, track.length - 1)
    const ahead = cellCentre(site, track[Math.min(track.length - 1, i + LOOK_AHEAD_CELLS)])
    const dx = ahead.x - here.x
    const dy = ahead.y - here.y
    if (Math.hypot(dx, dy) > NO_DIRECTION_M) heading = Math.atan2(dy, dx)
    else if (!previous) {
      // Standing at the end of the route with no history: face back along it.
      const back = cellCentre(site, track[Math.max(0, i - LOOK_AHEAD_CELLS)])
      heading = Math.atan2(here.y - back.y, here.x - back.x)
    }
  }
  return { x: here.x, y: here.y, heading }
}

/**
 * Moves `current` towards `target` over `dtS` seconds with time constant `tauS` (exponential easing), turning the short
 * way round. A long jump cuts straight to the target.
 */
export function approach(current: Pose, target: Pose, dtS: number, tauS: number): Pose {
  if (Math.hypot(target.x - current.x, target.y - current.y) > CUT_M) return target
  const k = 1 - Math.exp(-Math.max(0, dtS) / tauS)
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
    heading: current.heading + angleDiff(target.heading, current.heading) * k,
  }
}

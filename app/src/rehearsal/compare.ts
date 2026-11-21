// Plan or real: once the COS has validated a plan and the team is in, the PC compares the two. At the team's position, the
// plan says when it expected to be there and with how much air; the difference is the lead or the delay, and the air used
// more or less than planned. It reads the team's cell, clock and pressure (what the PC itself shows), never the truth.

import { cellCentre, type Site } from '../site/site.ts'
import { barAt, type RehearsalPlan } from './engine.ts'

export interface PlanVsReal {
  /** T+ at which the plan expected the team at this position, s */
  plannedAtS: number
  /** distance between the team and the planned route, m (0 = on it; a re-plan leaves the route) */
  offRouteM: number
  /** real clock minus planned: positive = late, negative = ahead */
  delayS: number
  plannedBar: number
  realBar: number
  /** real minus planned, bar: negative = more air used than planned */
  barDelta: number
}

/** The team as the PC sees it: where, how long since the engagement, how much air. */
export interface RealTeam {
  cell: number
  clock: number
  bar: number
}

/** How far the real intervention is from its plan, at the team's position. Null when there is no position yet. */
export function comparePlan(site: Site, plan: RehearsalPlan, real: RealTeam): PlanVsReal | null {
  if (real.cell < 0 || plan.track.length === 0) return null
  const here = cellCentre(site, real.cell)
  const dist = plan.track.map((p) => {
    const c = cellCentre(site, p.cell)
    return Math.hypot(c.x - here.x, c.y - here.y)
  })
  const nearest = Math.min(...dist)
  // A point is a window in time: the plan arrives there at arriveS and leaves at departS (they differ where the team works).
  // Being there between the two is on time. The route often goes out and back through the same cells: among the points on
  // the very cell that is nearest, take the one whose window is closest to the real clock.
  const gap = (i: number) => {
    const p = plan.track[i]
    return real.clock < p.arriveS ? p.arriveS - real.clock : real.clock > p.departS ? real.clock - p.departS : 0
  }
  let best = -1
  plan.track.forEach((_, i) => {
    if (dist[i] > nearest + 1e-6) return
    if (best < 0 || gap(i) < gap(best)) best = i
  })
  const p = plan.track[best]
  const plannedAtS = Math.min(p.departS, Math.max(p.arriveS, real.clock))
  const delayS = real.clock < p.arriveS ? real.clock - p.arriveS : real.clock > p.departS ? real.clock - p.departS : 0
  const plannedBar = barAt(plan, plannedAtS)
  return { plannedAtS, offRouteM: nearest, delayS, plannedBar, realBar: real.bar, barDelta: real.bar - plannedBar }
}

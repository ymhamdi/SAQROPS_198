// What the crew views (tablet, HUD) derive from a snapshot: where to go next and which way.

import type { Snapshot } from '../sim/protocol'
import { cellCentre, type Site } from '../site/site'

/** How far ahead along the route the arrow points, in cells (not as the crow flies). */
const LOOK_AHEAD_CELLS = 12

export interface NextStep {
  /** what the team heads for: the next objective, or the exit the route ends at */
  label: string
  /** metres left along the route to it */
  distanceM: number
  /** direction to follow, degrees clockwise from the top of the plan (north) */
  bearingDeg: number | null
}

export function nextStep(site: Site, s: Snapshot): NextStep | null {
  const { track, index, mode, objectives } = s.team
  if (track.length < 2 || mode === 'out') return null
  const i = Math.min(index, track.length - 1)
  const objective = mode === 'engaged' ? site.objectives.find((o) => o.id === objectives[0]) : undefined
  let end = track.length - 1
  if (objective) {
    const k = track.indexOf(objective.cell, i)
    if (k >= 0) end = k
  }
  let distanceM = 0
  for (let k = i + 1; k <= end; k++) {
    const a = cellCentre(site, track[k - 1])
    const b = cellCentre(site, track[k])
    distanceM += Math.hypot(b.x - a.x, b.y - a.y)
  }
  const exitDoor = site.doors[site.door[track[track.length - 1]]]
  const label = objective ? objective.name : exitDoor ? exitDoor.name : 'Sortie'
  const here = cellCentre(site, track[i])
  const ahead = cellCentre(site, track[Math.min(end, i + LOOK_AHEAD_CELLS)])
  const dx = ahead.x - here.x
  const dy = ahead.y - here.y
  const bearingDeg = dx === 0 && dy === 0 ? null : ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
  return { label, distanceM, bearingDeg }
}

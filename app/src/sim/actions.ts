// What the PC's buttons do to the simulation. Shared by the worker and by the tests that replay the video script, so that
// both apply an action in exactly the same way.

import type { Action } from './protocol'
import { engage, evacuate, launchDrone, launchIndoor, reengageTeam, setObjectives, startFire, toggleDoor, type SimContext, type SimState } from './sim'

export function applyAction(ctx: SimContext, s: SimState, a: Action): void {
  if (a.type === 'fire') startFire(ctx, s, a.at)
  else if (a.type === 'door') toggleDoor(ctx, s, a.door)
  else if (a.type === 'engage') engage(ctx, s)
  else if (a.type === 'objectives') setObjectives(ctx, s, a.ids, a.note)
  else if (a.type === 'evacuate') evacuate(ctx, s)
  else if (a.type === 'reengage') reengageTeam(ctx, s)
  else if (a.type === 'drone') launchDrone(ctx, s)
  else if (a.type === 'indoor') launchIndoor(ctx, s)
}

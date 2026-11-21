// The rehearsal's state at T+tS, in the shape the first-person view reads (scene/render.ts SceneState). It is built from
// the rehearsal's own projection of what PNR knows: no simulator truth can get in (R11), and no live view reads it (R12).

import type { SceneState } from '../scene/render.ts'
import { pointAt, projectRooms, type KnownInput, type RehearsalPlan } from './engine.ts'

export function sceneAt(input: KnownInput, plan: RehearsalPlan, tS: number): SceneState {
  const index = pointAt(plan, tS)
  const { condition, alert } = projectRooms(input, plan, tS)
  return {
    doorOpen: input.doorOpen,
    rooms: condition.map((c, i) => ({ condition: c, pred: alert[i] ? { alert: true } : null })),
    team: {
      mode: 'engaged',
      // The objectives still to reach: the view points at the next one, then at the exit.
      objectives: plan.order.filter((_, k) => index < plan.objectiveIndex[k]),
      track: plan.track.map((p) => p.cell),
      index,
      cell: plan.track[index].cell,
    },
  }
}

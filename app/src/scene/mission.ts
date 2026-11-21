// Where the mission stands, for the tablet's phase strip: waiting, advancing on the objectives, on the way out, out.
// Derived from the snapshot the PC broadcasts; the PC decides, the tablet shows.

import type { Snapshot } from '../sim/protocol'

export interface MissionStep {
  id: 'standby' | 'progress' | 'exit' | 'out'
  label: string
}

export const MISSION_STEPS: readonly MissionStep[] = [
  { id: 'standby', label: 'En attente' },
  { id: 'progress', label: 'Progression' },
  { id: 'exit', label: 'Sortie' },
  { id: 'out', label: 'Sorti' },
]

export interface Mission {
  /** index of the current step in MISSION_STEPS */
  current: number
  objectives: { done: number; total: number }
  /** a NO-GO is latched: the way out is an evacuation (R6) */
  noGo: boolean
}

export function missionOf(s: Snapshot): Mission {
  const { mode, objectives, done } = s.team
  let current = 0
  if (mode === 'engaged') current = objectives.length > 0 ? 1 : 2
  else if (mode === 'evacuating') current = 2
  else if (mode === 'out') current = 3
  return { current, objectives: { done: done.length, total: done.length + objectives.length }, noGo: s.latched }
}

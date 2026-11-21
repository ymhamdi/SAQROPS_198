// The automatic demonstration (CLAUDE.md §9): the PC's operator, played by a script. Given the latest snapshot it says what
// the COS would do next (fire, drone, engage, close a door, re-engage) and how fast to play, so that the crew views move
// on their own for about a minute. Pure: no timers, no simulator access.
//
// R5: it reads only what the PC itself shows (time, team, latch, doors, drone status), never `truth`. The re-engagement
// stays a COS decision (R6): the script plays the COS, and the action is logged and broadcast like a click on the button.

import { H, v } from '../config'
import { nextStep } from '../panels/crew'
import type { Action, Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'

/** The moments of the story, in order; each has a caption in captions.ts. */
export const DEMO_SCENES = ['fire', 'drone', 'engaged', 'nogo', 'door', 'out', 'reengaged', 'end'] as const
export type DemoScene = (typeof DEMO_SCENES)[number]

export interface DemoState {
  fired: boolean
  droned: boolean
  engaged: boolean
  /** simulated time of the NO-GO latch, as the log of the latch records it */
  noGoAt: number | null
  doorClosed: boolean
  /** simulated time at which the team was seen out for the first time */
  outAt: number | null
  retargeted: boolean
  /** the team was seen on the move again after the re-engagement */
  backIn: boolean
  done: boolean
}

export interface DemoStep {
  /** what the operator does now, in order */
  act: Action[]
  /** playback speed to ask for: always one of the PC's speeds */
  speed: number
  scene: DemoScene
  done: boolean
  state: DemoState
}

export const initialDemo = (): DemoState => ({
  fired: false,
  droned: false,
  engaged: false,
  noGoAt: null,
  doorClosed: false,
  outAt: null,
  retargeted: false,
  backIn: false,
  done: false,
})

/** Slow enough to follow while the team walks, fast while nothing moves on the crew screens. */
function paceOf(site: Site, snap: Snapshot, st: DemoState): number {
  const { mode } = snap.team
  if (mode === 'out') return v(H.demo.paceOutX)
  if (mode === 'standby' || !st.engaged) return v(H.demo.paceFastX)
  if (mode === 'engaged') {
    const next = nextStep(site, snap)
    // Working at its objective: nothing to see, move on.
    if (next && next.distanceM <= v(H.demo.arrivedM)) return v(H.demo.paceFastX)
  }
  return v(H.demo.paceWalkX)
}

function sceneOf(snap: Snapshot, st: DemoState): DemoScene {
  if (st.done) return 'end'
  if (st.retargeted) return 'reengaged'
  if (st.outAt !== null) return 'out'
  if (st.doorClosed) return 'door'
  if (st.noGoAt !== null) return 'nogo'
  if (st.engaged) return 'engaged'
  if (st.droned || snap.drone.status !== 'ground') return 'drone'
  return 'fire'
}

/** The note the PC leaves when it takes objectives off the team's list, in the style of the PC's own button. */
function retargetNote(site: Site, snap: Snapshot, keep: string[]): string {
  const removed = snap.team.objectives.filter((id) => !keep.includes(id))
  const names = removed.map((id) => site.objectives.find((o) => o.id === id)?.name).filter((n): n is string => !!n)
  return names.length > 0 ? names.map((n) => `Objectif « ${n} » retiré par le PC`).join(' · ') : 'Objectifs mis à jour par le PC'
}

export function demoStep(site: Site, snap: Snapshot, prev: DemoState): DemoStep {
  const st: DemoState = { ...prev }
  const act: Action[] = []
  const t = snap.t

  // 1. Fire in the solvent store.
  if (!st.fired) {
    act.push({ type: 'fire', at: site.demo.fireAt })
    st.fired = true
  }
  // 2. The drone takes off once the detectors have located the fire.
  if (!st.droned && t >= v(H.demo.droneAtS)) {
    act.push({ type: 'drone' })
    st.droned = true
  }
  // 3. The team is engaged towards its objectives.
  if (!st.engaged && t >= v(H.demo.engageAtS)) {
    act.push({ type: 'engage' })
    st.engaged = true
  }
  // 4. The NO-GO is the system's own; the script only notes when it happened.
  if (st.noGoAt === null && snap.latched) st.noGoAt = snap.latchLog.filter((l) => l.action === 'NO-GO').at(-1)?.t ?? t
  // 5. The COS closes the door between the store and the booth: the predicted delay goes up, the NO-GO stays.
  if (st.noGoAt !== null && !st.doorClosed && t >= st.noGoAt + v(H.demo.closeDoorAfterNoGoS)) {
    if (snap.doorOpen[site.demo.closeDoor]) act.push({ type: 'door', door: site.demo.closeDoor })
    st.doorClosed = true
  }
  // The team is out: the NO-GO is latched, only the COS can send it back in.
  if (st.outAt === null && snap.team.mode === 'out') st.outAt = t
  // 6. The PC takes the booth objective off the list and re-engages (decision COS): a new route, sent live.
  if (st.outAt !== null && !st.retargeted && snap.team.mode === 'out' && t >= st.outAt + v(H.demo.reengageAfterOutS)) {
    act.push({ type: 'objectives', ids: site.demo.thenObjectives, note: retargetNote(site, snap, site.demo.thenObjectives) })
    if (snap.latched) act.push({ type: 'reengage' })
    st.retargeted = true
  }
  // The end: the team went back in and is out again, or the time is up.
  if (st.retargeted && snap.team.mode !== 'out') st.backIn = true
  if (st.retargeted && st.backIn && snap.team.mode === 'out') st.done = true
  if (t >= v(H.demo.maxS)) st.done = true

  return { act, speed: paceOf(site, snap, st), scene: sceneOf(snap, st), done: st.done, state: st }
}

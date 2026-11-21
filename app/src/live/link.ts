// The live link between mission control and the crew's tablet or HUD, when they run in two windows of the same
// browser (the demo stand-in for a radio link): the crew's position goes to mission control, and changes to the plan
// go both ways. BroadcastChannel is built into the browser: no backend, no dependency. SIMULATED: on Mars this would
// be the suit-to-habitat radio and real localisation.

import type { DwellExtras } from '../copilot/plan'
import type { RouteResult } from '../route/route'
import type { Waypoint } from '../types'

const CHANNEL = 'martian-map.live.v1'

/** Where the crew is now, from their walk view. */
export interface CrewReport {
  /** Marswalk clock, s */
  t: number
  lat: number
  lon: number
  /** track index at or just before the crew, on the plan the crew is walking */
  index: number
  atStop: boolean
  /** index into [habitat, ...stops, habitat] of the next stop (or the one being worked) */
  nextStation: number
  /** the crew pressed Abort */
  abort: boolean
  /** the walk clock is running, at this many times real time: mission control moves the crew on between reports */
  playing: boolean
  speed: number
  /** off the planned route (walking back to it after a position fix): only the reported position is right */
  onDetour: boolean
  /** Marswalk clock minus the plan's own time at the crew's position (non-zero after rejoining from a detour), s */
  planOffsetS: number
  /** when the position was taken (epoch ms; windows of one browser share the clock) */
  at: number
  /** which walk view sends it */
  view: 'tablet' | 'hud'
  /** the plan this position is on (see planSig) */
  sig: string
}

/** The live state of the plan: what both sides must agree on while the crew is out. */
export interface LivePlanState {
  stops: Waypoint[]
  /** a walk re-planned on the way (the walked part kept exactly), or null when the normal plan applies */
  live: { key: string; route: RouteResult } | null
  extras: DwellExtras
}

export type LiveMessage =
  /** a window opened a walk view: whoever has the live plan sends it */
  | { type: 'hello' }
  | ({ type: 'crew' } & CrewReport)
  | ({ type: 'plan'; sig: string; from: 'control' | 'crew'; note: string | null } & LivePlanState)

export interface LiveLink {
  post: (m: LiveMessage) => void
  close: () => void
}

/** Opens the live link; a no-op link where BroadcastChannel is not available. */
export function openLiveLink(onMessage: (m: LiveMessage) => void): LiveLink {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} }
  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = (e: MessageEvent<LiveMessage>) => onMessage(e.data)
  return {
    post: (m) => {
      try {
        ch.postMessage(m)
      } catch {
        // a closed channel (window closing): nothing to do
      }
    },
    close: () => ch.close(),
  }
}

/** A short signature of the live plan, to tell whether two windows hold the same one. */
export function planSig(s: LivePlanState): string {
  const r = s.live?.route
  return JSON.stringify([s.stops.map((w) => w.id), s.live ? [s.live.key, r?.ok ? r.legs.length : -1, r?.ok ? Math.round(r.timeS) : 0] : null, Object.entries(s.extras).sort()])
}

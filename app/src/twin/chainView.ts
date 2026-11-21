// What each stage of the decision chain holds right now, read from the snapshot the PC broadcasts. The chain is the
// real one (sim/sim.ts): fire → detectors → 13 variables → AI and rules → merge (R1) → route and air → verdict → screens.

import type { RoomCondition } from '../danger/rules'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { withoutAi } from './history'

export interface ChainView {
  room: number
  roomName: string
  /** the room is covered by the flashover model (the hall is not) */
  modelled: boolean
  /** the simulated world, for comparison only (R5) */
  world: { burning: number; flashed: number; maxKw: number }
  sensors: { total: number; failed: number; roomTotal: number; roomFailed: number; roomReadingC: number | null }
  rules: { counts: Record<RoomCondition, number>; roomCondition: RoomCondition }
  merge: { withoutAi: 'GO' | 'NO-GO'; withAi: 'GO' | 'NO-GO'; worsened: boolean }
}

export function chainOf(site: Site, s: Snapshot, room: number): ChainView {
  const roomDets = site.detectors.flatMap((d, i) => (d.room === room ? [i] : []))
  const counts: Record<RoomCondition, number> = { clear: 0, smoke: 0, hot: 0, failed: 0 }
  for (const r of s.rooms) counts[r.condition]++
  const base = withoutAi(s.computed).verdict
  const rv = s.rooms[room]
  return {
    room,
    roomName: site.rooms[room].name,
    modelled: rv.pred !== null,
    world: {
      burning: s.rooms.filter((r) => r.truth.ignitedAt !== null).length,
      flashed: s.rooms.filter((r) => r.truth.flashedAt !== null).length,
      maxKw: Math.max(0, ...s.rooms.map((r) => r.truth.qKw)),
    },
    sensors: {
      total: s.detectors.length,
      failed: s.detectors.filter((d) => d.failed).length,
      roomTotal: roomDets.length,
      roomFailed: roomDets.filter((i) => s.detectors[i].failed).length,
      roomReadingC: Number.isFinite(rv.tLastC) ? rv.tLastC : null,
    },
    rules: { counts, roomCondition: rv.condition },
    merge: { withoutAi: base, withAi: s.computed.verdict, worsened: base === 'GO' && s.computed.verdict === 'NO-GO' },
  }
}

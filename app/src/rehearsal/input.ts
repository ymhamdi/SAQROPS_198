// What the rehearsal reads from the PC's snapshot: the fields PNR itself uses (detector conditions, the AI's predictions,
// the drone's merged observations, the doors, the objectives). The parameter's type lists them, so what the simulator
// really is (the rooms' hidden state, the thermal image) is not reachable from here, and R11's test checks it behaves so.

import type { Known } from '../knowledge/known.ts'
import type { Site } from '../site/site.ts'
import type { DataStatus } from '../types.ts'
import type { KnownInput, KnownRoomInput } from './engine.ts'

/** The slice of the snapshot the rehearsal may read. `Snapshot` satisfies it; nothing about the truth is in it. */
export interface KnownSnapshot {
  t: number
  doorOpen: readonly boolean[]
  rooms: readonly {
    condition: KnownRoomInput['condition']
    tLastC: number
    status: DataStatus
    pred: KnownRoomInput['pred']
  }[]
  known: Known
  team: { objectives: readonly string[] }
  readingsStatus: DataStatus
}

export function knownInputOf(site: Site, snap: KnownSnapshot): KnownInput {
  return {
    tS: snap.t,
    doorOpen: [...snap.doorOpen],
    rooms: snap.rooms.map((r) => ({
      condition: r.condition,
      tLastC: r.tLastC,
      status: r.status,
      pred: r.pred ? { alert: r.pred.alert, horizonS: r.pred.horizonS, tffS: r.pred.tffS, p60: r.pred.p60, status: r.pred.status } : null,
    })),
    known: snap.known,
    objectives: [...snap.team.objectives],
    entryDoor: site.demo.entry,
    readingsStatus: snap.readingsStatus,
  }
}

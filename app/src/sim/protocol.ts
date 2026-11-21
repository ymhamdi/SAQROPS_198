// What the simulation worker sends to the views, and what the PC asks of it. Plain data (structured clone).

import type { RoomCondition } from '../danger/rules'
import type { LatchLogEntry } from '../stats/latch'
import type { Verdict } from '../stats/verdict'
import type { DataStatus, Point } from '../types'
import type { SimContext, SimState, TeamMode } from './sim'
import { teamNow } from './sim'

export interface RoomView {
  condition: RoomCondition
  tLastC: number
  fracFailed: number
  status: DataStatus
  pred: { p30: number; p60: number; tffS: number; alert: boolean; horizonS: 30 | 60 | null; status: DataStatus } | null
  firstAlertAt: number | null
  /** the simulator's truth: only for the « vérité simulateur » layer, never for the verdict (R5) */
  truth: { layerC: number; layerZ: number; qKw: number; ignitedAt: number | null; flashedAt: number | null }
}

export interface Snapshot {
  t: number
  rooms: RoomView[]
  detectors: { reading: number; failed: boolean }[]
  doorOpen: boolean[]
  team: {
    mode: TeamMode
    objectives: string[]
    done: string[]
    /** cells of the plan, and where the team is on it */
    track: number[]
    index: number
    cell: number
    bar: number
    exitBar: number | null
    pnrMarginBar: number | null
    toExitS: number | null
    clock: number
  }
  shown: Verdict
  computed: Verdict
  latched: boolean
  latchLog: LatchLogEntry[]
  notes: { t: number; text: string }[]
  planVersion: number
  model: { dummy: boolean; trainedOn: string; thresholds: { p30: number; p60: number } }
  readingsStatus: DataStatus
}

export type Action =
  | { type: 'fire'; at: Point }
  | { type: 'door'; door: number }
  | { type: 'engage' }
  | { type: 'objectives'; ids: string[]; note: string }
  | { type: 'evacuate' }
  | { type: 'reengage' }

export type RequestBody = { type: 'reset'; seed: number } | { type: 'step'; n: number } | { type: 'act'; action: Action }

export type Request = RequestBody & { id: number }

export type Response = { id: number; ok: true; snapshot: Snapshot } | { id: number; ok: false; error: string }

export function snapshot(ctx: SimContext, s: SimState): Snapshot {
  const now = teamNow(ctx, s)
  return {
    t: s.fire.t,
    rooms: ctx.site.rooms.map((_, r) => {
      const o = s.observations[r]
      const p = s.predictions.find((x) => x.room === r)
      const fr = s.fire.rooms[r]
      return {
        condition: o.condition,
        tLastC: o.tLastC,
        fracFailed: o.fracFailed,
        status: o.status,
        pred: p ? { p30: p.p30, p60: p.p60, tffS: p.tffS, alert: p.alert, horizonS: p.horizonS, status: p.status } : null,
        firstAlertAt: s.firstAlertAt[r],
        truth: { layerC: fr.layerC, layerZ: fr.layerZ, qKw: fr.qKw, ignitedAt: fr.ignitedAt, flashedAt: fr.flashedAt },
      }
    }),
    detectors: s.fire.detectors.map((d) => ({ reading: d.reading, failed: d.failed })),
    doorOpen: [...s.fire.doorOpen],
    team: {
      mode: s.team.mode,
      objectives: [...s.team.objectives],
      done: [...s.team.done],
      track: s.team.track.map((p) => p.cell),
      index: s.team.index,
      cell: now.cell,
      bar: now.bar,
      exitBar: now.exitBar,
      pnrMarginBar: now.pnrMarginBar,
      toExitS: now.toExitS !== null && Number.isFinite(now.toExitS) ? now.toExitS : null,
      clock: now.clock,
    },
    shown: s.shown,
    computed: s.computed,
    latched: s.latch.latched,
    latchLog: s.latch.log,
    notes: s.notes,
    planVersion: s.planVersion,
    model: { dummy: ctx.predictor.dummy, trainedOn: ctx.predictor.trainedOn, thresholds: ctx.predictor.thresholds },
    readingsStatus: ctx.readingsStatus,
  }
}

// What the simulation worker sends to the views, and what the PC asks of it. Plain data (structured clone).

import type { RoomCondition } from '../danger/rules'
import { featureVector } from '../ml/features'
import type { Known } from '../knowledge/known'
import { receivedBy, type Observation } from '../knowledge/observation'
import { cellCentre, neighbours } from '../site/site'
import type { LatchLogEntry } from '../stats/latch'
import type { Verdict } from '../stats/verdict'
import type { DataStatus, Point } from '../types'
import { droneAt, type Plume } from '../drone/drone'
import type { RehearsalPlan } from '../rehearsal/engine'
import type { SimContext, SimState, TeamMode, ValidatedPlan } from './sim'
import { teamNow } from './sim'

export interface RoomView {
  condition: RoomCondition
  tLastC: number
  fracFailed: number
  status: DataStatus
  pred: { p30: number; p60: number; tffS: number; alert: boolean; horizonS: 30 | 60 | null; status: DataStatus } | null
  firstAlertAt: number | null
  /** the 13 inputs the model received for this room, in contract order (NaN = missing: failed detectors); null outside the model. Detector statistics only (R5). */
  features: number[] | null
  /** the simulator's truth: only for the « vérité simulateur » layer and the digital twin's reality panel, never for the verdict (R5) */
  truth: { layerC: number; layerZ: number; qKw: number; ignitedAt: number | null; flashedAt: number | null; fireAt: Point | null }
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
  drone: {
    status: 'ground' | 'flying' | 'landed' | 'refused'
    at: { x: number; y: number; aloft: boolean; batteryPct: number; marginPct: number } | null
    reason: string | null
    path: Point[]
    plume: Plume | null
    /** roof temperature per room seen by the thermal camera: SIMULATED, PC only (R5) */
    roofC: (number | null)[]
    wind: { speedMs: number; fromDeg: number; status: DataStatus }
    reservePct: number
    maxWindMs: number
  }
  /** the indoor drone: its flight and what has reached PNR of what it saw (SIMULATED) */
  indoor: {
    status: 'ground' | 'flown' | 'refused'
    launchedAt: number | null
    reason: string | null
    durationS: number
    path: Point[]
    tooHot: number[]
    targets: { id: string; reached: boolean }[]
    observations: Observation[]
    /** pictures taken but still in a radio dead zone */
    pending: number
  }
  /** what PNR knows now: the detectors, the AI and the drone merged (R9, R10) */
  known: Known
  /** the intervention plan the COS validated (R12), or null */
  plan: ValidatedPlan | null
}

export type Action =
  | { type: 'fire'; at: Point }
  | { type: 'door'; door: number }
  | { type: 'engage' }
  | { type: 'objectives'; ids: string[]; note: string }
  | { type: 'evacuate' }
  | { type: 'reengage' }
  | { type: 'drone' }
  | { type: 'indoor' }
  | { type: 'engage-direct' }
  | { type: 'plan-validate'; plan: RehearsalPlan }

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
        features: ctx.site.rooms[r].flashoverModel ? featureVector(s.stats[r], neighbours(ctx.site, r).map((n) => s.stats[n])) : null,
        truth: { layerC: fr.layerC, layerZ: fr.layerZ, qKw: fr.qKw, ignitedAt: fr.ignitedAt, flashedAt: fr.flashedAt, fireAt: fr.fireAt },
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
    drone: droneView(ctx, s),
    indoor: indoorView(ctx, s),
    known: s.known,
    plan: s.plan,
  }
}

function indoorView(ctx: SimContext, s: SimState): Snapshot['indoor'] {
  const i = s.indoor
  const got = receivedBy(i.observations, s.fire.t)
  return {
    status: i.status,
    launchedAt: i.launchedAt,
    reason: i.reason,
    durationS: i.plan?.durationS ?? 0,
    path: i.plan ? i.plan.points.map((p) => cellCentre(ctx.site, p.cell)) : [],
    tooHot: i.plan?.tooHot ?? [],
    targets: i.plan?.targets.map((t) => ({ id: t.id, reached: t.reached })) ?? [],
    observations: got,
    pending: i.observations.length - got.length,
  }
}

function droneView(ctx: SimContext, s: SimState): Snapshot['drone'] {
  const d = s.drone
  const f = d.flight
  const elapsed = d.launchedAt === null ? 0 : s.fire.t - d.launchedAt
  const at = f && d.status !== 'refused' ? droneAt(f, d.status === 'landed' ? f.landedS : elapsed) : null
  return {
    status: d.status,
    at: at ? { x: at.x, y: at.y, aloft: at.aloft, batteryPct: at.batteryPct, marginPct: at.marginPct } : null,
    reason: d.reason,
    path: f ? f.points.map((p) => ({ x: p.x, y: p.y })) : [],
    plume: f?.plume ?? null,
    roofC: [...d.roofC],
    wind: ctx.wind,
    reservePct: ctx.drone.reservePct,
    maxWindMs: ctx.drone.maxWindMs,
  }
}

// One tick of PNR (1 s of simulated time): fire engine → detector readings → room statistics → rules + AI →
// route costs → exit fields → plan (re-planned only when needed) → air and point of no return → verdict → latch.
// Pure state + functions, run in the worker. The verdict reads detector readings only, never the fire's truth (R5).

import { H, v } from '../config.ts'
import { aiMultiplier, aiReasons, predictRooms, type RoomPrediction } from '../danger/ai.ts'
import { mergeAi } from '../danger/merge.ts'
import { droneAt, droneParams, loopAround, planFlight, plumeOf, type DroneParams, type Flight, type Wind } from '../drone/drone.ts'
import { indoorParams, planIndoor, senseIndoor, type IndoorKnown, type IndoorParams, type IndoorPlan } from '../drone/indoor.ts'
import { knownReasons, mergeKnown, mergeKnowledge, type Known } from '../knowledge/known.ts'
import type { Observation } from '../knowledge/observation.ts'
import { observeRoom, paceOf, ruleMultiplier, type RoomObservation } from '../danger/rules.ts'
import { ignite, initFireState, setDoor, stepFire, type FireSetup, type FireState } from '../fire/engine.ts'
import type { FireParams } from '../fire/params.ts'
import { roomStats, type RoomHistory, type RoomStats } from '../ml/features.ts'
import type { Predictor } from '../ml/predict.ts'
import { prepareGrid, stepTime, type PreparedGrid } from '../route/cost.ts'
import { nearestHaven } from '../route/optimize.ts'
import { findPath, pathDown, walkHomeField } from '../route/search.ts'
import { cellAt, type Site } from '../site/site.ts'
import { airParams, airReasons, barAfter, buildTrack, checkPnr, type AirParams, type TrackPoint } from '../stats/air.ts'
import { applyLatch, OPEN_LATCH, reengage as openLatch, type Latch } from '../stats/latch.ts'
import { verdictOf, type Reason, type Verdict } from '../stats/verdict.ts'
import type { DataStatus, Point } from '../types.ts'
import weather from '../../../data/weather/open-meteo.json' with { type: 'json' }

export interface SimContext {
  site: Site
  setup: FireSetup
  params: FireParams
  predictor: Predictor
  air: AirParams
  /** detector indices per room */
  detByRoom: number[][]
  /** status of the readings: SIMULATED here; OBSERVED with real detectors */
  readingsStatus: DataStatus
  drone: DroneParams
  indoor: IndoorParams
  /** outdoor wind from the Open-Meteo cache (DERIVED) */
  wind: Wind
  /** the reconnaissance loop around the building */
  loop: Point[]
  /** bounding box of each room, site metres (what the thermal camera can see) */
  roomBox: { x0: number; y0: number; x1: number; y1: number }[]
}

export interface DroneState {
  status: 'ground' | 'flying' | 'landed' | 'refused'
  launchedAt: number | null
  flight: Flight | null
  /** rooms the thermal camera has seen */
  seen: boolean[]
  /** roof temperature of each seen room, °C: a SIMULATED image, PC only, never the verdict (R5) */
  roofC: (number | null)[]
  reason: string | null
  noise: number
}

/** The indoor drone's flight: planned at take-off from what PNR knows, sensed from the truth, observations stamped. */
export interface IndoorState {
  status: 'ground' | 'flown' | 'refused'
  launchedAt: number | null
  plan: IndoorPlan | null
  /** all of them, including those still in a radio dead zone (the views only get those received) */
  observations: Observation[]
  reason: string | null
}

export type TeamMode = 'standby' | 'engaged' | 'evacuating' | 'out'

export interface Team {
  mode: TeamMode
  /** objective ids still to do, in order */
  objectives: string[]
  done: string[]
  entryDoor: number
  engagedAt: number | null
  track: TrackPoint[]
  /** route cost of the rest of the track when it was planned (to re-plan only on a real change) */
  plannedCost: number
  /** where the team is: track index at or before them */
  index: number
}

export interface SimState {
  fire: FireState
  histories: RoomHistory[]
  stats: RoomStats[]
  observations: RoomObservation[]
  predictions: RoomPrediction[]
  /** first time the model raised an alert for each room (lead-time record, SIMULATED truth layer) */
  firstAlertAt: (number | null)[]
  travel: PreparedGrid
  cost: PreparedGrid
  /** seconds to the nearest exit from every cell: travel time (air) and route cost (choice of way out) */
  exitTravel: Float32Array
  exitCost: Float32Array
  team: Team
  computed: Verdict
  shown: Verdict
  latch: Latch
  /** PC messages to the team, newest last */
  notes: { t: number; text: string }[]
  /** bumps on every re-plan, so the views know the route changed */
  planVersion: number
  drone: DroneState
  indoor: IndoorState
  /** what PNR knows once the indoor drone has flown (R9, R10); inactive before */
  known: Known
}

export function makeContext(site: Site, setup: FireSetup, params: FireParams, predictor: Predictor): SimContext {
  return {
    site,
    setup,
    params,
    predictor,
    air: airParams(),
    detByRoom: site.rooms.map((r) => site.detectors.flatMap((d, i) => (d.room === r.index ? [i] : []))),
    readingsStatus: 'SIMULATED',
    drone: droneParams(),
    indoor: indoorParams(),
    wind: { speedMs: weather.windSpeedMs, fromDeg: weather.windFromDeg, status: weather.status as DataStatus },
    loop: loopAround({ x0: site.marginM, y0: site.marginM, x1: site.marginM + 60, y1: site.marginM + 40 }, droneParams().loopOffsetM),
    roomBox: site.rooms.map((r) => {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const c of r.cells) {
        const row = (c / site.width) | 0
        const col = c - row * site.width
        x0 = Math.min(x0, col * site.cellM)
        y0 = Math.min(y0, row * site.cellM)
        x1 = Math.max(x1, (col + 1) * site.cellM)
        y1 = Math.max(y1, (row + 1) * site.cellM)
      }
      return { x0, y0, x1, y1 }
    }),
  }
}

const emptyVerdict: Verdict = { verdict: 'GO', reasons: [] }

export function initSim(ctx: SimContext, doors: boolean[], seed: number): SimState {
  const { site } = ctx
  const fire = initFireState(ctx.setup, ctx.params, doors, seed)
  const s: SimState = {
    fire,
    histories: ctx.detByRoom.map((dets) => ({ t: [], readings: dets.map(() => []) })),
    stats: [],
    observations: [],
    predictions: [],
    firstAlertAt: site.rooms.map(() => null),
    travel: null as unknown as PreparedGrid,
    cost: null as unknown as PreparedGrid,
    exitTravel: new Float32Array(0),
    exitCost: new Float32Array(0),
    team: { mode: 'standby', objectives: [...site.demo.objectives], done: [], entryDoor: site.demo.entry, engagedAt: null, track: [], plannedCost: 0, index: 0 },
    computed: emptyVerdict,
    shown: emptyVerdict,
    latch: OPEN_LATCH,
    notes: [],
    planVersion: 0,
    drone: { status: 'ground', launchedAt: null, flight: null, seen: site.rooms.map(() => false), roofC: site.rooms.map(() => null), reason: null, noise: 12345 },
    indoor: { status: 'ground', launchedAt: null, plan: null, observations: [], reason: null },
    known: mergeKnowledge(site.rooms.length, false, [], 0),
  }
  observe(ctx, s)
  replan(ctx, s)
  judge(ctx, s)
  return s
}

/** Detector readings → statistics, conditions, predictions, grids and exit fields. */
export function observe(ctx: SimContext, s: SimState) {
  const { site } = ctx
  const t = s.fire.t
  ctx.detByRoom.forEach((dets, r) => {
    const h = s.histories[r]
    h.t.push(t)
    dets.forEach((d, k) => h.readings[k].push(s.fire.detectors[d].reading))
  })
  s.stats = s.histories.map((h) => roomStats(h, t))
  s.observations = s.stats.map((st, r) => observeRoom(r, st, ctx.readingsStatus))
  s.predictions = predictRooms(site, s.stats, ctx.predictor, ctx.readingsStatus)
  for (const p of s.predictions) if (p.alert && s.firstAlertAt[p.room] === null) s.firstAlertAt[p.room] = t
  const byRoom = new Map(s.predictions.map((p) => [p.room, p]))
  // The indoor drone's picture only ever adds cost (R9): a multiplier of at least 1, and the passages it found blocked.
  s.known = mergeKnowledge(site.rooms.length, s.indoor.status === 'flown', s.indoor.observations, t)
  const travelPace = s.observations.map((o) => paceOf(o.condition))
  const costPace = s.observations.map((o, r) => paceOf(o.condition) * ruleMultiplier(o.condition) * aiMultiplier(byRoom.get(r)) * s.known.rooms[r].extraCost)
  s.travel = prepareGrid(site, travelPace)
  s.cost = prepareGrid(site, costPace)
  for (const c of s.known.blockedCells) {
    s.travel.pace[c] = Infinity
    s.cost.pace[c] = Infinity
  }
  const exits = site.exits.map((e) => site.doors[e].cells[0])
  s.exitTravel = nearestHaven(exits.map((c) => walkHomeField(s.travel, c)))
  s.exitCost = nearestHaven(exits.map((c) => walkHomeField(s.cost, c)))
}

function objectiveCell(ctx: SimContext, id: string): number {
  const o = ctx.site.objectives.find((x) => x.id === id)
  if (!o) throw new Error(`unknown objective ${id}`)
  return o.cell
}

/** Elapsed time of the team since engagement (0 on standby). */
function teamClock(s: SimState): number {
  return s.team.engagedAt === null ? 0 : s.fire.t - s.team.engagedAt
}

/** Where the team is on its track now. */
function locate(s: SimState): { index: number; cell: number; airUsedL: number } {
  const tr = s.team.track
  if (tr.length === 0) return { index: 0, cell: -1, airUsedL: 0 }
  const clock = teamClock(s)
  let i = 0
  while (i + 1 < tr.length && tr[i + 1].arriveS <= clock) i++
  const p = tr[i]
  // Air used: working at the point, or walking the step to the next one.
  let air = p.airUsedL
  if (clock < p.departS) air = p.airArriveL + ((p.airUsedL - p.airArriveL) * Math.max(0, clock - p.arriveS)) / Math.max(1e-9, p.departS - p.arriveS)
  else if (i + 1 < tr.length) {
    const q = tr[i + 1]
    air = p.airUsedL + ((q.airArriveL - p.airUsedL) * (clock - p.departS)) / Math.max(1e-9, q.arriveS - p.departS)
  }
  return { index: i, cell: p.cell, airUsedL: air }
}

/** Cost of the rest of the track on the cost grid (to detect a real change). */
function remainingCost(s: SimState): number {
  const tr = s.team.track
  const w = s.cost.grid.width
  let c = 0
  for (let k = Math.max(1, s.team.index + 1); k < tr.length; k++) {
    const a = tr[k - 1].cell
    const b = tr[k].cell
    const diag = a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0)
    c += stepTime(s.cost, a, b, diag ? s.cost.grid.cellSizeM * Math.SQRT2 : s.cost.grid.cellSizeM)
  }
  return c
}

/** Plans the rest: to each remaining objective then out, or straight out when evacuating. */
function replan(ctx: SimContext, s: SimState) {
  const { site } = ctx
  const team = s.team
  const here = team.mode === 'standby' ? { index: 0, cell: site.doors[team.entryDoor].cells[0], airUsedL: 0 } : locate(s)
  if (team.mode === 'out' || here.cell < 0) return
  const legs: number[][] = []
  let from = here.cell
  if (team.mode !== 'evacuating') {
    for (const id of team.objectives) {
      const path = findPath(s.cost, from, objectiveCell(ctx, id))
      if (!path) {
        team.track = []
        return
      }
      legs.push(path.cells)
      from = path.cells[path.cells.length - 1]
    }
  }
  const out = pathDown(s.cost, s.exitCost, from)
  legs.push(out ? out.cells : [from])
  team.track = buildTrack(s.travel, legs, ctx.air, { tS: teamClock(s), airUsedL: here.airUsedL })
  team.index = 0
  team.plannedCost = remainingCost(s)
  s.planVersion++
}

/** Rooms on the rest of the plan (the team's own room included). */
function involvedRooms(ctx: SimContext, s: SimState): Set<number> {
  const out = new Set<number>()
  for (let k = s.team.index; k < s.team.track.length; k++) {
    const r = ctx.site.room[s.team.track[k].cell]
    if (r >= 0) out.add(r)
  }
  if (s.team.mode !== 'evacuating') for (const id of s.team.objectives) out.add(ctx.site.room[objectiveCell(ctx, id)])
  return out
}

/** The verdict of the rest of the plan, then the latch. */
export function judge(ctx: SimContext, s: SimState) {
  const { site } = ctx
  const reasons: Reason[] = []
  if (s.team.track.length === 0 && s.team.mode !== 'out') {
    reasons.push({ code: 'NO_PATH', severity: 'no-go', message: 'Aucun itinéraire praticable vers les objectifs', source: 'route', status: 'MODELED' })
  }
  const involved = involvedRooms(ctx, s)
  for (const r of involved) {
    const o = s.observations[r]
    const name = site.rooms[r].name
    if (o.condition === 'failed') reasons.push({ code: 'ROOM_FAILED', severity: 'no-go', message: `${name} : détecteurs hors service (> ${v(H.detectors.failureC)} °C au plafond)`, source: 'rules', status: o.status, room: r })
    else if (o.condition === 'hot') reasons.push({ code: 'ROOM_HOT', severity: 'caution', message: `${name} : fumées chaudes (${Math.round(o.tLastC)} °C au plafond)`, source: 'rules', status: o.status, room: r })
  }
  if (s.team.track.length > 0 && s.team.mode !== 'out') reasons.push(...airReasons(s.team.track.slice(s.team.index), s.exitTravel, ctx.air))
  const base = verdictOf(reasons)
  s.computed = finalVerdict(ctx, s, base, involved)
  const before = s.latch.latched
  const { shown, latch } = applyLatch(s.latch, s.computed, s.fire.t)
  s.shown = shown
  s.latch = latch
  // The latch just closed on an engaged team: get them out.
  if (!before && latch.latched && s.team.mode === 'engaged') {
    s.team.mode = 'evacuating'
    s.notes.push({ t: s.fire.t, text: `NO-GO : ${shown.reasons.find((r) => r.severity === 'no-go')?.message ?? ''}. Sortie la plus proche.` })
    replan(ctx, s)
    judgeAfterReplan(ctx, s)
  }
}

/** Re-judges after an evacuation re-plan without re-triggering it (the latch already holds). */
function judgeAfterReplan(ctx: SimContext, s: SimState) {
  const involved = involvedRooms(ctx, s)
  const reasons: Reason[] = []
  if (s.team.track.length > 0) reasons.push(...airReasons(s.team.track.slice(s.team.index), s.exitTravel, ctx.air))
  s.computed = finalVerdict(ctx, s, verdictOf(reasons), involved)
  s.shown = applyLatch(s.latch, s.computed, s.fire.t).shown
}

/** The rules' verdict, then the AI's reasons (R1), then the indoor drone's (R9): each can only add. */
function finalVerdict(ctx: SimContext, s: SimState, base: Verdict, involved: Set<number>): Verdict {
  const withAi = mergeAi(base, aiReasons(ctx.site, s.predictions, involved, ctx.predictor.dummy))
  return mergeKnown(withAi, knownReasons(s.known, involved, (r) => ctx.site.rooms[r].name))
}

/** One simulated second (or dt). */
export function tick(ctx: SimContext, s: SimState, dt = v(H.sim.tickS)): void {
  stepFire(ctx.setup, ctx.params, s.fire, dt)
  flyDrone(ctx, s)
  observe(ctx, s)
  const team = s.team
  if (team.mode === 'engaged' || team.mode === 'evacuating') {
    const here = locate(s)
    team.index = here.index
    // Objectives reached and worked are done.
    while (team.mode === 'engaged' && team.objectives.length > 0) {
      const cell = objectiveCell(ctx, team.objectives[0])
      const k = team.track.findIndex((p, i) => i <= team.index && p.cell === cell && p.departS <= teamClock(s))
      if (k < 0) break
      team.done.push(team.objectives.shift()!)
    }
    if (team.index >= team.track.length - 1 && teamClock(s) >= (team.track[team.track.length - 1]?.arriveS ?? 0)) {
      team.mode = 'out'
      s.notes.push({ t: s.fire.t, text: 'Binôme sorti.' })
    }
  }
  const prev = s.computed.verdict
  judge(ctx, s)
  const costNow = remainingCost(s)
  const moved = team.plannedCost > 0 && Math.abs(costNow - team.plannedCost) / team.plannedCost > v(H.danger.rerouteCostChange)
  if ((team.mode === 'engaged' || team.mode === 'standby') && (prev !== s.computed.verdict || moved)) {
    replan(ctx, s)
    judge(ctx, s)
  }
}

// ---------- Drone ----------

/** Where the fire is, as the detectors tell it (R5): the first room whose detectors all failed, else the hottest. */
function detectedFire(ctx: SimContext, s: SimState): Point | null {
  let best = s.observations.findIndex((o) => o.condition === 'failed')
  if (best < 0) {
    let hottest = -Infinity
    s.observations.forEach((o, r) => {
      if (o.condition !== 'clear' && o.tLastC > hottest) {
        hottest = o.tLastC
        best = r
      }
    })
  }
  if (best < 0) return null
  const b = ctx.roomBox[best]
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
}

/** Moves the drone along its flight; its thermal camera sees the roofs within its footprint (SIMULATED image). */
function flyDrone(ctx: SimContext, s: SimState) {
  const d = s.drone
  if (d.status !== 'flying' || !d.flight || d.launchedAt === null) return
  const elapsed = s.fire.t - d.launchedAt
  const at = droneAt(d.flight, elapsed)
  if (at?.aloft) {
    ctx.roomBox.forEach((b, r) => {
      const dx = Math.max(b.x0 - at.x, 0, at.x - b.x1)
      const dy = Math.max(b.y0 - at.y, 0, at.y - b.y1)
      if (Math.hypot(dx, dy) <= ctx.drone.footprintM) d.seen[r] = true
    })
  }
  const ambient = ctx.params.ambientC
  d.seen.forEach((seen, r) => {
    if (!seen) return
    d.noise = (Math.imul(d.noise, 1103515245) + 12345) | 0
    const jitter = (((d.noise >>> 8) & 0xffff) / 0xffff - 0.5) * 2 * v(H.drone.roofNoiseSdC)
    d.roofC[r] = ambient + v(H.drone.roofCoupling) * (s.fire.rooms[r].layerC - ambient) + jitter
  })
  if (elapsed >= d.flight.landedS) {
    d.status = 'landed'
    s.notes.push({ t: s.fire.t, text: 'Drone posé sur l’engin.' })
  }
}

/** Take-off: the flight is planned now, around the plume as the detectors locate the fire and the wind orients it. */
export function launchDrone(ctx: SimContext, s: SimState): void {
  const d = s.drone
  if (d.status === 'flying') return
  const fire = detectedFire(ctx, s)
  const plume = fire ? plumeOf(fire, ctx.wind, ctx.drone) : null
  const flight = planFlight(ctx.loop, ctx.site.engine.at, plume, ctx.wind, ctx.drone)
  d.flight = flight
  d.reason = flight.reason
  if (!flight.ok) {
    d.status = 'refused'
    s.notes.push({ t: s.fire.t, text: flight.reason ?? 'Vol refusé.' })
    return
  }
  d.status = 'flying'
  d.launchedAt = s.fire.t
  d.seen = d.seen.map(() => false)
  s.notes.push({ t: s.fire.t, text: flight.reason ? `Drone en vol : ${flight.reason}.` : 'Drone en vol : tour complet du bâtiment.' })
}

/**
 * The indoor drone's flight, planned now from what PNR knows (open doors, detector temperatures) towards the team's
 * objectives, and sensed from the truth, with each picture stamped with the time it is taken. The flight is computed in
 * one go; the views only get what has reached PNR by the current time (a picture from a radio dead zone arrives late).
 * Simplification: the rooms' temperatures are read at take-off, not along the flight.
 */
export function launchIndoor(ctx: SimContext, s: SimState): void {
  const { site } = ctx
  const known: IndoorKnown = { doorOpen: [...s.fire.doorOpen], roomTLastC: s.observations.map((o) => o.tLastC) }
  const ids = s.team.objectives.length > 0 ? s.team.objectives : site.demo.objectives
  const plan = planIndoor(site, known, s.team.entryDoor, ids.map((id) => ({ id, cell: objectiveCell(ctx, id) })), ctx.indoor)
  if (!plan.ok) {
    s.indoor = { status: 'refused', launchedAt: s.fire.t, plan, observations: [], reason: plan.reason }
    s.notes.push({ t: s.fire.t, text: plan.reason ?? 'Drone d’intérieur : vol refusé.' })
    return
  }
  const truth = { layerC: s.fire.rooms.map((r) => r.layerC), doorOpen: [...s.fire.doorOpen], hidden: site.hidden, ambientC: ctx.params.ambientC }
  const observations = senseIndoor(site, plan, truth, s.fire.t, ctx.indoor, v(H.sim.seed))
  s.indoor = { status: 'flown', launchedAt: s.fire.t, plan, observations, reason: plan.reason }
  s.notes.push({ t: s.fire.t, text: `Drone d’intérieur en vol${plan.reason ? ` : ${plan.reason}` : ''}. ${observations.length} observations horodatées.` })
  // Its picture counts from this tick.
  observe(ctx, s)
}

// ---------- PC actions ----------

export function startFire(ctx: SimContext, s: SimState, at: Point): boolean {
  const cell = cellAt(ctx.site, at)
  const room = cell >= 0 ? ctx.site.room[cell] : -1
  if (room < 0) return false
  ignite(s.fire, room, at)
  return true
}

export function toggleDoor(ctx: SimContext, s: SimState, door: number): void {
  if (ctx.site.doors[door].isExit) return
  setDoor(s.fire, door, !s.fire.doorOpen[door])
}

export function engage(ctx: SimContext, s: SimState): void {
  if (s.team.mode !== 'standby') return
  s.team.mode = 'engaged'
  s.team.engagedAt = s.fire.t
  replan(ctx, s)
  judge(ctx, s)
}

export function setObjectives(ctx: SimContext, s: SimState, ids: string[], note: string): void {
  s.team.objectives = ids.filter((id) => !s.team.done.includes(id))
  if (s.team.mode === 'engaged' || s.team.mode === 'standby') replan(ctx, s)
  s.notes.push({ t: s.fire.t, text: note })
  judge(ctx, s)
}

export function evacuate(ctx: SimContext, s: SimState): void {
  if (s.team.mode !== 'engaged') return
  s.team.mode = 'evacuating'
  s.notes.push({ t: s.fire.t, text: 'Évacuation ordonnée par le COS.' })
  replan(ctx, s)
  judge(ctx, s)
}

/**
 * The COS re-engages after a NO-GO (R6): logged, and the plan goes back to the objectives still listed, from where the
 * team is (outside included), with the air they have left.
 */
export function reengageTeam(ctx: SimContext, s: SimState): void {
  if (!s.latch.latched) return
  s.latch = openLatch(s.latch, s.fire.t)
  if (s.team.mode === 'evacuating' || s.team.mode === 'out') s.team.mode = 'engaged'
  s.notes.push({ t: s.fire.t, text: 'Ré-engagement : décision COS.' })
  replan(ctx, s)
  judge(ctx, s)
}

/** Live numbers of the team for the views. */
export function teamNow(ctx: SimContext, s: SimState) {
  const here = s.team.mode === 'standby' ? { index: 0, cell: s.team.track[0]?.cell ?? -1, airUsedL: 0 } : locate(s)
  const pnr = s.team.track.length ? checkPnr(s.team.track.slice(here.index), s.exitTravel, ctx.air) : null
  return {
    cell: here.cell,
    bar: barAfter(ctx.air, here.airUsedL),
    exitBar: pnr?.exitBar ?? null,
    pnrMarginBar: pnr && Number.isFinite(pnr.worstMarginL) ? pnr.worstMarginL / ctx.air.cylinderL : null,
    toExitS: here.cell >= 0 ? s.exitTravel[here.cell] : null,
    clock: teamClock(s),
  }
}

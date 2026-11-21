// The rehearsal: before the team goes in, PNR plays the planned mission in fast forward on what it KNOWS (the detectors,
// the AI, the indoor drone's observations) and the fire-growth hypotheses of data/config.json, and turns it into an
// intervention plan: entry, order of the objectives, time to turn back, fall-back exit, risks, and a GO or NO-GO per phase.
//
// R11: it never reads the simulator's truth. Its only input is KnownInput, built from fields the PC itself shows (see
// input.ts); nothing here can reach a fire state. Pure functions, deterministic: the same input gives the same plan.
// It reuses the existing A* (route/), air budget and point of no return (stats/air.ts), and the verdict's reasons.
// Everything it produces is a SIMULATION of what could happen (R12): MODELED at best, SIMULATED with simulated readings.

import { H, v } from '../config.ts'
import { paceOf, ruleMultiplier, type RoomCondition } from '../danger/rules.ts'
import { knownReasons, type Known } from '../knowledge/known.ts'
import { prepareGrid, stepTime, type PreparedGrid } from '../route/cost.ts'
import { bestOrder, nearestHaven } from '../route/optimize.ts'
import { findPath, pathDown, walkHomeField } from '../route/search.ts'
import { cellCentre, type Site } from '../site/site.ts'
import { airParams, airReasons, barAfter, buildTrack, checkPnr, usableL, type TrackPoint } from '../stats/air.ts'
import { worstStatus } from '../stats/status.ts'
import { verdictOf, type Reason, type Verdict } from '../stats/verdict.ts'
import type { DataStatus } from '../types.ts'

export interface KnownRoomInput {
  condition: RoomCondition
  /** the detectors' room signal, °C */
  tLastC: number
  status: DataStatus
  /** the AI's view; null outside the flashover model (the hall) */
  pred: { alert: boolean; horizonS: 30 | 60 | null; tffS: number; p60: number; status: DataStatus } | null
}

/** All the rehearsal gets: what PNR knows now. There is no simulator truth in it, by construction (R11). */
export interface KnownInput {
  /** simulated time now, s: the rehearsal starts here, and its times are T+ from the engagement */
  tS: number
  doorOpen: readonly boolean[]
  rooms: readonly KnownRoomInput[]
  known: Known
  /** the objectives the COS wants done, in the order given */
  objectives: readonly string[]
  entryDoor: number
  readingsStatus: DataStatus
}

export type PhaseVerdict = Verdict['verdict']

export interface RehearsalPhase {
  label: string
  /** first and last track point of the phase */
  from: number
  to: number
  verdict: PhaseVerdict
  reasons: Reason[]
}

export interface RehearsalEvent {
  kind: 'entry' | 'objective' | 'turn-back' | 'exit'
  label: string
  /** T+ since the engagement, s */
  tS: number
  /** pressure at that moment, bar; null when it is not a point of the track */
  bar: number | null
}

export interface RehearsalPlan {
  /** simulated time the rehearsal ran at */
  builtAtS: number
  entryDoor: number
  /** objective ids in the order the plan visits them */
  order: string[]
  /** objectives no route reaches */
  unreachable: string[]
  track: TrackPoint[]
  /** the track point of each objective, in `order` */
  objectiveIndex: number[]
  /** margin before the point of no return at each track point, bar above what the way out at ×returnFactor needs */
  marginBar: number[]
  timeline: RehearsalEvent[]
  /** T+ by which the team must have turned back for the way out to stay guaranteed; null with no objective */
  turnBackS: number | null
  turnBackAt: string | null
  exitBar: number
  exitName: string
  fallback: { name: string; timeS: number } | null
  phases: RehearsalPhase[]
  verdict: PhaseVerdict
  /** every reason, no-go first */
  reasons: Reason[]
  /** per room: T+ from which it is impassable in the rehearsal (0 = already, Infinity = not within the horizon) */
  closeAtS: number[]
  status: DataStatus
}

interface Grids {
  travel: PreparedGrid
  cost: PreparedGrid
}

/** The route-cost and travel grids from what PNR knows, the drone's closed passages included. */
function gridsOf(site: Site, input: KnownInput, blocked: readonly number[]): Grids {
  const travelPace = input.rooms.map((r) => paceOf(r.condition))
  const costPace = input.rooms.map((r, i) => paceOf(r.condition) * ruleMultiplier(r.condition) * (r.pred?.alert ? v(H.danger.predictedFlashoverCostMultiplier) : 1) * (input.known.rooms[i]?.extraCost ?? 1))
  const travel = prepareGrid(site, travelPace)
  const cost = prepareGrid(site, costPace)
  for (const c of blocked) {
    travel.pace[c] = Infinity
    cost.pace[c] = Infinity
  }
  return { travel, cost }
}

/** T+ from which each room is impassable: now for a failed or too-hot room, the predicted flashover less the margin for the others. */
export function closeTimes(input: KnownInput): number[] {
  const margin = v(H.rehearsal.flashoverMarginS)
  return input.rooms.map((r, i) => {
    if (input.known.rooms[i]?.tooHot || r.condition === 'failed') return 0
    if (r.pred?.alert) return Math.max(0, r.pred.tffS - margin)
    return Infinity
  })
}

const fmt = (s: number) => `T+${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** The legs, entry → each objective in order → nearest exit, on the cost grid; null when an objective cannot be reached. */
function legsOf(site: Site, g: Grids, entryCell: number, order: string[], exitCost: Float32Array): { legs: number[][]; unreachable: string[]; kept: string[] } {
  const legs: number[][] = []
  const unreachable: string[] = []
  const kept: string[] = []
  let from = entryCell
  for (const id of order) {
    const o = site.objectives.find((x) => x.id === id)
    const path = o ? findPath(g.cost, from, o.cell) : null
    if (!path) {
      unreachable.push(id)
      continue
    }
    legs.push(path.cells)
    kept.push(id)
    from = path.cells[path.cells.length - 1]
  }
  const out = pathDown(g.cost, exitCost, from)
  legs.push(out ? out.cells : [from])
  return { legs, unreachable, kept }
}

/** Seconds the plan takes on the travel grid, for comparing a route with and without the drone's closed passages. */
function legsTime(g: Grids, legs: number[][]): number {
  const w = g.travel.grid.width
  let t = 0
  for (const cells of legs) {
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1]
      const b = cells[k]
      const diag = a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0)
      t += stepTime(g.travel, a, b, diag ? g.travel.grid.cellSizeM * Math.SQRT2 : g.travel.grid.cellSizeM)
    }
  }
  return t
}

export function rehearse(site: Site, input: KnownInput): RehearsalPlan {
  const ap = airParams()
  const g = gridsOf(site, input, input.known.blockedCells)
  const entryCell = site.doors[input.entryDoor].cells[0]
  const exits = site.exits.map((e) => site.doors[e].cells[0])
  const exitCost = nearestHaven(exits.map((c) => walkHomeField(g.cost, c)))
  const exitTravel = nearestHaven(exits.map((c) => walkHomeField(g.travel, c)))
  const closeAtS = closeTimes(input)
  const nameOf = (r: number) => site.rooms[r].name

  // Order: the shortest tour entry → objectives → entry on the cost grid (existing branch and bound).
  const ids = input.objectives.filter((id) => site.objectives.some((o) => o.id === id))
  const cells = ids.map((id) => site.objectives.find((o) => o.id === id)!.cell)
  const matrix = [entryCell, ...cells].map((a, i, all) => all.map((b, j) => (i === j ? 0 : (findPath(g.cost, a, b)?.timeS ?? Infinity))))
  const idx = ids.length > 0 ? (bestOrder(matrix) ?? ids.map((_, i) => i + 1)) : []
  const wanted = idx.map((i) => ids[i - 1])

  const { legs, unreachable, kept } = legsOf(site, g, entryCell, wanted, exitCost)
  const track = buildTrack(g.travel, legs, ap, { tS: 0, airUsedL: 0 })

  // What the drone's closed passages cost: the same plan as if nothing were blocked.
  let detourS = 0
  if (input.known.blockedCells.length > 0) {
    const free = gridsOf(site, input, [])
    const freeExit = nearestHaven(exits.map((c) => walkHomeField(free.cost, c)))
    detourS = legsTime(g, legs) - legsTime(free, legsOf(site, free, entryCell, wanted, freeExit).legs)
  }

  // Objective points: the last track point of each approach leg.
  const legOf = track.map((p) => p.leg)
  const objectivePoints = kept.map((id, li) => ({ id, name: site.objectives.find((o) => o.id === id)!.name, index: Math.max(0, legOf.findLastIndex((l) => l <= li)) }))
  const exitDoor = site.doors[site.door[track[track.length - 1].cell]]
  const exitName = exitDoor?.name ?? 'Sortie'

  // Air and point of no return, the existing checks.
  const airR = track.length > 1 ? airReasons(track, exitTravel, ap) : []
  const pnr = checkPnr(track, exitTravel, ap)
  const exitRate = ap.exitLpm / 60
  const workRate = ap.workLpm / 60

  // When must the team turn back? At each objective: the time it can still stay there before the way out, at ×returnFactor,
  // is no longer guaranteed above the whistle (air) or crosses a room that will be impassable by then (fire).
  let turnBackS: number | null = null
  let turnBackAt: string | null = null
  for (const o of objectivePoints) {
    const p = track[o.index]
    const airSlackS = (usableL(ap, barAfter(ap, p.airUsedL)) - ap.returnFactor * exitTravel[p.cell] * exitRate) / workRate
    let fireSlackS = Infinity
    let fireRoom = ''
    const way = pathDown(g.cost, exitCost, p.cell)
    if (way) {
      let off = 0
      const seen = new Set<number>()
      for (let k = 1; k < way.cells.length; k++) {
        const a = way.cells[k - 1]
        const b = way.cells[k]
        const w = g.travel.grid.width
        const diag = a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0)
        off += stepTime(g.travel, a, b, diag ? g.travel.grid.cellSizeM * Math.SQRT2 : g.travel.grid.cellSizeM)
        const r = site.room[b]
        if (r >= 0 && !seen.has(r)) {
          seen.add(r)
          if (Number.isFinite(closeAtS[r])) {
            const slack = closeAtS[r] - (p.departS + ap.returnFactor * off)
            if (slack < fireSlackS) {
              fireSlackS = slack
              fireRoom = nameOf(r)
            }
          }
        }
      }
    }
    const limit = p.departS + Math.min(airSlackS, fireSlackS)
    if (turnBackS === null || limit < turnBackS) {
      turnBackS = limit
      turnBackAt = `${o.name} · limité par ${airSlackS <= fireSlackS ? 'l’air' : fireRoom}`
    }
  }

  // Phases: one per leg. A room on a phase is a risk when it will be impassable before the team has left it.
  const phases: RehearsalPhase[] = legs.map((_, li) => {
    const from = track.findIndex((p) => p.leg === li)
    const to = track.map((p) => p.leg).lastIndexOf(li)
    const label = li < kept.length ? `Vers ${objectivePoints[li].name}` : `Sortie par ${exitName}`
    const reasons: Reason[] = []
    const rooms = new Map<number, { arrive: number; leave: number }>()
    for (let k = Math.max(0, from); k <= to; k++) {
      const r = site.room[track[k].cell]
      if (r < 0) continue
      const e = rooms.get(r)
      if (e) e.leave = track[k].departS
      else rooms.set(r, { arrive: track[k].arriveS, leave: track[k].departS })
    }
    for (const [r, e] of rooms) {
      const close = closeAtS[r]
      const cond = input.rooms[r].condition
      const st = input.rooms[r].status
      if (input.known.rooms[r]?.tooHot || cond === 'failed') {
        reasons.push({ code: 'ROOM_FAILED', severity: 'no-go', message: `${nameOf(r)} : ${cond === 'failed' ? 'détecteurs hors service' : 'trop chaud pour le drone'}, infranchissable`, source: 'rules', status: st, room: r })
      } else if (Number.isFinite(close) && e.arrive >= close) {
        reasons.push({ code: 'FLASHOVER_PREDICTED', severity: 'no-go', message: `${nameOf(r)} : infranchissable à ${fmt(close)} (embrasement prévu), le binôme y arrive à ${fmt(e.arrive)}`, source: 'ai', status: input.rooms[r].pred?.status ?? st, room: r })
      } else if (Number.isFinite(close) && e.leave > close) {
        reasons.push({ code: 'FLASHOVER_PREDICTED', severity: 'no-go', message: `${nameOf(r)} : s'embrase avant que le binôme en soit sorti (${fmt(close)} contre ${fmt(e.leave)})`, source: 'ai', status: input.rooms[r].pred?.status ?? st, room: r })
      } else if (input.rooms[r].pred?.alert) {
        reasons.push({ code: 'FLASHOVER_PREDICTED', severity: 'caution', message: `${nameOf(r)} : embrasement prévu à ${fmt(close)}, passage avant`, source: 'ai', status: input.rooms[r].pred!.status, room: r })
      } else if (cond === 'hot') {
        reasons.push({ code: 'ROOM_HOT', severity: 'caution', message: `${nameOf(r)} : fumées chaudes (${Math.round(input.rooms[r].tLastC)} °C au plafond)`, source: 'rules', status: st, room: r })
      }
    }
    reasons.push(...knownReasons(input.known, new Set(rooms.keys()), nameOf).filter((x) => !reasons.some((y) => y.room === x.room && y.severity === 'no-go')))
    if (li === legs.length - 1) reasons.push(...airR)
    const verdict = verdictOf(reasons)
    return { label, from: Math.max(0, from), to, verdict: verdict.verdict, reasons: verdict.reasons }
  })

  const global: Reason[] = []
  for (const id of unreachable) global.push({ code: 'NO_PATH', severity: 'no-go', message: `Aucun itinéraire praticable vers « ${site.objectives.find((o) => o.id === id)?.name ?? id} »`, source: 'route', status: 'MODELED' })
  if (detourS > 1) global.push({ code: 'HAZARD', severity: 'info', message: `Passage obstrué trouvé par le drone : contournement, +${Math.round(detourS)} s sur le trajet`, source: 'drone', status: 'SIMULATED' })
  if (turnBackS !== null) global.push({ code: 'POINT_OF_NO_RETURN', severity: 'info', message: `Demi-tour au plus tard à ${fmt(turnBackS)} (${turnBackAt})`, source: 'air', status: 'MODELED' })
  const all = verdictOf([...global, ...phases.flatMap((p) => p.reasons)])

  // The way out if the planned exit is cut: the nearest other exit from the last point.
  const last = track[track.length - 1].cell
  let fallback: RehearsalPlan['fallback'] = null
  for (const e of site.exits) {
    const door = site.doors[e]
    if (door.index === exitDoor?.index) continue
    const p = findPath(g.travel, last, door.cells[0])
    if (p && (!fallback || p.timeS < fallback.timeS)) fallback = { name: door.name, timeS: p.timeS }
  }

  const timeline: RehearsalEvent[] = [{ kind: 'entry', label: `Entrée par ${site.doors[input.entryDoor].name}`, tS: 0, bar: barAfter(ap, 0) }]
  for (const o of objectivePoints) timeline.push({ kind: 'objective', label: o.name, tS: track[o.index].arriveS, bar: barAfter(ap, track[o.index].airArriveL) })
  if (turnBackS !== null) timeline.push({ kind: 'turn-back', label: `Demi-tour au plus tard (${turnBackAt})`, tS: turnBackS, bar: null })
  timeline.push({ kind: 'exit', label: `Sortie par ${exitName}`, tS: track[track.length - 1].arriveS, bar: pnr.exitBar })
  timeline.sort((a, b) => a.tS - b.tS)

  return {
    builtAtS: input.tS,
    entryDoor: input.entryDoor,
    order: kept,
    unreachable,
    track,
    objectiveIndex: objectivePoints.map((o) => o.index),
    marginBar: track.map((p) => (usableL(ap, barAfter(ap, p.airUsedL)) - ap.returnFactor * exitTravel[p.cell] * exitRate) / ap.cylinderL),
    timeline,
    turnBackS,
    turnBackAt,
    exitBar: pnr.exitBar,
    exitName,
    fallback,
    phases,
    verdict: all.verdict,
    reasons: all.reasons,
    closeAtS,
    status: worstStatus('MODELED', input.readingsStatus, ...input.rooms.map((r) => r.status)),
  }
}

/** Where the team is on the rehearsed track at T+tS: the last point reached. */
export function pointAt(plan: RehearsalPlan, tS: number): number {
  let i = 0
  while (i + 1 < plan.track.length && plan.track[i + 1].arriveS <= tS) i++
  return i
}

/** The rooms as the rehearsal projects them at T+tS: a room that has become impassable shows as failed, the rest as known now. */
export function projectRooms(input: KnownInput, plan: RehearsalPlan, tS: number): { condition: RoomCondition[]; alert: boolean[] } {
  return {
    condition: input.rooms.map((r, i) => (plan.closeAtS[i] <= tS ? 'failed' : r.condition)),
    alert: input.rooms.map((r) => r.pred?.alert === true),
  }
}

/** Pressure at T+tS along the rehearsed track, bar (the air used so far, by the point reached). */
export function barAt(plan: RehearsalPlan, tS: number): number {
  const ap = airParams()
  const i = pointAt(plan, tS)
  const p = plan.track[i]
  return barAfter(ap, tS < p.departS ? p.airArriveL : p.airUsedL)
}

/** Where on the site the rehearsal's team stands at T+tS, for a map. */
export function standsAt(site: Site, plan: RehearsalPlan, tS: number) {
  return cellCentre(site, plan.track[pointAt(plan, tS)].cell)
}

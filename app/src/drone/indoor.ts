// The indoor reconnaissance drone (simulated): a small cage drone that enters by an exit, flies through the doors that are
// ALREADY OPEN, and reports what it sees. It never opens a door (opening one lets air in and can speed the fire up): a
// closed door stops it, and what lies behind stays UNKNOWN. It does not enter a room above its temperature limit.
// There is no GPS indoors and the radio link is poor: every observation is stamped with the time it was taken, and inside
// a radio dead zone it only reaches PNR when the link comes back.
//
// Planning reads what PNR knows (open doors, detector temperatures). Sensing reads the simulator's truth, as a real
// sensor would: it lives on the simulator's side, and PNR only ever sees the resulting observations (R9, R11).
// The route is the existing A* on the site grid, and the battery point of no return is the outdoor drone's logic: from
// every point the way home must still land with the reserve.

import { H, v } from '../config.ts'
import type { Observation } from '../knowledge/observation.ts'
import { prepareGrid, stepTime, type PreparedGrid } from '../route/cost.ts'
import { bestOrder } from '../route/optimize.ts'
import { findPath, pathDown, walkHomeField } from '../route/search.ts'
import { cellAt, cellCentre, type Site } from '../site/site.ts'
import { CELL, type Point } from '../types.ts'

export interface IndoorParams {
  enduranceS: number
  cruiseMs: number
  maxAmbientC: number
  reservePct: number
  viewRadiusM: number
  noiseSdC: number
  deadZoneWalls: number
}

export function indoorParams(): IndoorParams {
  const d = H.droneIndoor
  return {
    enduranceS: v(d.enduranceMin) * 60,
    cruiseMs: v(d.cruiseMs),
    maxAmbientC: v(d.maxAmbientC),
    reservePct: v(d.batteryReservePct),
    viewRadiusM: v(d.viewRadiusM),
    noiseSdC: v(d.thermalNoiseSdC),
    deadZoneWalls: v(H.radio.deadZoneWalls),
  }
}

/** What PNR knows when it plans the flight: never the simulator's truth. */
export interface IndoorKnown {
  /** doors as the plan and the COS's manoeuvres give them */
  doorOpen: readonly boolean[]
  /** the room's signal from its detectors, °C (NaN: every detector has failed, so it is above 150 °C) */
  roomTLastC: readonly number[]
}

/** What the sensor really sees: used by the simulator only. */
export interface IndoorTruth {
  layerC: readonly number[]
  doorOpen: readonly boolean[]
  /** things the plan does not show */
  hidden: readonly { id: string; name: string; cells: readonly number[] }[]
  ambientC: number
}

/**
 * The grid the drone flies on: the site's walls and equipment stay impassable, a door is passable only if it is open,
 * a room above the temperature limit is closed to it, and the outdoors is closed (it starts at the exit door).
 */
export function indoorGrid(site: Site, known: IndoorKnown, p: IndoorParams): { grid: PreparedGrid; tooHot: number[] } {
  const pace = 1 / p.cruiseMs
  const tooHot = site.rooms.filter((r) => Number.isNaN(known.roomTLastC[r.index]) || known.roomTLastC[r.index] >= p.maxAmbientC).map((r) => r.index)
  const hot = new Set(tooHot)
  const grid = prepareGrid(
    site,
    site.rooms.map(() => pace),
  )
  for (let i = 0; i < grid.pace.length; i++) {
    const k = site.kind[i]
    if (k === CELL.WALL || k === CELL.OBSTACLE) continue
    if (k === CELL.OUTSIDE) grid.pace[i] = Infinity
    else if (k === CELL.DOOR) grid.pace[i] = known.doorOpen[site.door[i]] ? pace : Infinity
    else if (k === CELL.EXIT) grid.pace[i] = pace
    else grid.pace[i] = hot.has(site.room[i]) ? Infinity : pace
  }
  return { grid, tooHot }
}

export interface IndoorPoint {
  cell: number
  /** time since take-off, s */
  tS: number
  batteryPct: number
  /** battery left after flying home from here, minus the reserve, %: never negative by construction */
  marginPct: number
}

export interface IndoorPlan {
  ok: boolean
  /** why the flight is refused or cut short; null when flown as planned */
  reason: string | null
  entryCell: number
  points: IndoorPoint[]
  /** rooms it will not enter */
  tooHot: number[]
  /** where it was sent, and whether it could get there (a closed door stops it short) */
  targets: { id: string; cell: number; reached: boolean }[]
  durationS: number
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Flight from an exit door to each target (or as near as the open doors allow), and back, cut at the battery point of no return. */
export function planIndoor(site: Site, known: IndoorKnown, entryDoor: number, targets: { id: string; cell: number }[], p: IndoorParams): IndoorPlan {
  const entryCell = site.doors[entryDoor].cells[0]
  const { grid, tooHot } = indoorGrid(site, known, p)
  const refuse = (reason: string): IndoorPlan => ({ ok: false, reason, entryCell, points: [], tooHot, targets: targets.map((t) => ({ ...t, reached: false })), durationS: 0 })
  const field = walkHomeField(grid, entryCell)
  if (!Number.isFinite(field[entryCell])) return refuse('Vol refusé : la sortie d’entrée est impraticable pour le drone')

  // Each target, or the reachable cell nearest to it when a closed door (or a hot room) is in the way.
  const resolved = targets.map((t) => {
    if (Number.isFinite(field[t.cell])) return { ...t, reached: true }
    const want = cellCentre(site, t.cell)
    let best = entryCell
    let bestD = Infinity
    for (let c = 0; c < field.length; c++) {
      if (!Number.isFinite(field[c])) continue
      const d = dist(cellCentre(site, c), want)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return { id: t.id, cell: best, reached: false }
  })
  const stops = resolved.filter((t, i) => i === resolved.findIndex((u) => u.cell === t.cell))
  const times = [entryCell, ...stops.map((s) => s.cell)].map((a, i, all) => all.map((b, j) => (i === j ? 0 : (findPath(grid, a, b)?.timeS ?? Infinity))))
  const order = stops.length > 0 ? (bestOrder(times) ?? stops.map((_, i) => i + 1)) : []

  const rate = 100 / p.enduranceS
  const points: IndoorPoint[] = []
  let t = 0
  let reason: string | null = null
  const here = (cell: number) => {
    const battery = 100 - t * rate
    points.push({ cell, tS: t, batteryPct: battery, marginPct: battery - field[cell] * rate - p.reservePct })
  }
  const step = (a: number, b: number) => {
    const w = grid.grid.width
    const diag = a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0)
    t += stepTime(grid, a, b, diag ? grid.grid.cellSizeM * Math.SQRT2 : grid.grid.cellSizeM)
  }
  here(entryCell)
  if (points[0].marginPct < 0) return refuse('Vol refusé : batterie insuffisante pour un aller-retour')

  let cut = false
  let reached = 0
  let at = entryCell
  for (const idx of order) {
    if (cut) break
    const path = findPath(grid, at, stops[idx - 1].cell)
    if (!path) continue
    for (let k = 1; k < path.cells.length; k++) {
      step(path.cells[k - 1], path.cells[k])
      here(path.cells[k])
      if (points[points.length - 1].marginPct < 0) {
        // Battery point of no return: drop this point and go home from the previous one.
        points.pop()
        t = points[points.length - 1].tS
        cut = true
        reason = 'Retour anticipé : point de non-retour batterie'
        break
      }
    }
    if (!cut) {
      at = path.cells[path.cells.length - 1]
      reached++
    } else at = points[points.length - 1].cell
  }
  // A battery that cannot even reach the first stop: there is no flight worth making.
  if (stops.length > 0 && reached === 0) return refuse('Vol refusé : batterie insuffisante pour atteindre la première cible')
  const home = pathDown(grid, field, at)
  if (home) {
    for (let k = 1; k < home.cells.length; k++) {
      step(home.cells[k - 1], home.cells[k])
      here(home.cells[k])
    }
  }
  const missed = resolved.filter((r) => !r.reached)
  if (!reason && missed.length > 0) reason = 'Porte fermée : le drone ne l’ouvre pas, le local au-delà reste inconnu'
  return { ok: true, reason, entryCell, points, tooHot, targets: resolved, durationS: points[points.length - 1].tS }
}

/** Walls the straight line a → b crosses (each wall counted once however thick). */
export function wallCrossings(site: Site, a: Point, b: Point): number {
  const n = Math.max(1, Math.ceil(dist(a, b) / (site.cellM / 2)))
  let crossings = 0
  let inWall = false
  for (let k = 0; k <= n; k++) {
    const c = cellAt(site, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
    const wall = c >= 0 && site.kind[c] === CELL.WALL
    if (wall && !inWall) crossings++
    inWall = wall
  }
  return crossings
}

/** Clear line of sight from the drone to a point: within the camera's radius and no wall in between (a door is no wall). */
function sees(site: Site, from: Point, to: Point, radiusM: number): boolean {
  const d = dist(from, to)
  if (d > radiusM) return false
  if (d < 1) return true
  // Stop a cell short of the target: a door sits in a wall line, and the line must not graze the wall around it.
  const k = 1 - site.cellM / d
  return wallCrossings(site, from, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }) === 0
}

/** Mulberry32 and Box-Muller: the sensor's noise, seeded so a run is repeatable. */
function noise(seed: number): () => number {
  let a = seed | 0
  const uniform = () => {
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), a | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) * Math.cos(2 * Math.PI * uniform())
}

/**
 * What the drone reports on this flight, stamped with when each picture was taken. The temperature it reads in a room is
 * the room's, plus sensor noise; in smoke the visible camera sees nothing and the confidence is lower. In a radio dead
 * zone (the line to the engine crosses at least deadZoneWalls walls) an observation only arrives when the link is back.
 */
export function senseIndoor(site: Site, plan: IndoorPlan, truth: IndoorTruth, launchT: number, p: IndoorParams, seed: number): Observation[] {
  if (!plan.ok) return []
  const gauss = noise(seed)
  const smokeAbove = v(H.progression.smokeAboveAmbientC)
  const inSmoke = (room: number) => room >= 0 && truth.layerC[room] >= truth.ambientC + smokeAbove
  const confidence = (...rooms: number[]) => (rooms.some(inSmoke) ? v(H.knowledge.confidenceSmoke) : v(H.knowledge.confidenceClear))
  const engine = site.engine.at
  const out: (Observation & { atIndex: number })[] = []
  const visited = new Set<number>()
  const doorsSeen = new Set<number>()
  const hotSeen = new Set<number>()
  const obstaclesSeen = new Set<string>()
  const base = { source: 'drone-indoor' as const, status: 'SIMULATED' as const, cells: [] as number[], room: null, door: null, valueC: null, open: null }

  plan.points.forEach((pt, i) => {
    const at = cellCentre(site, pt.cell)
    const takenAtS = launchT + pt.tS
    const make = (o: Partial<Observation> & Pick<Observation, 'kind' | 'confidence' | 'label'>) => out.push({ ...base, id: `${o.kind}-${out.length}`, takenAtS, receivedAtS: takenAtS, at, ...o, atIndex: i })

    const room = site.room[pt.cell]
    if (room >= 0 && !visited.has(room)) {
      visited.add(room)
      const c = Math.round(truth.layerC[room] + gauss() * p.noiseSdC)
      make({ kind: 'room-thermal', room, valueC: c, confidence: confidence(room), label: `${site.rooms[room].name} : ${c} °C relevés par le drone${inSmoke(room) ? ' (fumée : thermique seule)' : ''}` })
    }
    site.doors.forEach((d) => {
      if (d.isExit || doorsSeen.has(d.index) || !sees(site, at, d.centre, p.viewRadiusM)) return
      doorsSeen.add(d.index)
      const open = truth.doorOpen[d.index]
      make({ kind: 'door-state', door: d.index, open, confidence: confidence(...d.rooms), label: open ? `${d.name} : ouverte` : `${d.name} : fermée, le drone ne l’ouvre pas, au-delà INCONNU` })
      // Through an open door, a room too hot to enter is still seen: that is an observation too.
      if (open) {
        for (const r of d.rooms) {
          if (r < 0 || !plan.tooHot.includes(r) || hotSeen.has(r)) continue
          hotSeen.add(r)
          const c = Math.round(truth.layerC[r] + gauss() * p.noiseSdC)
          make({ kind: 'too-hot', room: r, valueC: c, confidence: confidence(r), label: `${site.rooms[r].name} : trop chaud pour le drone (${c} °C), il n’y entre pas` })
        }
      }
    })
    for (const h of truth.hidden) {
      if (obstaclesSeen.has(h.id)) continue
      if (!h.cells.some((c) => sees(site, at, cellCentre(site, c), p.viewRadiusM))) continue
      obstaclesSeen.add(h.id)
      make({ kind: 'obstacle', cells: [...h.cells], confidence: confidence(room), label: `Passage obstrué : ${h.name} (absent du plan)` })
    }
  })

  // The link: a picture taken in a dead zone arrives at the first later point out of it (or when the drone lands).
  const dead = plan.points.map((pt) => wallCrossings(site, engine, cellCentre(site, pt.cell)) >= p.deadZoneWalls)
  const lastT = launchT + plan.points[plan.points.length - 1].tS
  return out
    .map(({ atIndex, ...o }) => {
      let k = atIndex
      while (k < dead.length && dead[k]) k++
      return { ...o, receivedAtS: k < dead.length ? launchT + plan.points[k].tS : lastT }
    })
    .sort((a, b) => a.takenAtS - b.takenAtS)
}

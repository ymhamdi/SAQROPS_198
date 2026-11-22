// A first-person synthetic view of the building: walls, doors and machines rebuilt from the plan, smoke and heat from what
// the detectors say about each room, the AI's alerts on the rooms it flags. It is drawn, not filmed, and the views that
// show it say so (SIMULATED). It never reads the simulator's truth: the fire's real temperature, smoke layer and
// flashovers are not inputs here (R5, tested in scene.test.ts).
//
// Method: one ray per screen column through the site grid (digital differential analysis), the ray's optical depth
// accumulated through each room's smoke, then surfaces drawn far to near over a per-pixel floor.

import type { RoomCondition } from '../danger/rules'
import type { TeamMode } from '../sim/sim'
import type { Site } from '../site/site'
import { CELL } from '../types'
import type { Pose } from './camera'

/** Helmet height above the floor, m. Display geometry, not a hypothesis. */
export const EYE_M = 1.6
/** Horizontal field of view of the visor view. */
export const FOV_RAD = (76 * Math.PI) / 180
/** Where the horizon sits, as a fraction of the view's height. */
export const HORIZON = 0.5
/** Nothing nearer than this (m) is projected. */
const MIN_FORWARD_M = 0.25
/** Machines are drawn this high (m): low enough to see over, like the real equipment on the plan. */
const OBSTACLE_M = 1.8
/** Wall height (m) where the plan has none (a door cell the view stands in). */
const DEFAULT_WALL_M = 4
/** A ray stops after this many cells (110 m at 0.5 m). */
const MAX_CELLS = 220
/** Ceiling height (m) used only to fade the ceiling with distance. */
const CEILING_M = 4

/** Light absorbed per metre of smoke in each room condition. Display only: it follows what the detectors say, no more. */
const DENSITY: Record<RoomCondition, number> = { clear: 0.015, smoke: 0.09, hot: 0.18, failed: 0.3 }
const RANK: Record<RoomCondition, number> = { clear: 0, smoke: 1, hot: 2, failed: 3 }
/** Colour of the haze for the worst condition a ray has crossed. */
const FOG_RGB: readonly (readonly [number, number, number])[] = [
  [22, 26, 32],
  [96, 100, 106],
  [152, 100, 46],
  [140, 46, 36],
]
/** What a room's condition adds to the surfaces inside it: a warm cast in the hot rooms, a red one where detectors are lost. */
const CAST_RGB: Record<RoomCondition, readonly [number, number, number, number]> = {
  clear: [0, 0, 0, 0],
  smoke: [0, 0, 0, 0],
  hot: [255, 150, 60, 0.22],
  failed: [255, 80, 60, 0.3],
}
const ALERT_RGB = [255, 70, 50, 0.18] as const

const WALL_RGB = [150, 160, 172] as const
const OBSTACLE_RGB = [112, 120, 132] as const
const DOOR_RGB = [92, 98, 112] as const
const FRAME_RGB = [80, 140, 235] as const
const EXIT_RGB = [36, 190, 90] as const
const CEILING_RGB = [38, 43, 52] as const
const TILE_LIGHT_RGB = [82, 90, 100] as const
const TILE_DARK_RGB = [64, 71, 80] as const
const DAYLIGHT_RGB = [150, 160, 150] as const
const SKY_TOP_RGB = [96, 138, 190] as const
const SKY_HORIZON_RGB = [196, 212, 224] as const

export type HitKind = 'wall' | 'obstacle' | 'door' | 'lintel' | 'exit'

export interface Hit {
  kind: HitKind
  /** distance to the camera plane, m */
  perpM: number
  /** distance along the ray, m */
  rawM: number
  baseM: number
  topM: number
  /** opening height of a door or an exit, m */
  doorM: number
  side: 0 | 1
  /** position along the face, m, for the panel lines */
  along: number
  /** optical depth accumulated up to the hit */
  tau: number
  /** worst condition rank crossed up to the hit */
  rank: number
  /** the room the surface faces */
  room: number
}

/** A breakpoint of the ray's haze: optical depth and worst condition rank accumulated up to a distance (piecewise linear). */
export interface Seg {
  rawM: number
  tau: number
  rank: number
}

export interface Column {
  /** surfaces met, nearest first; the last blocks the ray unless it is a lintel or a machine */
  hits: Hit[]
  /** distance to the first thing that blocks the ray (camera plane, m), Infinity when nothing does */
  blockM: number
  segs: Seg[]
  outside: boolean
}

export interface Ray {
  x: number
  y: number
  len: number
}

/** A pixel surface: an ImageData, or anything shaped like one (tests use a plain object). */
export interface Surface {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** The ray through a screen column; `cameraX` runs from −1 (left edge) to +1 (right edge). */
export function rayOf(pose: Pose, cameraX: number): Ray {
  const t2 = Math.tan(FOV_RAD / 2)
  const x = Math.cos(pose.heading) - Math.sin(pose.heading) * t2 * cameraX
  const y = Math.sin(pose.heading) + Math.cos(pose.heading) * t2 * cameraX
  return { x, y, len: Math.hypot(x, y) }
}

/** Screen position of a point of the site at height `hM`, for a view of `width` × `height`; null when it is behind or too near. */
export function project(pose: Pose, width: number, height: number, wx: number, wy: number, hM: number): { x: number; y: number; forward: number } | null {
  const rx = wx - pose.x
  const ry = wy - pose.y
  const forward = rx * Math.cos(pose.heading) + ry * Math.sin(pose.heading)
  if (forward < MIN_FORWARD_M) return null
  const right = -rx * Math.sin(pose.heading) + ry * Math.cos(pose.heading)
  const focal = width / 2 / Math.tan(FOV_RAD / 2)
  return { x: width / 2 + (right / forward) * focal, y: height * HORIZON + ((EYE_M - hM) / forward) * focal, forward }
}

const wallTops = new WeakMap<Site, Float32Array>()

/**
 * Height (m) of the wall, door or exit at a cell: the lowest of the rooms it touches (a partition between the hall and a
 * 4 m room is 4 m, an outer wall is its room's height). It depends on the cell only, never on the direction of the ray.
 */
export function wallTopM(site: Site, cell: number): number {
  let tops = wallTops.get(site)
  if (!tops) {
    tops = new Float32Array(site.width * site.height).fill(NaN)
    wallTops.set(site, tops)
  }
  if (!Number.isNaN(tops[cell])) return tops[cell]
  let top = Infinity
  const x = cell % site.width
  for (const n of [x > 0 ? cell - 1 : -1, x < site.width - 1 ? cell + 1 : -1, cell - site.width, cell + site.width]) {
    if (n < 0 || n >= site.room.length) continue
    const k = site.kind[n]
    if ((k === CELL.FLOOR || k === CELL.OBSTACLE) && site.room[n] >= 0) top = Math.min(top, site.rooms[site.room[n]].heightM)
  }
  tops[cell] = top === Infinity ? DEFAULT_WALL_M : top
  return tops[cell]
}

/** Walks one ray through the grid and lists what it meets. */
export function castColumn(site: Site, doorOpen: readonly boolean[], cond: readonly RoomCondition[], pose: Pose, ray: Ray): Column {
  const cm = site.cellM
  const posX = pose.x / cm
  const posY = pose.y / cm
  let mapX = Math.floor(posX)
  let mapY = Math.floor(posY)
  const dX = ray.x === 0 ? Infinity : Math.abs(1 / ray.x)
  const dY = ray.y === 0 ? Infinity : Math.abs(1 / ray.y)
  const stepX = ray.x < 0 ? -1 : 1
  const stepY = ray.y < 0 ? -1 : 1
  let sideX = ray.x === 0 ? Infinity : ray.x < 0 ? (posX - mapX) * dX : (mapX + 1 - posX) * dX
  let sideY = ray.y === 0 ? Infinity : ray.y < 0 ? (posY - mapY) * dY : (mapY + 1 - posY) * dY
  const startRoom = mapX >= 0 && mapY >= 0 && mapX < site.width && mapY < site.height ? site.room[mapY * site.width + mapX] : -1
  let fogRoom = startRoom
  let lastRoom = startRoom
  let tau = 0
  let rank = 0
  let tPrev = 0
  let prevObstacle = false
  let blockM = Infinity
  let outside = false
  const hits: Hit[] = []
  const segs: Seg[] = [{ rawM: 0, tau: 0, rank: 0 }]

  for (let n = 0; n < MAX_CELLS; n++) {
    let t: number
    let side: 0 | 1
    if (sideX < sideY) {
      t = sideX
      sideX += dX
      mapX += stepX
      side = 0
    } else {
      t = sideY
      sideY += dY
      mapY += stepY
      side = 1
    }
    // The light absorbed in the cell just left.
    const left: RoomCondition = fogRoom >= 0 ? cond[fogRoom] : 'clear'
    tau += DENSITY[left] * (t - tPrev) * ray.len * cm
    rank = Math.max(rank, RANK[left])
    tPrev = t
    if (mapX < 0 || mapY < 0 || mapX >= site.width || mapY >= site.height) {
      outside = true
      segs.push({ rawM: t * ray.len * cm, tau, rank })
      break
    }
    const cell = mapY * site.width + mapX
    const kind = site.kind[cell]
    if (kind === CELL.FLOOR) {
      const r = site.room[cell]
      if (r >= 0) {
        // A breakpoint only where the smoke density changes: between two of them the haze is linear.
        if (cond[r] !== left) segs.push({ rawM: t * ray.len * cm, tau, rank })
        fogRoom = r
        lastRoom = r
      }
      prevObstacle = false
      continue
    }
    if (kind === CELL.OUTSIDE) {
      // Open ground around the building (the view stands there once the team is out): clear air, and the ray goes on.
      if (left !== 'clear') segs.push({ rawM: t * ray.len * cm, tau, rank })
      fogRoom = -1
      prevObstacle = false
      continue
    }

    const perpM = t * cm
    const rawM = perpM * ray.len
    const along = side === 0 ? pose.y + ray.y * perpM : pose.x + ray.x * perpM
    const make = (k: HitKind, baseM: number, topM: number, doorM: number): Hit => ({ kind: k, perpM, rawM, baseM, topM, doorM, side, along, tau, rank, room: lastRoom })
    const wallM = () => wallTopM(site, cell)

    if (kind === CELL.OBSTACLE) {
      const r = site.room[cell]
      if (r >= 0) {
        if (cond[r] !== left) segs.push({ rawM, tau, rank })
        fogRoom = r
        lastRoom = r
      }
      if (!prevObstacle) hits.push(make('obstacle', 0, OBSTACLE_M, 0))
      prevObstacle = true
      continue
    }
    prevObstacle = false
    if (kind === CELL.DOOR) {
      const d = site.door[cell]
      const doorM = site.doors[d].heightM
      const top = Math.max(wallM(), doorM)
      if (doorOpen[d]) {
        hits.push(make('lintel', doorM, top, doorM))
        continue
      }
      hits.push(make('door', 0, top, doorM))
      blockM = perpM
    } else if (kind === CELL.WALL) {
      hits.push(make('wall', 0, wallM(), 0))
      blockM = perpM
    } else if (kind === CELL.EXIT) {
      const doorM = site.doors[site.door[cell]].heightM
      hits.push(make('exit', 0, Math.max(wallM(), doorM), doorM))
      blockM = perpM
    }
    segs.push({ rawM, tau, rank })
    break
  }
  // A ray that used up its range ends here.
  if (blockM === Infinity && !outside) segs.push({ rawM: tPrev * ray.len * cm, tau, rank })
  return { hits, blockM, segs, outside }
}

/** Haze cursor: the optical depth and condition rank at a distance along a ray, found by walking forward through its breakpoints. */
interface Haze {
  i: number
  tau: number
  rank: number
}

function hazeAt(segs: readonly Seg[], at: Haze, rawM: number): void {
  while (at.i + 1 < segs.length && segs[at.i + 1].rawM < rawM) at.i++
  const a = segs[at.i]
  const b = segs[at.i + 1]
  if (!b) {
    at.tau = a.tau
    at.rank = a.rank
    return
  }
  const f = b.rawM > a.rawM ? Math.min(1, Math.max(0, (rawM - a.rawM) / (b.rawM - a.rawM))) : 1
  at.tau = a.tau + (b.tau - a.tau) * f
  at.rank = b.rank
}

/**
 * All the view reads: the doors, what the detectors and the model say about each room, and the team's route. A `Snapshot`
 * satisfies it, and so does any state built from these fields alone: the type leaves no room for the simulator's truth (R5).
 */
export interface SceneState {
  doorOpen: readonly boolean[]
  rooms: readonly { condition: RoomCondition; pred: { alert: boolean } | null }[]
  team: { mode: TeamMode; objectives: readonly string[]; track: readonly number[]; index: number; cell: number }
}

/** What the detectors and the model say about each room, as the scene uses it. */
export function sceneRooms(snap: SceneState): { cond: RoomCondition[]; alert: boolean[] } {
  return { cond: snap.rooms.map((r) => r.condition), alert: snap.rooms.map((r) => r.pred?.alert === true) }
}

const mix = (c: number, to: number, a: number) => c * (1 - a) + to * a

/**
 * Draws the view into `img` and returns the rays' findings, so the overlays can tell what hides what. Pure: the same
 * snapshot and pose give the same pixels, and only the plan, the door states, the rooms' conditions and the AI's alerts
 * are read (never `truth`).
 */
export function renderScene(img: Surface, site: Site, snap: SceneState, pose: Pose): Column[] {
  const W = img.width
  const H = img.height
  const px = img.data
  const { cond, alert } = sceneRooms(snap)
  const focal = W / 2 / Math.tan(FOV_RAD / 2)
  const horizon = Math.round(H * HORIZON)
  const columns: Column[] = []
  const haze: Haze = { i: 0, tau: 0, rank: 0 }
  // Scratch result of `shade`, so that no pixel allocates.
  const out = [0, 0, 0]

  /** Colour of a surface after light falloff, its room's cast and the haze, left in `out`. */
  const shade = (r0: number, g0: number, b0: number, rawM: number, tau: number, rank: number, side: number, room: number, emissive: boolean): void => {
    let light = emissive ? 1 : 1 / (1 + 0.045 * rawM)
    if (side === 1 && !emissive) light *= 0.8
    let r = r0
    let g = g0
    let b = b0
    if (room >= 0 && !emissive) {
      const cast = CAST_RGB[cond[room]]
      if (cast[3] > 0) {
        r = mix(r, cast[0], cast[3])
        g = mix(g, cast[1], cast[3])
        b = mix(b, cast[2], cast[3])
      }
      if (alert[room]) {
        r = mix(r, ALERT_RGB[0], ALERT_RGB[3])
        g = mix(g, ALERT_RGB[1], ALERT_RGB[3])
        b = mix(b, ALERT_RGB[2], ALERT_RGB[3])
      }
    }
    const f = Math.exp(-tau)
    const fog = FOG_RGB[Math.min(rank, FOG_RGB.length - 1)]
    out[0] = r * light * f + fog[0] * (1 - f)
    out[1] = g * light * f + fog[1] * (1 - f)
    out[2] = b * light * f + fog[2] * (1 - f)
  }
  const put = (x: number, y: number) => {
    const o = (y * W + x) * 4
    px[o] = out[0]
    px[o + 1] = out[1]
    px[o + 2] = out[2]
    px[o + 3] = 255
  }

  for (let x = 0; x < W; x++) {
    const ray = rayOf(pose, (2 * (x + 0.5)) / W - 1)
    const col = castColumn(site, snap.doorOpen, cond, pose, ray)
    columns.push(col)

    // Ceiling, top to horizon: the distance to it grows as the rows rise towards the horizon. A ray that leaves the
    // building sees the sky instead.
    haze.i = 0
    const openSky = col.outside && col.blockM === Infinity
    for (let y = 0; y < horizon; y++) {
      if (openSky) {
        const k = y / horizon
        out[0] = SKY_TOP_RGB[0] + (SKY_HORIZON_RGB[0] - SKY_TOP_RGB[0]) * k
        out[1] = SKY_TOP_RGB[1] + (SKY_HORIZON_RGB[1] - SKY_TOP_RGB[1]) * k
        out[2] = SKY_TOP_RGB[2] + (SKY_HORIZON_RGB[2] - SKY_TOP_RGB[2]) * k
        put(x, y)
        continue
      }
      const rowPerp = ((CEILING_M - EYE_M) * focal) / (horizon - y - 0.5)
      hazeAt(col.segs, haze, rowPerp * ray.len)
      shade(CEILING_RGB[0], CEILING_RGB[1], CEILING_RGB[2], rowPerp * ray.len, haze.tau, haze.rank, 0, -1, false)
      put(x, y)
    }

    // Floor, bottom to horizon, as far as the first wall.
    haze.i = 0
    const reach = col.blockM
    for (let y = H - 1; y >= horizon; y--) {
      const rowPerp = (EYE_M * focal) / (y + 0.5 - horizon)
      if (rowPerp > reach) break
      const wx = pose.x + ray.x * rowPerp
      const wy = pose.y + ray.y * rowPerp
      const cx = Math.floor(wx / site.cellM)
      const cy = Math.floor(wy / site.cellM)
      const cell = cx >= 0 && cy >= 0 && cx < site.width && cy < site.height ? cy * site.width + cx : -1
      const kind = cell >= 0 ? site.kind[cell] : CELL.OUTSIDE
      const room = cell >= 0 ? site.room[cell] : -1
      let base: readonly number[]
      let emissive = false
      if (kind === CELL.OUTSIDE) {
        base = DAYLIGHT_RGB
        emissive = true
      } else if (kind === CELL.EXIT) {
        base = EXIT_RGB
        emissive = true
      } else if (kind === CELL.DOOR) base = site.door[cell] >= 0 && snap.doorOpen[site.door[cell]] ? FRAME_RGB : DOOR_RGB
      else base = (Math.floor(wx) + Math.floor(wy)) & 1 ? TILE_LIGHT_RGB : TILE_DARK_RGB // one-metre tiles: walking shows as motion
      hazeAt(col.segs, haze, rowPerp * ray.len)
      shade(base[0], base[1], base[2], rowPerp * ray.len, haze.tau, haze.rank, 0, room, emissive)
      put(x, y)
    }

    // Surfaces, far to near, over the floor and ceiling.
    for (let h = col.hits.length - 1; h >= 0; h--) {
      const hit = col.hits[h]
      const span = (fromM: number, toM: number, rgb: readonly number[], emissive = false) => {
        const y0 = Math.max(0, Math.round(horizon - ((toM - EYE_M) / hit.perpM) * focal))
        const y1 = Math.min(H - 1, Math.round(horizon - ((fromM - EYE_M) / hit.perpM) * focal) - 1)
        if (y1 < y0) return
        const panelLine = !emissive && hit.kind !== 'door' && hit.kind !== 'exit' && ((hit.along % 2) + 2) % 2 < 0.06
        const k = panelLine ? 0.8 : 1
        shade(rgb[0] * k, rgb[1] * k, rgb[2] * k, hit.rawM, hit.tau, hit.rank, hit.side, hit.room, emissive)
        for (let y = y0; y <= y1; y++) put(x, y)
      }
      if (hit.kind === 'wall') span(hit.baseM, hit.topM, WALL_RGB)
      else if (hit.kind === 'obstacle') span(hit.baseM, hit.topM, OBSTACLE_RGB)
      else if (hit.kind === 'lintel') span(hit.baseM, hit.topM, FRAME_RGB)
      else if (hit.kind === 'door') {
        span(0, hit.doorM, DOOR_RGB)
        span(hit.doorM, hit.topM, WALL_RGB)
      } else {
        span(0, hit.doorM, EXIT_RGB, true)
        span(hit.doorM, hit.topM, WALL_RGB)
      }
    }
  }
  return columns
}

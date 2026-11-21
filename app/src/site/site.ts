// The site plan (data/site/atelier.json, MODELED) rasterised to the grid every engine runs on: walls, doors, exits,
// rooms, equipment, detectors and objectives. Building coordinates in the JSON are shifted by the outdoor margin.

import siteJson from '../../../data/site/atelier.json' with { type: 'json' }
import { CELL, type DataStatus, type Point } from '../types.ts'

type Rect = [number, number, number, number]
export type WallMaterial = 'gypsum' | 'concrete'
export type Growth = 'slow' | 'medium' | 'fast' | 'ultraFast'

export interface SiteRoom {
  index: number
  id: string
  name: string
  heightM: number
  walls: WallMaterial
  /** small enough for the flashover model (NIST training domain); the hall only gets smoke and temperature */
  flashoverModel: boolean
  hazards: string[]
  growth: Growth
  floorM2: number
  /** enclosing surface area (walls, floor, ceiling), m² */
  surfaceM2: number
  cells: number[]
  centre: Point
}

export interface SiteDoor {
  index: number
  id: string
  name: string
  cells: number[]
  widthM: number
  heightM: number
  initiallyOpen: boolean
  rating: string | null
  /** the two sides; -1 = outside */
  rooms: [number, number]
  isExit: boolean
  centre: Point
}

export interface SitePoint {
  id: string
  name: string
  cell: number
  room: number
  at: Point
}

export interface Site {
  name: string
  status: DataStatus
  location: { lat: number; lon: number }
  cellM: number
  marginM: number
  width: number
  height: number
  /** CELL code per cell */
  kind: Uint8Array
  /** room index per floor/obstacle cell; -1 for walls, doors and outside */
  room: Int8Array
  /** door index per door/exit cell; -1 elsewhere */
  door: Int16Array
  rooms: SiteRoom[]
  doors: SiteDoor[]
  exits: number[]
  detectors: SitePoint[]
  objectives: (SitePoint & { kind: string })[]
  obstacles: { id: string; name: string; rect: Rect; hazards: string[] }[]
  engine: SitePoint
  demo: { fireRoom: number; fireAt: Point; entry: number; objectives: string[] }
}

type SiteJson = typeof siteJson

export function buildSite(json: SiteJson = siteJson): Site {
  const { widthM, depthM, marginM, cellM } = json.building
  const width = Math.round((widthM + 2 * marginM) / cellM)
  const height = Math.round((depthM + 2 * marginM) / cellM)
  const kind = new Uint8Array(width * height).fill(CELL.OUTSIDE)
  const room = new Int8Array(width * height).fill(-1)
  const door = new Int16Array(width * height).fill(-1)
  const toCells = (r: Rect) => ({
    c0: Math.round((r[0] + marginM) / cellM),
    r0: Math.round((r[1] + marginM) / cellM),
    c1: Math.round((r[2] + marginM) / cellM),
    r1: Math.round((r[3] + marginM) / cellM),
  })
  const paint = (r: Rect, fn: (cell: number, border: boolean) => void) => {
    const { c0, r0, c1, r1 } = toCells(r)
    for (let row = r0; row < r1; row++)
      for (let col = c0; col < c1; col++) fn(row * width + col, row === r0 || row === r1 - 1 || col === c0 || col === c1 - 1)
  }

  const hallIndex = json.rooms.findIndex((r) => r.rect === null)
  if (hallIndex < 0) throw new Error('site: one room must have rect null (the hall)')
  paint([0, 0, widthM, depthM], (cell, border) => {
    kind[cell] = border ? CELL.WALL : CELL.FLOOR
    room[cell] = border ? -1 : hallIndex
  })
  json.rooms.forEach((r, i) => {
    if (!r.rect) return
    paint(r.rect as Rect, (cell, border) => {
      kind[cell] = border ? CELL.WALL : CELL.FLOOR
      room[cell] = border ? -1 : i
    })
  })
  for (const o of json.obstacles) paint(o.rect as Rect, (cell) => (kind[cell] = CELL.OBSTACLE))

  const openings = [...json.doors.map((d) => ({ ...d, isExit: false, open: d.open, rating: d.rating })), ...json.exits.map((e) => ({ ...e, isExit: true, open: true, rating: null }))]
  const doors: SiteDoor[] = openings.map((d, i) => {
    const cells: number[] = []
    paint(d.rect as Rect, (cell) => {
      kind[cell] = d.isExit ? CELL.EXIT : CELL.DOOR
      room[cell] = -1
      door[cell] = i
      cells.push(cell)
    })
    const [x0, y0, x1, y1] = d.rect as Rect
    return {
      index: i,
      id: d.id,
      name: d.name,
      cells,
      widthM: Math.max(x1 - x0, y1 - y0),
      heightM: d.heightM,
      initiallyOpen: d.open,
      rating: d.rating,
      rooms: [-1, -1],
      isExit: d.isExit,
      centre: { x: (x0 + x1) / 2 + marginM, y: (y0 + y1) / 2 + marginM },
    }
  })
  // The two sides of each door: the rooms (or outside) its cells touch.
  for (const d of doors) {
    const sides = new Set<number>()
    for (const cell of d.cells) {
      const r = (cell / width) | 0
      const c = cell - r * width
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = (r + dr) * width + (c + dc)
        if (kind[n] === CELL.OUTSIDE) sides.add(-1)
        else if (room[n] >= 0) sides.add(room[n])
      }
    }
    if (sides.size !== 2) throw new Error(`site: door ${d.id} must join exactly two sides, found ${[...sides].join(', ')}`)
    d.rooms = [...sides].sort((a, b) => b - a) as [number, number]
  }

  const cellsOf = (i: number) => {
    const out: number[] = []
    for (let k = 0; k < room.length; k++) if (room[k] === i) out.push(k)
    return out
  }
  const builtArea = json.rooms.reduce((s, r) => (r.rect ? s + (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]) : s), 0)
  const rooms: SiteRoom[] = json.rooms.map((r, i) => {
    const [x0, y0, x1, y1] = (r.rect ?? [0, 0, widthM, depthM]) as Rect
    const w = x1 - x0
    const d = y1 - y0
    const floorM2 = r.rect ? w * d : widthM * depthM - builtArea
    return {
      index: i,
      id: r.id,
      name: r.name,
      heightM: r.heightM,
      walls: r.walls as WallMaterial,
      flashoverModel: r.flashoverModel,
      hazards: r.hazards,
      growth: r.growth as Growth,
      floorM2,
      surfaceM2: 2 * floorM2 + 2 * (w + d) * r.heightM,
      cells: cellsOf(i),
      centre: { x: (x0 + x1) / 2 + marginM, y: (y0 + y1) / 2 + marginM },
    }
  })

  const cellAtM = (p: number[]) => Math.floor((p[1] + marginM) / cellM) * width + Math.floor((p[0] + marginM) / cellM)
  const point = (id: string, name: string, at: number[], mustBeInside: boolean): SitePoint => {
    const cell = cellAtM(at)
    if (mustBeInside && room[cell] < 0) throw new Error(`site: ${id} is not inside a room`)
    return { id, name, cell, room: room[cell], at: { x: at[0] + marginM, y: at[1] + marginM } }
  }
  const byId = (id: string) => {
    const i = json.rooms.findIndex((r) => r.id === id)
    if (i < 0) throw new Error(`site: unknown room ${id}`)
    return i
  }
  const entry = doors.findIndex((d) => d.id === json.demo.entry)
  if (entry < 0) throw new Error(`site: unknown entry ${json.demo.entry}`)

  return {
    name: json.name,
    status: json.status as DataStatus,
    location: { lat: json.location.lat, lon: json.location.lon },
    cellM,
    marginM,
    width,
    height,
    kind,
    room,
    door,
    rooms,
    doors,
    exits: doors.filter((d) => d.isExit).map((d) => d.index),
    detectors: json.detectors.map((d) => point(d.id, d.id, d.at, true)),
    objectives: json.objectives.map((o) => ({ ...point(o.id, o.name, o.at, true), kind: o.kind })),
    obstacles: json.obstacles.map((o) => ({ id: o.id, name: o.name, rect: o.rect as Rect, hazards: o.hazards })),
    engine: point('engine', json.engine.name, json.engine.at, false),
    demo: {
      fireRoom: byId(json.demo.fireRoom),
      fireAt: { x: json.demo.fireAt[0] + marginM, y: json.demo.fireAt[1] + marginM },
      entry,
      objectives: json.demo.objectives,
    },
  }
}

/** Cell containing a point (site metres), or -1 outside the grid. */
export function cellAt(site: Pick<Site, 'width' | 'height' | 'cellM'>, p: Point): number {
  const c = Math.floor(p.x / site.cellM)
  const r = Math.floor(p.y / site.cellM)
  if (c < 0 || r < 0 || c >= site.width || r >= site.height) return -1
  return r * site.width + c
}

/** Centre of a cell, site metres. */
export function cellCentre(site: Pick<Site, 'width' | 'cellM'>, cell: number): Point {
  const r = (cell / site.width) | 0
  const c = cell - r * site.width
  return { x: (c + 0.5) * site.cellM, y: (r + 0.5) * site.cellM }
}

/** Room indices that share a door with room i (any door state). */
export function neighbours(site: Site, i: number): number[] {
  const out = new Set<number>()
  for (const d of site.doors) {
    if (d.rooms[0] === i && d.rooms[1] >= 0) out.add(d.rooms[1])
    if (d.rooms[1] === i && d.rooms[0] >= 0) out.add(d.rooms[0])
  }
  return [...out]
}

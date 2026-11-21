// The tablet's live map: the plan, following the team as it moves (cap en haut, or nord en haut), zoomable, or the whole
// site at once. Rooms are tinted from what their detectors say, the AI's alerts are outlined, the route is drawn ahead
// of the team and greyed behind it, the doors show open or closed. Vector drawing, so it stays sharp at any zoom, with
// labels that stay upright when the map turns. Display only: it never reads the simulator's truth (R5).

import { useEffect, useRef } from 'react'
import type { RoomCondition } from '../danger/rules'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { cellCentre } from '../site/site'
import { CELL } from '../types'
import { angleDiff, approach, routePose, type Pose } from './camera'
import { placeOf } from './Scene'

export type MapView = 'heading' | 'north' | 'fit'

/** Width of the map, in metres, at each zoom step (closest first). */
export const WINDOW_M: readonly number[] = [16, 28, 48]

/** Pixels per metre of the static layer: sharp up to the closest zoom on a large tablet. */
const BASE_PPM = 40
/** Time constants (s) of the glide of the team's position, and of the view (turn, zoom, pan). */
const GLIDE_S = 0.35
const VIEW_S = 0.4
const FRAME_MS = 33
/** Heading-up: the team sits this far down the map, so that more of the way ahead shows. */
const ANCHOR_Y = 0.66
/** Heading-up turns the map to the next quarter turn only once the team's heading is this far (rad) from the current one. */
const TURN_HYSTERESIS = 0.96

const TINT: Record<RoomCondition, string | null> = {
  clear: null,
  smoke: 'rgba(95, 99, 104, 0.28)',
  hot: 'rgba(249, 171, 0, 0.43)',
  failed: 'rgba(217, 48, 37, 0.47)',
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Geo {
  /** walls, machines and exits on a transparent ground, one cell = BASE_PPM × cellM pixels */
  base: HTMLCanvasElement
  /** bounding box of each room, site metres */
  rects: Rect[]
  /** the building, site metres */
  building: Rect
}

const geos = new WeakMap<Site, Geo>()

function geoOf(site: Site): Geo {
  const cached = geos.get(site)
  if (cached) return cached
  const px = site.cellM * BASE_PPM
  const base = document.createElement('canvas')
  base.width = Math.round(site.width * px)
  base.height = Math.round(site.height * px)
  const g = base.getContext('2d')!
  for (let cell = 0; cell < site.kind.length; cell++) {
    const k = site.kind[cell]
    if (k !== CELL.WALL && k !== CELL.OBSTACLE && k !== CELL.EXIT) continue
    g.fillStyle = k === CELL.WALL ? '#202124' : k === CELL.OBSTACLE ? '#9aa0a6' : '#188038'
    const row = Math.floor(cell / site.width)
    g.fillRect((cell - row * site.width) * px, row * px, Math.ceil(px), Math.ceil(px))
  }
  const rects = site.rooms.map((r) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const cell of r.cells) {
      const row = Math.floor(cell / site.width)
      const col = cell - row * site.width
      x0 = Math.min(x0, col * site.cellM)
      y0 = Math.min(y0, row * site.cellM)
      x1 = Math.max(x1, (col + 1) * site.cellM)
      y1 = Math.max(y1, (row + 1) * site.cellM)
    }
    return { x0, y0, x1, y1 }
  })
  const building = { x0: site.marginM, y0: site.marginM, x1: site.width * site.cellM - site.marginM, y1: site.height * site.cellM - site.marginM }
  const geo = { base, rects, building }
  geos.set(site, geo)
  return geo
}

/** Colour of a detector from its reading: amber at ambient up to red at its failure threshold. */
function readingColour(c: number): string {
  if (!Number.isFinite(c)) return '#202124'
  const f = Math.max(0, Math.min(1, (c - 25) / 125))
  return `rgb(${Math.round(249 + (217 - 249) * f)}, ${Math.round(171 + (48 - 171) * f)}, ${Math.round(37 * f)})`
}

interface View {
  cx: number
  cy: number
  rot: number
  scale: number
  ax: number
  ay: number
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, site: Site, s: Snapshot, v: View, team: Pose | null, geo: Geo) {
  const cm = site.cellM
  const { building: b, rects } = geo
  ctx.fillStyle = '#e8eaed'
  ctx.fillRect(0, 0, w, h)

  // World layer: metres, rotated about the anchor.
  ctx.save()
  ctx.translate(v.ax, v.ay)
  ctx.rotate(v.rot)
  ctx.scale(v.scale, v.scale)
  ctx.translate(-v.cx, -v.cy)
  ctx.fillStyle = '#f8f9fa'
  ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
  const hall = site.rooms.findIndex((r) => r.id === 'halle')
  const hallTint = TINT[s.rooms[hall].condition]
  if (hallTint) {
    ctx.fillStyle = hallTint
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
  }
  site.rooms.forEach((_, i) => {
    if (i === hall) return
    const r = rects[i]
    ctx.fillStyle = '#f8f9fa'
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    const tint = TINT[s.rooms[i].condition]
    if (tint) {
      ctx.fillStyle = tint
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    }
  })
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(geo.base, 0, 0, site.width * cm, site.height * cm)

  // Doors: open = blue, closed = grey.
  site.doors.forEach((d, i) => {
    if (d.isExit) return
    ctx.fillStyle = s.doorOpen[i] ? '#1a73e8' : '#5f6368'
    for (const cell of d.cells) {
      const row = Math.floor(cell / site.width)
      ctx.fillRect((cell - row * site.width) * cm, row * cm, cm, cm)
    }
  })

  // Detectors: a dot coloured by its reading, a cross once it has failed.
  site.detectors.forEach((d, i) => {
    const det = s.detectors[i]
    if (det.failed) {
      ctx.strokeStyle = '#202124'
      ctx.lineWidth = 0.14
      ctx.beginPath()
      ctx.moveTo(d.at.x - 0.28, d.at.y - 0.28)
      ctx.lineTo(d.at.x + 0.28, d.at.y + 0.28)
      ctx.moveTo(d.at.x + 0.28, d.at.y - 0.28)
      ctx.lineTo(d.at.x - 0.28, d.at.y + 0.28)
      ctx.stroke()
    } else {
      ctx.fillStyle = readingColour(det.reading)
      ctx.beginPath()
      ctx.arc(d.at.x, d.at.y, 0.3, 0, 2 * Math.PI)
      ctx.fill()
    }
  })

  // The AI's alerts: a dashed red outline round the room.
  ctx.setLineDash([0.5, 0.3])
  ctx.lineWidth = 0.18
  ctx.strokeStyle = '#d93025'
  s.rooms.forEach((rv, i) => {
    if (!rv.pred?.alert) return
    const r = rects[i]
    ctx.strokeRect(r.x0 - 0.12, r.y0 - 0.12, r.x1 - r.x0 + 0.24, r.y1 - r.y0 + 0.24)
  })
  ctx.setLineDash([])

  // The route: grey behind the team, blue ahead, red on the way out of a NO-GO.
  const { track, index, mode } = s.team
  if (track.length > 1 && mode !== 'out') {
    const line = (from: number, to: number, colour: string, width: number) => {
      ctx.beginPath()
      for (let k = from; k <= to; k++) {
        const p = cellCentre(site, track[k])
        if (k === from) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.strokeStyle = colour
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    const at = Math.min(index, track.length - 1)
    line(0, at, '#9aa0a6', 0.3)
    line(at, track.length - 1, mode === 'evacuating' ? '#d93025' : '#1a73e8', 0.45)
  }

  // Objectives and the engine.
  site.objectives.forEach((o) => {
    const active = s.team.objectives.includes(o.id)
    ctx.fillStyle = active ? '#d93025' : s.team.done.includes(o.id) ? '#188038' : '#9aa0a6'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.12
    ctx.beginPath()
    ctx.moveTo(o.at.x, o.at.y - 0.9)
    ctx.lineTo(o.at.x + 0.65, o.at.y)
    ctx.lineTo(o.at.x, o.at.y + 0.9)
    ctx.lineTo(o.at.x - 0.65, o.at.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  })
  ctx.fillStyle = '#d93025'
  ctx.fillRect(site.engine.at.x - 1.4, site.engine.at.y - 0.8, 2.8, 1.6)
  ctx.restore()

  // Screen layer: labels stay upright whatever the map's rotation.
  const cos = Math.cos(v.rot)
  const sin = Math.sin(v.rot)
  const toScreen = (x: number, y: number) => {
    const dx = (x - v.cx) * v.scale
    const dy = (y - v.cy) * v.scale
    return { x: v.ax + dx * cos - dy * sin, y: v.ay + dx * sin + dy * cos }
  }
  const px = Math.round(Math.max(12, Math.min(17, v.scale * 0.8)))
  const text = (t: string, x: number, y: number, colour: string, align: CanvasTextAlign = 'start') => {
    ctx.font = `600 ${px}px Barlow, system-ui, sans-serif`
    ctx.textAlign = align
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.strokeText(t, x, y)
    ctx.fillStyle = colour
    ctx.fillText(t, x, y)
  }
  site.rooms.forEach((room, i) => {
    const r = rects[i]
    const hallRoom = i === hall
    const p = toScreen((r.x0 + r.x1) / 2, hallRoom ? r.y0 + (r.y1 - r.y0) * 0.55 : (r.y0 + r.y1) / 2)
    text(room.short, p.x, p.y, '#3c4043', 'center')
    if (s.rooms[i].pred?.alert) text('⚠ IA', p.x, p.y + px + 2, '#d93025', 'center')
  })
  site.objectives.forEach((o) => {
    const p = toScreen(o.at.x, o.at.y)
    text(placeOf(o.name), p.x + px, p.y + px * 0.35, '#202124')
  })
  const fpt = toScreen(site.engine.at.x, site.engine.at.y)
  text('FPT', fpt.x, fpt.y - px * 0.9, '#8c1d18', 'center')

  // The team: a green disc with a wedge pointing the way it faces.
  if (team) {
    const p = toScreen(team.x, team.y)
    const a = team.heading + v.rot
    ctx.fillStyle = '#188038'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20)
    ctx.lineTo(p.x + Math.cos(a + 2.5) * 12, p.y + Math.sin(a + 2.5) * 12)
    ctx.lineTo(p.x + Math.cos(a - 2.5) * 12, p.y + Math.sin(a - 2.5) * 12)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
  }

  // North, so that the turned map can always be read.
  const north = -Math.PI / 2 + v.rot
  const cx = w - 40
  const cy = 44
  ctx.strokeStyle = '#5f6368'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 24, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#d93025'
  ctx.beginPath()
  ctx.moveTo(cx + Math.cos(north) * 20, cy + Math.sin(north) * 20)
  ctx.lineTo(cx + Math.cos(north + 2.6) * 9, cy + Math.sin(north + 2.6) * 9)
  ctx.lineTo(cx + Math.cos(north - 2.6) * 9, cy + Math.sin(north - 2.6) * 9)
  ctx.closePath()
  ctx.fill()
  ctx.font = '700 13px Barlow, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#202124'
  ctx.fillText('N', cx + Math.cos(north) * 33, cy + Math.sin(north) * 33 + 5)
  ctx.textAlign = 'start'
}

export function LiveMap({ site, snap, view, zoom }: { site: Site; snap: Snapshot; view: MapView; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const props = useRef({ snap, view, zoom })
  useEffect(() => {
    props.current = { snap, view, zoom }
  }, [snap, view, zoom])

  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const geo = geoOf(site)
    const centre = { x: (geo.building.x0 + geo.building.x1) / 2, y: (geo.building.y0 + geo.building.y1) / 2 }
    let pose: Pose | null = null
    let v: View | null = null
    /** The map's orientation in heading-up mode: the nearest quarter turn, so that the walls stay level. */
    let quarter: number | null = null
    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < FRAME_MS) return
      const dt = (now - last) / 1000
      last = now
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (w < 40 || h < 40) return
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const p = props.current
      const target = routePose(site, p.snap, pose)
      pose = target ? (pose ? approach(pose, target, dt, GLIDE_S) : target) : pose
      if (pose && (quarter === null || Math.abs(angleDiff(pose.heading, quarter)) > TURN_HYSTERESIS)) quarter = Math.round(pose.heading / (Math.PI / 2)) * (Math.PI / 2)
      const fit = p.view === 'fit' || !pose
      const wantScale = fit ? Math.min(w / (geo.building.x1 - geo.building.x0 + 6), h / (geo.building.y1 - geo.building.y0 + 6)) : w / WINDOW_M[Math.min(WINDOW_M.length - 1, Math.max(0, p.zoom))]
      const want: View = {
        cx: fit || !pose ? centre.x : pose.x,
        cy: fit || !pose ? centre.y : pose.y,
        rot: !fit && p.view === 'heading' && quarter !== null ? -Math.PI / 2 - quarter : 0,
        scale: wantScale,
        ax: w / 2,
        ay: !fit && p.view === 'heading' ? h * ANCHOR_Y : h / 2,
      }
      if (!v) v = want
      else {
        const k = 1 - Math.exp(-dt / VIEW_S)
        v = {
          cx: v.cx + (want.cx - v.cx) * k,
          cy: v.cy + (want.cy - v.cy) * k,
          rot: v.rot + angleDiff(want.rot, v.rot) * k,
          scale: v.scale + (want.scale - v.scale) * k,
          ax: want.ax,
          ay: v.ay + (want.ay - v.ay) * k,
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, w, h, site, p.snap, v, pose, geo)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [site])

  return <canvas ref={canvas} className="tablet2-canvas" aria-label="Carte en direct : le binôme, son itinéraire, les locaux teintés d’après les détecteurs" />
}

// The site plan on a canvas: rooms tinted by what their detectors say, the model's alerts, detectors, doors, the
// team's route and position, objectives and the engine. The « vérité simulateur » layer (off by default) shows the
// fire's truth, labelled SIMULATED; it never feeds the verdict (R5).

import { useEffect, useMemo, useRef } from 'react'
import type { RoomCondition } from '../danger/rules'
import type { Snapshot } from '../sim/protocol'
import { cellCentre, type Site } from '../site/site'
import { CELL, type Point } from '../types'

export const PX = 6

export const KIND_RGB: Record<number, [number, number, number]> = {
  [CELL.FLOOR]: [248, 249, 250],
  [CELL.OUTSIDE]: [218, 220, 224],
  [CELL.OBSTACLE]: [154, 160, 166],
  [CELL.WALL]: [32, 33, 36],
  [CELL.DOOR]: [248, 249, 250],
  [CELL.EXIT]: [24, 128, 56],
}

const CONDITION_RGBA: Record<RoomCondition, [number, number, number, number] | null> = {
  clear: null,
  smoke: [95, 99, 104, 70],
  hot: [249, 171, 0, 110],
  failed: [217, 48, 37, 120],
}

export interface PlanProps {
  site: Site
  snap: Snapshot
  truth: boolean
  mode: 'doors' | 'fire' | 'view'
  onDoor: (door: number) => void
  onFire: (at: Point) => void
  /** the drone layer and its thermal image: PC only (R5) */
  showDrone?: boolean
}

export function roomBoxes(site: Site) {
  return site.rooms.map((r) => {
    let c0 = Infinity
    let r0 = Infinity
    let c1 = -Infinity
    let r1 = -Infinity
    for (const cell of r.cells) {
      const row = (cell / site.width) | 0
      const col = cell - row * site.width
      c0 = Math.min(c0, col)
      r0 = Math.min(r0, row)
      c1 = Math.max(c1, col)
      r1 = Math.max(r1, row)
    }
    return { x: c0 * PX, y: r0 * PX, w: (c1 - c0 + 1) * PX, h: (r1 - r0 + 1) * PX }
  })
}

function readingColour(c: number): string {
  if (!Number.isFinite(c)) return '#202124'
  const f = Math.max(0, Math.min(1, (c - 25) / 125))
  return `rgb(${Math.round(249 + (217 - 249) * f)}, ${Math.round(171 + (48 - 171) * f)}, ${Math.round(0 + 37 * f)})`
}

export function Plan({ site, snap, truth, mode, onDoor, onFire, showDrone = false }: PlanProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const boxes = useMemo(() => roomBoxes(site), [site])
  const base = useMemo(() => {
    const img = new ImageData(site.width, site.height)
    for (let i = 0; i < site.kind.length; i++) {
      const [r, g, b] = KIND_RGB[site.kind[i]]
      img.data.set([r, g, b, 255], 4 * i)
    }
    return img
  }, [site])

  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    // Base and the rooms' conditions, at one pixel per cell, then scaled up crisp.
    const img = new ImageData(new Uint8ClampedArray(base.data), site.width, site.height)
    site.rooms.forEach((room, r) => {
      const tint = CONDITION_RGBA[snap.rooms[r].condition]
      if (!tint) return
      const a = tint[3] / 255
      for (const cell of room.cells) {
        if (site.kind[cell] !== CELL.FLOOR) continue
        const o = 4 * cell
        for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(img.data[o + k] * (1 - a) + tint[k] * a)
      }
    })
    const off = new OffscreenCanvas(site.width, site.height)
    off.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(off, 0, 0, site.width * PX, site.height * PX)

    // Doors: open = blue, closed = dark bar.
    site.doors.forEach((d, i) => {
      if (d.isExit) return
      ctx.fillStyle = snap.doorOpen[i] ? '#1a73e8' : '#5f6368'
      for (const cell of d.cells) {
        const row = (cell / site.width) | 0
        const col = cell - row * site.width
        ctx.fillRect(col * PX, row * PX, PX, PX)
      }
    })

    const at = (p: Point) => ({ x: (p.x / site.cellM) * PX, y: (p.y / site.cellM) * PX })
    const centre = (cell: number) => at(cellCentre(site, cell))

    // Room names.
    ctx.font = '600 12px Barlow, system-ui, sans-serif'
    ctx.fillStyle = '#3c4043'
    site.rooms.forEach((room, r) => {
      const b = boxes[r]
      if (room.id === 'halle') ctx.fillText(room.short, b.x + 240, b.y + 300)
      else ctx.fillText(room.short, b.x + 6, b.y + 16)
    })

    // Model alerts: dashed red outline and the horizon.
    snap.rooms.forEach((rv, r) => {
      if (!rv.pred?.alert) return
      const b = boxes[r]
      ctx.save()
      ctx.strokeStyle = '#d93025'
      ctx.lineWidth = 3
      ctx.setLineDash([8, 5])
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4)
      ctx.restore()
      ctx.fillStyle = '#d93025'
      ctx.fillText(`IA < ${rv.pred.horizonS} s`, b.x + 6, b.y + 32)
    })

    // Truth layer (SIMULATED): fire seats, hot-layer temperature, flashovers.
    if (truth) {
      ctx.font = '500 11px Barlow, system-ui, sans-serif'
      snap.rooms.forEach((rv, r) => {
        if (rv.truth.ignitedAt === null) return
        const b = boxes[r]
        ctx.fillStyle = rv.truth.flashedAt !== null ? 'rgba(217, 48, 37, 0.25)' : 'rgba(249, 171, 0, 0.15)'
        ctx.fillRect(b.x, b.y, b.w, b.h)
        ctx.fillStyle = '#8c1d18'
        const lead = rv.truth.flashedAt !== null && rv.firstAlertAt !== null ? ` · alerte IA ${rv.truth.flashedAt - rv.firstAlertAt} s avant` : ''
        ctx.fillText(`[SIMULATED] ${Math.round(rv.truth.layerC)} °C${rv.truth.flashedAt !== null ? ` · embrasé à ${rv.truth.flashedAt} s${lead}` : ''}`, b.x + 6, b.y + 50)
      })
    }

    // Route: walked grey, ahead blue.
    const tr = snap.team.track
    if (tr.length > 1 && snap.team.mode !== 'out') {
      const line = (from: number, to: number, colour: string, width: number) => {
        ctx.beginPath()
        for (let k = from; k <= to; k++) {
          const p = centre(tr[k])
          if (k === from) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.strokeStyle = colour
        ctx.lineWidth = width
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
      line(0, Math.min(snap.team.index, tr.length - 1), '#9aa0a6', 3)
      line(Math.min(snap.team.index, tr.length - 1), tr.length - 1, snap.team.mode === 'evacuating' ? '#d93025' : '#1a73e8', 4)
    }

    // Drone (PC only): no-fly cone over the plume, flight path, the drone, and the roofs its thermal camera has seen.
    const dr = snap.drone
    if (showDrone && dr.plume) {
      const pl = dr.plume
      const src = at(pl.source)
      const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180 // bearing (clockwise from north) → canvas angle
      const len = (pl.lengthM / site.cellM) * PX
      ctx.save()
      ctx.fillStyle = 'rgba(60, 64, 67, 0.18)'
      ctx.strokeStyle = 'rgba(60, 64, 67, 0.6)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.arc(src.x, src.y, len, toRad(pl.towardDeg - pl.halfAngleDeg), toRad(pl.towardDeg + pl.halfAngleDeg))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(src.x, src.y, (pl.coreM / site.cellM) * PX, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
      // Label at the far end of the cone, away from the rooms' own labels.
      const far = { x: src.x + len * 0.75 * Math.sin((pl.towardDeg * Math.PI) / 180), y: src.y - len * 0.75 * Math.cos((pl.towardDeg * Math.PI) / 180) }
      ctx.fillStyle = '#3c4043'
      ctx.font = '600 12px Barlow, system-ui, sans-serif'
      ctx.fillText('Zone interdite drone (panache)', Math.min(far.x, ctx.canvas.width - 200), Math.max(14, far.y))
    }
    if (showDrone && dr.path.length > 1) {
      ctx.save()
      ctx.strokeStyle = '#a142f4'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      dr.path.forEach((p, i) => {
        const q = at(p)
        if (i === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      })
      ctx.stroke()
      ctx.restore()
    }
    if (showDrone) {
      // Rooms the thermal camera has seen: a violet corner mark; the temperatures are listed in the drone card.
      snap.drone.roofC.forEach((c, r) => {
        if (c === null) return
        const b = boxes[r]
        ctx.fillStyle = 'rgba(161, 66, 244, 0.9)'
        ctx.fillRect(b.x + b.w - 12, b.y + 4, 8, 8)
      })
      if (dr.at && dr.status === 'flying') {
        const q = at(dr.at)
        ctx.fillStyle = '#a142f4'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(q.x, q.y - 9)
        ctx.lineTo(q.x + 9, q.y)
        ctx.lineTo(q.x, q.y + 9)
        ctx.lineTo(q.x - 9, q.y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }

    // Detectors.
    site.detectors.forEach((d, i) => {
      const p = at(d.at)
      const det = snap.detectors[i]
      if (det.failed) {
        ctx.strokeStyle = '#202124'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(p.x - 4, p.y - 4)
        ctx.lineTo(p.x + 4, p.y + 4)
        ctx.moveTo(p.x + 4, p.y - 4)
        ctx.lineTo(p.x - 4, p.y + 4)
        ctx.stroke()
      } else {
        ctx.fillStyle = readingColour(det.reading)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI)
        ctx.fill()
      }
    })

    // Objectives, engine, team.
    site.objectives.forEach((o) => {
      const p = at(o.at)
      const active = snap.team.objectives.includes(o.id)
      ctx.fillStyle = active ? '#d93025' : snap.team.done.includes(o.id) ? '#188038' : '#9aa0a6'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y - 7)
      ctx.lineTo(p.x + 7, p.y)
      ctx.lineTo(p.x, p.y + 7)
      ctx.lineTo(p.x - 7, p.y)
      ctx.fill()
    })
    const e = at(site.engine.at)
    ctx.fillStyle = '#d93025'
    ctx.fillRect(e.x - 14, e.y - 8, 28, 16)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 10px Barlow, system-ui, sans-serif'
    ctx.fillText('FPT', e.x - 9, e.y + 4)
    if (snap.team.cell >= 0 && snap.team.mode !== 'standby' && snap.team.mode !== 'out') {
      const p = centre(snap.team.cell)
      ctx.fillStyle = '#188038'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
  }, [site, snap, truth, base, boxes, showDrone])

  function click(ev: React.MouseEvent<HTMLCanvasElement>) {
    const cv = canvas.current!
    const rect = cv.getBoundingClientRect()
    const x = ((ev.clientX - rect.left) / rect.width) * cv.width
    const y = ((ev.clientY - rect.top) / rect.height) * cv.height
    const p = { x: (x / PX) * site.cellM, y: (y / PX) * site.cellM }
    if (mode === 'view') return
    if (mode === 'fire') return onFire(p)
    // The nearest door within 1.5 m of the click.
    let best = -1
    let bestD = 1.5
    site.doors.forEach((d, i) => {
      if (d.isExit) return
      const dist = Math.hypot(d.centre.x - p.x, d.centre.y - p.y)
      if (dist < bestD) {
        bestD = dist
        best = i
      }
    })
    if (best >= 0) onDoor(best)
  }

  return <canvas ref={canvas} className={`plan is-${mode}`} width={site.width * PX} height={site.height * PX} onClick={click} aria-label="Plan du site" />
}

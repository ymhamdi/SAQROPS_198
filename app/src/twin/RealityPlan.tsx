// The simulated world as it really is: each room's hot layer (temperature) and smoke layer (how far it has come down),
// the fire's seat and size, flashovers, the real position of the team and the drone. SIMULATED truth, for comparison
// with the twin only: it never feeds the verdict (R5). Same plan, same scale as the twin's plan, side by side.

import { useEffect, useMemo, useRef } from 'react'
import { H, v } from '../config'
import { KIND_RGB, PX, roomBoxes } from '../panels/Plan'
import type { Snapshot } from '../sim/protocol'
import { cellCentre, type Site } from '../site/site'
import { CELL, type Point } from '../types'

/** Rooms narrower than this (canvas px) get their status text outside them instead of inside. */
const NARROW_ROOM_PX = 140
/** Line height of a status line, and the height of one room's block of lines, canvas px. */
const LINE_PX = 13
const NARROW_BLOCK_PX = 30

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const clock = (s: number) => `T+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function RealityPlan({ site, snap }: { site: Site; snap: Snapshot }) {
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
    const ambient = v(H.fire.ambientC)
    const hottest = v(H.fire.postFlashoverC)
    const at = (p: Point) => ({ x: (p.x / site.cellM) * PX, y: (p.y / site.cellM) * PX })
    const centre = (cell: number) => at(cellCentre(site, cell))

    // Floor, then each room tinted by its smoke layer (grey) and its hot-layer temperature (orange to red).
    const img = new ImageData(new Uint8ClampedArray(base.data), site.width, site.height)
    site.rooms.forEach((room, r) => {
      const tr = snap.rooms[r].truth
      const smoke = clamp01((room.heightM - tr.layerZ) / room.heightM) * 0.6
      const heat = clamp01((tr.layerC - ambient) / (hottest - ambient)) * 0.75
      if (smoke <= 0 && heat <= 0) return
      for (const cell of room.cells) {
        if (site.kind[cell] !== CELL.FLOOR) continue
        const o = 4 * cell
        for (let k = 0; k < 3; k++) {
          let c = img.data[o + k]
          c = c * (1 - smoke) + [78, 80, 84][k] * smoke
          c = c * (1 - heat) + [244, 96, 24][k] * heat
          img.data[o + k] = Math.round(c)
        }
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

    // Room names, and for a room on fire its real hot-layer temperature (SIMULATED). A narrow room has no space for the
    // status lines inside: they go just below it, on a white halo.
    const halo = (text: string, x: number, y: number) => {
      ctx.lineWidth = 3
      ctx.strokeStyle = '#ffffff'
      ctx.strokeText(text, x, y)
      ctx.fillText(text, x, y)
    }
    ctx.font = '600 12px Barlow, system-ui, sans-serif'
    const stacked = { above: 0, below: 0 }
    site.rooms.forEach((room, r) => {
      const b = boxes[r]
      const x = room.id === 'halle' ? b.x + 240 : b.x + 6
      const y = room.id === 'halle' ? b.y + 300 : b.y + 16
      ctx.fillStyle = '#202124'
      ctx.fillText(room.short, x, y)
      const tr = snap.rooms[r].truth
      if (tr.ignitedAt === null) return
      const lines = [`[SIMULATED] ${Math.round(tr.layerC)} °C`, ...(tr.flashedAt !== null ? [`EMBRASÉ ${clock(tr.flashedAt)}`] : [])]
      // A narrow room has no space inside: its lines go just outside it (towards the middle of the plan), one block per room.
      let lx = x
      let ly = y + 15
      if (b.w < NARROW_ROOM_PX) {
        const above = b.y > (site.height * PX) / 2
        const k = above ? stacked.above++ : stacked.below++
        lx = b.x
        ly = above ? b.y - 8 - k * NARROW_BLOCK_PX - (lines.length - 1) * LINE_PX : b.y + b.h + 14 + k * NARROW_BLOCK_PX
      }
      ctx.font = '600 11px Barlow, system-ui, sans-serif'
      ctx.fillStyle = '#8c1d18'
      lines.forEach((text, i) => halo(text, lx, ly + i * LINE_PX))
      ctx.font = '600 12px Barlow, system-ui, sans-serif'
    })

    // Flashed rooms: a heavy dashed outline.
    snap.rooms.forEach((rv, r) => {
      if (rv.truth.flashedAt === null) return
      const b = boxes[r]
      ctx.save()
      ctx.strokeStyle = '#8c1d18'
      ctx.lineWidth = 3
      ctx.setLineDash([3, 3])
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4)
      ctx.restore()
    })

    // The fire: a glow and a flame whose size follows the heat release.
    snap.rooms.forEach((rv, r) => {
      const tr = rv.truth
      if (tr.ignitedAt === null) return
      const p = at(tr.fireAt ?? site.rooms[r].centre)
      const size = 5 + 4 * Math.log10(1 + tr.qKw / 50)
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.4)
      glow.addColorStop(0, 'rgba(255, 140, 0, 0.55)')
      glow.addColorStop(1, 'rgba(255, 140, 0, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(p.x, p.y, size * 2.4, 0, 2 * Math.PI)
      ctx.fill()
      const flame = (s: number, colour: string) => {
        ctx.fillStyle = colour
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - s * 1.5)
        ctx.bezierCurveTo(p.x + s * 1.1, p.y - s * 0.5, p.x + s * 0.9, p.y + s * 0.9, p.x, p.y + s)
        ctx.bezierCurveTo(p.x - s * 0.9, p.y + s * 0.9, p.x - s * 1.1, p.y - s * 0.5, p.x, p.y - s * 1.5)
        ctx.fill()
      }
      flame(size, '#d93025')
      flame(size * 0.6, '#f9ab00')
    })

    // Detectors as they physically are: working = small dot, burnt out = cross.
    site.detectors.forEach((d, i) => {
      const p = at(d.at)
      if (snap.detectors[i].failed) {
        ctx.strokeStyle = '#202124'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(p.x - 4, p.y - 4)
        ctx.lineTo(p.x + 4, p.y + 4)
        ctx.moveTo(p.x + 4, p.y - 4)
        ctx.lineTo(p.x - 4, p.y + 4)
        ctx.stroke()
      } else {
        ctx.fillStyle = '#5f6368'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI)
        ctx.fill()
      }
    })

    // The engine, the drone and the team, where they really are.
    const e = at(site.engine.at)
    ctx.fillStyle = '#d93025'
    ctx.fillRect(e.x - 14, e.y - 8, 28, 16)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 10px Barlow, system-ui, sans-serif'
    ctx.fillText('FPT', e.x - 9, e.y + 4)
    const dr = snap.drone
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
  }, [site, snap, base, boxes])

  return <canvas ref={canvas} className="plan twin-canvas" width={site.width * PX} height={site.height * PX} aria-label="Plan du site : le monde réel simulé, feu et fumée" />
}

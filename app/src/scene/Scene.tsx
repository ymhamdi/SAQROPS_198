// The visor's background: the synthetic first-person view (scene.ts) following the team along the route, with the
// route's chevrons on the floor, waypoint marks and the AI's alerts on the rooms it flags. It redraws on its own clock
// and glides the camera between the PC's snapshots, so it moves smoothly at any playback speed. Drawn small and
// scaled up with hard pixels: it is a rendering, and must not pass for a camera image (the HUD labels it SIMULATED).
// Display only: nothing here feeds the verdict (R5).

import { useEffect, useRef } from 'react'
import { cellCentre, type Site } from '../site/site'
import { approach, poseTarget, type Pose } from './camera'
import { project, renderScene, type Column, type SceneState } from './render'

/** Screen pixels per pixel of the rendered view. */
const PIXEL = 3
/** Time constant (s) of the camera's glide towards the team's position and heading. */
const GLIDE_S = 0.3
/** Minimum time (ms) between two redraws. */
const FRAME_MS = 33
/** The route is marked on the floor this far ahead (m), one chevron every `CHEVRON_GAP_M`. */
const AHEAD_M = 26
const CHEVRON_GAP_M = 1.6
/** Chevron outline in the route's frame: [forward, sideways] metres. */
const CHEVRON: readonly (readonly [number, number])[] = [
  [0.5, 0],
  [-0.2, 0.55],
  [-0.2, 0.32],
  [0.15, 0],
  [-0.2, -0.32],
  [-0.2, -0.55],
]
/** Height (m) of the waypoint marks above the floor. */
const MARK_HEIGHT_M = 1.9
const ROUTE_RGB = '26, 115, 232'
const EVAC_RGB = '217, 48, 37'

/** The place part of an objective's name: « Victime signalée — cabine de peinture » → « cabine de peinture ». */
export const placeOf = (name: string) => name.split(' — ').at(-1) ?? name

interface Mark {
  x: number
  y: number
  text: string
  colour: string
  /** a diamond (a goal), a sign (an exit) or a warning triangle */
  shape: 'diamond' | 'sign' | 'warning'
}

/** The things the view points out, in site metres: the next objective, the exit the route ends at, the rooms the AI flags. */
export function marksOf(site: Site, s: SceneState): Mark[] {
  const marks: Mark[] = []
  const { track, mode, objectives } = s.team
  const goal = mode === 'engaged' ? site.objectives.find((o) => o.id === objectives[0]) : undefined
  if (goal) marks.push({ x: goal.at.x, y: goal.at.y, text: placeOf(goal.name), colour: '#ff5f52', shape: 'diamond' })
  if (track.length > 1 && (mode === 'evacuating' || (mode === 'engaged' && !goal))) {
    const door = site.doors[site.door[track[track.length - 1]]]
    if (door) marks.push({ x: door.centre.x, y: door.centre.y, text: 'SORTIE', colour: '#4caf50', shape: 'sign' })
  }
  s.rooms.forEach((r, i) => {
    if (r.pred?.alert) marks.push({ x: site.rooms[i].centre.x, y: site.rooms[i].centre.y, text: `IA · ${site.rooms[i].short}`, colour: '#fdd663', shape: 'warning' })
  })
  return marks
}

function drawOverlays(ctx: CanvasRenderingContext2D, w: number, h: number, site: Site, s: SceneState, pose: Pose, cols: readonly Column[]) {
  const hiddenAt = (sx: number, forward: number) => {
    const col = cols[Math.min(cols.length - 1, Math.max(0, Math.floor((sx / w) * cols.length)))]
    return col !== undefined && forward > col.blockM + 0.4
  }

  // The route, as chevrons lying on the floor.
  const { track, index, mode } = s.team
  if (track.length > 1 && mode !== 'out') {
    const rgb = mode === 'evacuating' ? EVAC_RGB : ROUTE_RGB
    let walked = 0
    let next = CHEVRON_GAP_M * 0.5
    for (let k = Math.min(index, track.length - 1); k + 1 < track.length && walked < AHEAD_M; k++) {
      const a = cellCentre(site, track[k])
      const b = cellCentre(site, track[k + 1])
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      if (seg === 0) continue
      while (next <= walked + seg && next < AHEAD_M) {
        const f = (next - walked) / seg
        const cx = a.x + (b.x - a.x) * f
        const cy = a.y + (b.y - a.y) * f
        // Direction a few cells further on, so that the chevrons turn smoothly at a corner.
        const ahead = cellCentre(site, track[Math.min(track.length - 1, k + 4)])
        const dx = ahead.x - cx
        const dy = ahead.y - cy
        const len = Math.hypot(dx, dy)
        next += CHEVRON_GAP_M
        if (len < 0.2) continue
        const ux = dx / len
        const uy = dy / len
        const pts = CHEVRON.map(([fw, sd]) => project(pose, w, h, cx + ux * fw - uy * sd, cy + uy * fw + ux * sd, 0.02))
        if (pts.some((p) => p === null)) continue
        const centre = project(pose, w, h, cx, cy, 0.02)!
        if (hiddenAt(centre.x, centre.forward)) continue
        const alpha = Math.max(0.25, Math.min(0.95, 1.1 - centre.forward / AHEAD_M))
        ctx.beginPath()
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)))
        ctx.closePath()
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.85})`
        ctx.stroke()
      }
      walked += seg
    }
  }

  // Waypoints: a goal, the exit, the rooms the AI flags. Dimmed when a wall hides them.
  ctx.font = '600 20px Barlow, system-ui, sans-serif'
  ctx.textAlign = 'center'
  for (const m of marksOf(site, s)) {
    const p = project(pose, w, h, m.x, m.y, MARK_HEIGHT_M)
    if (!p || p.x < -40 || p.x > w + 40) continue
    const hidden = hiddenAt(p.x, p.forward)
    const size = Math.max(12, Math.min(34, 190 / p.forward))
    ctx.globalAlpha = hidden ? 0.55 : 1
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.fillStyle = m.colour
    ctx.beginPath()
    if (m.shape === 'diamond') {
      ctx.moveTo(p.x, p.y - size)
      ctx.lineTo(p.x + size * 0.7, p.y)
      ctx.lineTo(p.x, p.y + size)
      ctx.lineTo(p.x - size * 0.7, p.y)
    } else if (m.shape === 'warning') {
      ctx.moveTo(p.x, p.y - size)
      ctx.lineTo(p.x + size, p.y + size * 0.8)
      ctx.lineTo(p.x - size, p.y + size * 0.8)
    } else {
      ctx.rect(p.x - size * 1.4, p.y - size * 0.6, size * 2.8, size * 1.2)
    }
    ctx.closePath()
    if (hidden) ctx.stroke()
    else {
      ctx.stroke()
      ctx.fill()
    }
    ctx.strokeText(m.text, p.x, p.y + size + 22)
    ctx.fillStyle = '#f5f5f5'
    ctx.fillText(m.text, p.x, p.y + size + 22)
    ctx.globalAlpha = 1
  }
  ctx.textAlign = 'start'
}

export function Scene({ site, snap, className }: { site: Site; snap: SceneState; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef(snap)
  useEffect(() => {
    latest.current = snap
  }, [snap])

  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const low = document.createElement('canvas')
    const lowCtx = low.getContext('2d')!
    let image: ImageData | null = null
    let pose: Pose | null = null
    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < FRAME_MS) return
      const dt = (now - last) / 1000
      last = now
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (w < 40 || h < 40) return
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      const lw = Math.ceil(w / PIXEL)
      const lh = Math.ceil(h / PIXEL)
      if (!image || image.width !== lw || image.height !== lh) {
        low.width = lw
        low.height = lh
        image = lowCtx.createImageData(lw, lh)
      }
      const s = latest.current
      const target = poseTarget(site, s, pose)
      if (!target) return
      pose = pose ? approach(pose, target, dt, GLIDE_S) : target
      const cols = renderScene(image, site, s, pose)
      lowCtx.putImageData(image, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(low, 0, 0, w, h)
      drawOverlays(ctx, w, h, site, s, pose, cols)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [site])

  return <canvas ref={canvas} className={className} aria-label="Vue synthétique du bâtiment, reconstruite à partir du plan et des détecteurs" />
}

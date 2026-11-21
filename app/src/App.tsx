import { useEffect, useMemo, useRef } from 'react'
import { buildSite, type Site } from './site/site'
import { CELL } from './types'
import { StatusBadge } from './ui/StatusBadge'

const PX = 6 // canvas pixels per cell

const KIND_COLOUR: Record<number, string> = {
  [CELL.FLOOR]: '#f1f3f4',
  [CELL.OUTSIDE]: '#dadce0',
  [CELL.OBSTACLE]: '#9aa0a6',
  [CELL.WALL]: '#202124',
  [CELL.DOOR]: '#1a73e8',
  [CELL.EXIT]: '#188038',
}

function drawPlan(ctx: CanvasRenderingContext2D, site: Site) {
  for (let i = 0; i < site.kind.length; i++) {
    const r = (i / site.width) | 0
    const c = i - r * site.width
    ctx.fillStyle = KIND_COLOUR[site.kind[i]]
    ctx.fillRect(c * PX, r * PX, PX, PX)
  }
  const dot = (x: number, y: number, colour: string, size = 5) => {
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc((x / site.cellM) * PX, (y / site.cellM) * PX, size, 0, 2 * Math.PI)
    ctx.fill()
  }
  for (const d of site.detectors) dot(d.at.x, d.at.y, '#f9ab00', 4)
  for (const o of site.objectives) dot(o.at.x, o.at.y, '#d93025', 6)
  dot(site.engine.at.x, site.engine.at.y, '#d93025', 9)
  ctx.fillStyle = '#202124'
  ctx.font = '12px Barlow, sans-serif'
  for (const room of site.rooms) ctx.fillText(room.name, (room.centre.x / site.cellM) * PX - 40, (room.centre.y / site.cellM) * PX)
}

export default function App() {
  const site = useMemo(() => buildSite(), [])
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawPlan(ctx, site)
  }, [site])
  return (
    <main style={{ padding: 16 }}>
      <h1>
        PNR · Point de Non-Retour <StatusBadge status={site.status} />
      </h1>
      <p>{site.name}</p>
      <canvas ref={canvas} width={site.width * PX} height={site.height * PX} />
    </main>
  )
}

// Top-down mini-map of the rehearsal: the plan of the site, the rooms as the rehearsal projects them at T+t (impassable ones
// red, those the AI flags amber), the passage the drone found blocked, the planned route and where the team is on it.

import { useEffect, useRef } from 'react'
import { KIND_RGB } from '../panels/Plan'
import { cellCentre, type Site } from '../site/site'
import { projectRooms, pointAt, type KnownInput, type RehearsalPlan } from './engine'

/** Pixels per grid cell of the mini-map. */
const S = 3

export function RehearsalMap({ site, input, plan, tS, blocked, className }: { site: Site; input: KnownInput; plan: RehearsalPlan; tS: number; blocked: readonly number[]; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const { condition, alert } = projectRooms(input, plan, tS)
    const rack = new Set(blocked)
    for (let i = 0; i < site.kind.length; i++) {
      let [r, g, b] = KIND_RGB[site.kind[i]]
      const room = site.room[i]
      if (room >= 0 && condition[room] === 'failed') [r, g, b] = [244, 199, 195]
      else if (room >= 0 && alert[room]) [r, g, b] = [253, 231, 168]
      if (rack.has(i)) [r, g, b] = [150, 90, 40]
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect((i % site.width) * S, ((i / site.width) | 0) * S, S, S)
    }
    const px = (cell: number) => {
      const p = cellCentre(site, cell)
      return [(p.x / site.cellM) * S, (p.y / site.cellM) * S] as const
    }
    // The route: walked part solid, what is left dashed.
    const here = pointAt(plan, tS)
    ctx.lineWidth = 2
    ctx.strokeStyle = '#6a40b8'
    ctx.setLineDash([])
    ctx.beginPath()
    plan.track.slice(0, here + 1).forEach((p, k) => (k === 0 ? ctx.moveTo(...px(p.cell)) : ctx.lineTo(...px(p.cell))))
    ctx.stroke()
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    plan.track.slice(here).forEach((p, k) => (k === 0 ? ctx.moveTo(...px(p.cell)) : ctx.lineTo(...px(p.cell))))
    ctx.stroke()
    ctx.setLineDash([])
    // The objectives (diamonds) and the team (dot).
    ctx.fillStyle = '#d93025'
    for (const i of plan.objectiveIndex) {
      const [x, y] = px(plan.track[i].cell)
      ctx.beginPath()
      ctx.moveTo(x, y - 6)
      ctx.lineTo(x + 5, y)
      ctx.lineTo(x, y + 6)
      ctx.lineTo(x - 5, y)
      ctx.closePath()
      ctx.fill()
    }
    const [x, y] = px(plan.track[here].cell)
    ctx.fillStyle = '#188038'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }, [site, input, plan, tS, blocked])
  return <canvas ref={canvas} className={className} width={site.width * S} height={site.height * S} aria-label="Plan vu de dessus : itinéraire répété, locaux projetés, passage obstrué" />
}

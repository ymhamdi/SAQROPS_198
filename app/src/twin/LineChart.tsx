// A small time-series chart in plain SVG (no chart library). Gaps (null) break the line. The header carries the status
// badge of what is plotted (R3); markers and reference lines come from the caller (config values, events).

import type { DataStatus } from '../types'
import { StatusBadge } from '../ui/StatusBadge'
import { niceTicks, segments } from './chartMath'

export interface ChartSeries {
  name: string
  colour: string
  dash?: string
  width?: number
  xs: readonly number[]
  ys: readonly (number | null)[]
}

export interface ChartProps {
  title: string
  statuses: readonly DataStatus[]
  yUnit: string
  xMax: number
  yMax: number
  series: readonly ChartSeries[]
  hlines?: readonly { y: number; label: string; colour: string }[]
  vmarks?: readonly { x: number; label: string; colour: string }[]
  /** shown instead of the curves while there is nothing to plot */
  empty?: string
}

const W = 420
const H = 190
const L = 40
const R = 10
const T = 22
const B = 26

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function LineChart({ title, statuses, yUnit, xMax, yMax, series, hlines = [], vmarks = [], empty }: ChartProps) {
  const px = (x: number) => L + (Math.min(x, xMax) / xMax) * (W - L - R)
  const py = (y: number) => H - B - (Math.min(Math.max(y, 0), yMax) / yMax) * (H - T - B)
  const hasData = series.some((s) => segments(s.xs, s.ys).length > 0)
  const yTicks = niceTicks(yMax, 4).filter((y) => y <= yMax)
  const xTicks = niceTicks(xMax, 5).filter((x) => x <= xMax)
  return (
    <figure className="twin-chart">
      <figcaption>
        <strong>{title}</strong> {[...new Set(statuses)].map((s) => <StatusBadge key={s} status={s} />)}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, en ${yUnit}, en fonction du temps`}>
        {yTicks.map((y) => (
          <g key={`y${y}`}>
            <line x1={L} x2={W - R} y1={py(y)} y2={py(y)} className="chart-grid" />
            <text x={L - 5} y={py(y) + 4} textAnchor="end" className="chart-tick">
              {y}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={`x${x}`} x={px(x)} y={H - B + 14} textAnchor="middle" className="chart-tick">
            {mmss(x)}
          </text>
        ))}
        <text x={2} y={11} textAnchor="start" className="chart-unit">
          {yUnit}
        </text>
        {hlines.map((h) => (
          <g key={h.label}>
            <line x1={L} x2={W - R} y1={py(h.y)} y2={py(h.y)} stroke={h.colour} strokeDasharray="5 4" strokeWidth={1.2} />
            <text x={W - R - 2} y={py(h.y) - 3} textAnchor="end" className="chart-note" fill={h.colour}>
              {h.label}
            </text>
          </g>
        ))}
        {hasData &&
          series.map((s) =>
            segments(s.xs, s.ys).map((run, k) =>
              run.length === 1 ? (
                <circle key={`${s.name}${k}`} cx={px(run[0][0])} cy={py(run[0][1])} r={2.5} fill={s.colour} />
              ) : (
                <polyline
                  key={`${s.name}${k}`}
                  points={run.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={s.colour}
                  strokeWidth={s.width ?? 2}
                  strokeDasharray={s.dash}
                  strokeLinejoin="round"
                />
              ),
            ),
          )}
        {vmarks.map((m) => {
          const right = px(m.x) > W * 0.7
          return (
            <g key={m.label}>
              <line x1={px(m.x)} x2={px(m.x)} y1={T} y2={H - B} stroke={m.colour} strokeWidth={1.5} />
              <text x={px(m.x) + (right ? -4 : 4)} y={T + 9} textAnchor={right ? 'end' : 'start'} className="chart-mark" fill={m.colour}>
                {m.label}
              </text>
            </g>
          )
        })}
        {!hasData && (
          <text x={(L + W - R) / 2} y={(T + H - B) / 2} textAnchor="middle" className="chart-note">
            {empty ?? 'En attente de données…'}
          </text>
        )}
        <line x1={L} x2={L} y1={T} y2={H - B} className="chart-axis" />
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="chart-axis" />
      </svg>
      <ul className="twin-legend">
        {series.map((s) => (
          <li key={s.name}>
            <i style={{ borderTopColor: s.colour, borderTopStyle: s.dash ? 'dashed' : 'solid' }} /> {s.name}
          </li>
        ))}
      </ul>
    </figure>
  )
}

// Colours for the CostGrid overlays and for route hazards. Pure functions (no DOM), so they are testable.

import { TERRAIN, type CostGrid } from '../types'
import type { RouteParams } from '../route/cost'

export type GridOverlayMode = 'none' | 'slope' | 'terrain' | 'walkhome' | 'radio'

export type Hazard = 'clear' | 'steep' | 'sand' | 'boulders' | 'blocked'

// Route and terrain colours, one meaning each: the route line, the terrain overlay and the legend share them.
export const INK = {
  blue: '#1a73e8',
  amber: '#f9ab00',
  orange: '#e8710a',
  red: '#d93025',
  black: '#202124',
  /** casing under every route line, so it reads on any imagery */
  white: '#ffffff',
  /** the crew's position on the tablet */
  green: '#188038',
  /** the part of the route already walked */
  walked: '#9aa0a6',
  /** the route option not chosen */
  alternative: '#8ab4f8',
  /** Curiosity's real drive path */
  traverse: '#a142f4',
  /** ground with no radio line of sight to the habitat or the rover */
  radioShadow: '#3c1e8c',
  /** the way back onto the planned route after a position fix, and the fix itself (tablet) */
  rejoin: '#e52592',
  /** the jump from where the plan had the crew to where the fix puts them */
  correction: '#5f6368',
  /** stretches the crew rides the rover */
  rover: '#3c4043',
  /** a change to the rest of the walk drafted by mission control, before it is sent */
  draft: '#007b83',
} as const

export const HAZARD_COLORS: Record<Hazard, string> = {
  clear: INK.blue,
  steep: INK.amber,
  sand: INK.orange,
  boulders: INK.red,
  blocked: INK.black,
}

export const HAZARD_LABELS: Record<Hazard, string> = {
  clear: 'Bedrock',
  steep: 'Steep 15–25°',
  sand: 'Loose sand',
  boulders: 'Boulders',
  blocked: 'Impassable',
}

type RGBA = [number, number, number, number]
const TRANSPARENT: RGBA = [0, 0, 0, 0]
const rgba = (hex: string, a: number): RGBA => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(a) as RGBA
const TERRAIN_RGBA: Record<number, RGBA> = {
  [TERRAIN.BEDROCK]: TRANSPARENT,
  [TERRAIN.SAND]: rgba(INK.orange, 150),
  [TERRAIN.BOULDERS]: rgba(INK.red, 170),
  [TERRAIN.NO_GO]: rgba(INK.black, 210),
}

function slopeRgba(slopeDeg: number, p: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>): RGBA {
  if (slopeDeg >= p.slopeImpassableDeg) return rgba(INK.black, 210)
  if (slopeDeg <= p.slopePenaltyStartDeg) return TRANSPARENT
  const f = (slopeDeg - p.slopePenaltyStartDeg) / (p.slopeImpassableDeg - p.slopePenaltyStartDeg)
  return rgba(INK.amber, Math.round(70 + 140 * f))
}

/** RGBA pixels (row 0 = north) for a grid overlay; one pixel per cell. */
export function gridOverlayPixels(
  grid: CostGrid,
  mode: 'slope' | 'terrain',
  p: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>,
): Uint8ClampedArray<ArrayBuffer> {
  const n = grid.width * grid.height
  const px = new Uint8ClampedArray(4 * n)
  for (let i = 0; i < n; i++) {
    px.set(mode === 'slope' ? slopeRgba(grid.slopeDeg[i], p) : TERRAIN_RGBA[grid.terrainClass[i]] ?? TRANSPARENT, 4 * i)
  }
  return px
}

export function cellHazard(grid: CostGrid, cell: number, p: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>): Hazard {
  const t = grid.terrainClass[cell]
  if (t === TERRAIN.NO_GO || grid.slopeDeg[cell] >= p.slopeImpassableDeg) return 'blocked'
  if (t === TERRAIN.BOULDERS) return 'boulders'
  if (t === TERRAIN.SAND) return 'sand'
  if (grid.slopeDeg[cell] > p.slopePenaltyStartDeg) return 'steep'
  return 'clear'
}

/** Walk-home heatmap bands: minutes to the nearest safe haven (habitat or rover), planned pace. */
export const WALK_HOME_BANDS: { upToMin: number; color: string; label: string }[] = [
  { upToMin: 10, color: '#188038', label: 'under 10 min' },
  { upToMin: 20, color: '#7cb342', label: '10-20 min' },
  { upToMin: 30, color: '#f9ab00', label: '20-30 min' },
  { upToMin: 45, color: '#e8710a', label: '30-45 min' },
  { upToMin: 60, color: '#d93025', label: '45-60 min' },
  { upToMin: Infinity, color: '#8c1d18', label: 'over 1 h' },
]
export const WALK_HOME_UNREACHABLE = { color: '#202124', label: 'No way back' }

/** RGBA pixels (row 0 = north) colouring every cell by its walk-home time in seconds. */
export function walkHomePixels(field: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(4 * field.length)
  const bands = WALK_HOME_BANDS.map((b) => ({ upToS: b.upToMin * 60, rgba: rgba(b.color, 120) }))
  const none = rgba(WALK_HOME_UNREACHABLE.color, 190)
  for (let i = 0; i < field.length; i++) {
    const t = field[i]
    px.set(Number.isFinite(t) ? (bands.find((b) => t < b.upToS) ?? bands[bands.length - 1]).rgba : none, 4 * i)
  }
  return px
}

/** Radio shadow overlay: cells without line of sight tinted, cells in contact left clear. */
export function radioPixels(visible: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(4 * visible.length)
  const shadow = rgba(INK.radioShadow, 140)
  for (let i = 0; i < visible.length; i++) if (!visible[i]) px.set(shadow, 4 * i)
  return px
}

/** Walking seconds spent in each hazard on one leg (each step counted in the cell it enters). */
export function legHazardSeconds(
  grid: CostGrid,
  track: { cell: number; arriveS: number; departS: number; leg: number }[],
  leg: number,
  p: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>,
): Record<Hazard, number> {
  const out: Record<Hazard, number> = { clear: 0, steep: 0, sand: 0, boulders: 0, blocked: 0 }
  for (let i = 1; i < track.length; i++) {
    if (track[i].leg === leg) out[cellHazard(grid, track[i].cell, p)] += track[i].arriveS - track[i - 1].departS
  }
  return out
}

/**
 * Index spans of equal hazard along a sequence (e.g. a route track), for colouring a line by hazard.
 * Neighbouring spans share their boundary index so a drawn line has no gaps.
 */
export function hazardSpans(hazards: Hazard[]): { hazard: Hazard; from: number; to: number }[] {
  const spans: { hazard: Hazard; from: number; to: number }[] = []
  hazards.forEach((hazard, i) => {
    const last = spans.at(-1)
    if (last && last.hazard === hazard) last.to = i
    else {
      if (last) last.to = i // the previous span runs on to this point
      spans.push({ hazard, from: i, to: i })
    }
  })
  return spans
}

/**
 * Splits a path into runs of the same hazard, for drawing each run in its colour.
 * Consecutive runs share their boundary cell so the drawn line has no gaps.
 */
export function hazardRuns(
  grid: CostGrid,
  cells: number[],
  p: Pick<RouteParams, 'slopePenaltyStartDeg' | 'slopeImpassableDeg'>,
): { hazard: Hazard; cells: number[] }[] {
  const runs: { hazard: Hazard; cells: number[] }[] = []
  for (const cell of cells) {
    const hazard = cellHazard(grid, cell, p)
    const last = runs.at(-1)
    if (last && last.hazard === hazard) last.cells.push(cell)
    else {
      if (last) last.cells.push(cell)
      runs.push({ hazard, cells: [cell] })
    }
  }
  return runs
}

// Radio line of sight on the CostGrid: which cells can see an antenna (a viewshed), with Mars curvature.

import { MARS_MEAN_RADIUS_M } from '../config'
import type { CostGrid } from '../types'

export interface Antenna {
  cell: number
  /** antenna height above the ground at `cell`, m */
  heightM: number
}

/**
 * 1 where a receiver `targetHeightM` above the ground has an unobstructed straight line to the antenna, 0 elsewhere.
 * Rays run from the antenna to every edge cell of the grid (Franklin's R2 sweep); along each ray a cell is visible
 * when its receiver is not below the steepest terrain seen closer to the antenna. Heights are lowered by the
 * curvature drop d²/2R so long sight lines over flat ground are not too generous.
 */
export function viewshed(grid: CostGrid, antenna: Antenna, targetHeightM: number): Uint8Array {
  const { width, height, cellSizeM, elevation } = grid
  const out = new Uint8Array(width * height)
  const r0 = (antenna.cell / width) | 0
  const c0 = antenna.cell - r0 * width
  const eye = elevation[antenna.cell] + antenna.heightM
  out[antenna.cell] = 1
  const drop = (d: number) => (d * d) / (2 * MARS_MEAN_RADIUS_M)

  const ray = (r1: number, c1: number) => {
    const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0))
    if (steps === 0) return
    const dr = (r1 - r0) / steps
    const dc = (c1 - c0) / steps
    let maxSlope = -Infinity
    for (let k = 1; k <= steps; k++) {
      const r = Math.round(r0 + dr * k)
      const c = Math.round(c0 + dc * k)
      const cell = r * width + c
      const d = Math.hypot(r - r0, c - c0) * cellSizeM
      const ground = elevation[cell] - drop(d) - eye
      if ((ground + targetHeightM) / d >= maxSlope) out[cell] = 1
      maxSlope = Math.max(maxSlope, ground / d)
    }
  }
  for (let c = 0; c < width; c++) {
    ray(0, c)
    ray(height - 1, c)
  }
  for (let r = 0; r < height; r++) {
    ray(r, 0)
    ray(r, width - 1)
  }
  return out
}

/** Cells that see at least one of the antennas (element-wise OR). */
export function combinedViewshed(grid: CostGrid, antennas: Antenna[], targetHeightM: number): Uint8Array {
  const out = new Uint8Array(grid.width * grid.height)
  for (const a of antennas) {
    const v = viewshed(grid, a, targetHeightM)
    for (let i = 0; i < out.length; i++) out[i] |= v[i]
  }
  return out
}

/**
 * Line of sight from the antenna to each of `cells` only (one ray per cell, same test and curvature as viewshed):
 * 1 when a receiver `targetHeightM` above that cell sees the antenna. Much cheaper than a viewshed for a route.
 */
export function inSight(grid: CostGrid, antenna: Antenna, targetHeightM: number, cells: number[]): Uint8Array {
  const { width, cellSizeM, elevation } = grid
  const r0 = (antenna.cell / width) | 0
  const c0 = antenna.cell - r0 * width
  const eye = elevation[antenna.cell] + antenna.heightM
  const drop = (d: number) => (d * d) / (2 * MARS_MEAN_RADIUS_M)
  return Uint8Array.from(cells, (target) => {
    const r1 = (target / width) | 0
    const c1 = target - r1 * width
    const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0))
    if (steps === 0) return 1
    const dr = (r1 - r0) / steps
    const dc = (c1 - c0) / steps
    let maxSlope = -Infinity
    for (let k = 1; k < steps; k++) {
      const r = Math.round(r0 + dr * k)
      const c = Math.round(c0 + dc * k)
      const d = Math.hypot(r - r0, c - c0) * cellSizeM
      maxSlope = Math.max(maxSlope, (elevation[r * width + c] - drop(d) - eye) / d)
    }
    const d = Math.hypot(r1 - r0, c1 - c0) * cellSizeM
    return (elevation[target] - drop(d) - eye + targetHeightM) / d >= maxSlope ? 1 : 0
  })
}

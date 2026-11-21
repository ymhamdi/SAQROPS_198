// Tiny hand-drawn grids for tests.

import { METERS_PER_DEG_LAT } from '../config'
import { TERRAIN, type CostGrid, type DataStatus } from '../types'

export const TEST_CELL_M = 2

/**
 * Grid from row strings: '.' bedrock, 's' sand, 'b' boulders, '#' no-go, '^' 30° slope (impassable).
 * Bounds sit on the equator so each cell is TEST_CELL_M on the ground.
 */
export function gridFrom(rows: string[], elevation?: (r: number, c: number) => number, status: DataStatus = 'MOCK'): CostGrid {
  const height = rows.length
  const width = rows[0].length
  const n = width * height
  const grid: CostGrid = {
    width,
    height,
    cellSizeM: TEST_CELL_M,
    bounds: { latMin: 0, latMax: (height * TEST_CELL_M) / METERS_PER_DEG_LAT, lonMin: 0, lonMax: (width * TEST_CELL_M) / METERS_PER_DEG_LAT },
    elevation: new Float32Array(n),
    slopeDeg: new Float32Array(n),
    terrainClass: new Uint8Array(n),
    status,
  }
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const i = r * width + c
      grid.elevation[i] = elevation ? elevation(r, c) : 0
      if (ch === 's') grid.terrainClass[i] = TERRAIN.SAND
      if (ch === 'b') grid.terrainClass[i] = TERRAIN.BOULDERS
      if (ch === '#') grid.terrainClass[i] = TERRAIN.NO_GO
      if (ch === '^') grid.slopeDeg[i] = 30
    }),
  )
  return grid
}

export const idx = (g: CostGrid, r: number, c: number) => r * g.width + c

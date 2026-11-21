import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseCostGrid } from './costGrid'
import { TERRAIN, type CostGridMeta, type DataConfig } from './types'

function meta(width: number, height: number): CostGridMeta {
  return {
    width,
    height,
    cellSizeM: 2,
    bounds: { latMin: 0, latMax: 1, lonMin: 0, lonMax: 1 },
    binary: 'test.bin',
    status: 'MOCK',
    source: 'test',
  }
}

/** Same layout the pipeline writes: f32 elevation, f32 slope, u8 terrain, little-endian. */
function encode(elevation: number[], slope: number[], terrain: number[]): ArrayBuffer {
  const n = elevation.length
  const view = new DataView(new ArrayBuffer(9 * n))
  elevation.forEach((v, i) => view.setFloat32(4 * i, v, true))
  slope.forEach((v, i) => view.setFloat32(4 * (n + i), v, true))
  terrain.forEach((v, i) => view.setUint8(8 * n + i, v))
  return view.buffer
}

describe('parseCostGrid', () => {
  test('reads the three arrays from the little-endian layout', () => {
    const grid = parseCostGrid(meta(3, 2), encode([-3700, -3701.5, 1, 2, 3, 4], [0, 12.5, 30, 0, 0, 0], [0, 1, 2, 3, 0, 1]))
    expect(Array.from(grid.elevation)).toEqual([-3700, -3701.5, 1, 2, 3, 4])
    expect(Array.from(grid.slopeDeg)).toEqual([0, 12.5, 30, 0, 0, 0])
    expect(Array.from(grid.terrainClass)).toEqual([0, 1, 2, 3, 0, 1])
    expect(grid.status).toBe('MOCK')
  })

  test('rejects a buffer of the wrong size', () => {
    expect(() => parseCostGrid(meta(3, 2), new ArrayBuffer(10))).toThrow(/expected 54 bytes/)
  })
})

// The grid the pipeline actually wrote (data/ is git-ignored, so this runs only locally).
const DATA = new URL('../../data/', import.meta.url)
const hasGrid = existsSync(new URL('config.json', DATA))

describe.skipIf(!hasGrid)('pipeline output in data/', () => {
  test('the configured CostGrid parses and holds valid values', () => {
    const config = JSON.parse(readFileSync(new URL('config.json', DATA), 'utf-8')) as DataConfig
    const metaUrl = new URL(config.costGrid, DATA)
    const gridMeta = JSON.parse(readFileSync(metaUrl, 'utf-8')) as CostGridMeta
    const bytes = readFileSync(new URL(gridMeta.binary, metaUrl))
    const grid = parseCostGrid(gridMeta, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

    expect(grid.bounds).toEqual(config.site.bounds)
    const codes = new Set(Object.values(TERRAIN) as number[])
    for (let i = 0; i < grid.terrainClass.length; i++) {
      if (!codes.has(grid.terrainClass[i])) throw new Error(`bad terrain code at ${i}`)
      if (!(grid.slopeDeg[i] >= 0 && grid.slopeDeg[i] < 90)) throw new Error(`bad slope at ${i}`)
      if (!Number.isFinite(grid.elevation[i])) throw new Error(`bad elevation at ${i}`)
    }
  })
})

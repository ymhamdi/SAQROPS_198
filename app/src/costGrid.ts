import type { CostGrid, CostGridMeta } from './types'

/**
 * Build a CostGrid from its JSON metadata and .bin contents (layout in types.ts).
 * Typed arrays read in platform byte order; every browser platform we target is little-endian, like the file.
 */
export function parseCostGrid(meta: CostGridMeta, buffer: ArrayBuffer): CostGrid {
  const n = meta.width * meta.height
  if (buffer.byteLength !== 9 * n) {
    throw new Error(`${meta.binary}: expected ${9 * n} bytes for ${meta.width}x${meta.height}, got ${buffer.byteLength}`)
  }
  return {
    width: meta.width,
    height: meta.height,
    cellSizeM: meta.cellSizeM,
    bounds: meta.bounds,
    elevation: new Float32Array(buffer, 0, n),
    slopeDeg: new Float32Array(buffer, 4 * n, n),
    terrainClass: new Uint8Array(buffer, 8 * n, n),
    status: meta.status,
  }
}

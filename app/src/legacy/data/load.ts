// Loads everything the app shows through data/config.json (CLAUDE.md §4: no datasets in app logic).

import { parseCostGrid } from '../costGrid'
import type { CostGrid, CostGridMeta, DataConfig } from '../types'

/** URL of data/ as served by the app (dev middleware / dist/data). Paths in config.json are relative to it. */
export const DATA_URL = `${import.meta.env.BASE_URL}data/`

export function dataUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : DATA_URL + path
}

async function fetchOk(path: string): Promise<Response> {
  const res = await fetch(dataUrl(path))
  if (!res.ok) throw new Error(`Could not load data/${path} (HTTP ${res.status}). Run \`python -m pipeline mock\` first?`)
  return res
}

export async function loadJson<T>(path: string): Promise<T> {
  return (await fetchOk(path)).json() as Promise<T>
}

export interface LoadedGrid {
  grid: CostGrid
  meta: CostGridMeta
  /** the raw .bin, for handing a copy to the route worker */
  buffer: ArrayBuffer
}

export async function loadCostGrid(config: DataConfig): Promise<LoadedGrid> {
  const meta = await loadJson<CostGridMeta>(config.costGrid)
  const dir = config.costGrid.slice(0, config.costGrid.lastIndexOf('/') + 1)
  const buffer = await (await fetchOk(dir + meta.binary)).arrayBuffer()
  return { grid: parseCostGrid(meta, buffer), meta, buffer }
}

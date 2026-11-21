// Promise wrapper around the route worker, for the UI.

import type { CostGridMeta } from '../types'
import type { RouteParams, RouteProfile } from './cost'
import type { RouteResult } from './route'
import type { Antenna } from './viewshed'
import type { WorkerResponse } from './workerHandler'

export interface RouteClient {
  /** Hands the grid to the worker. The buffer is transferred: it is unusable on this thread afterwards. */
  init(meta: CostGridMeta, buffer: ArrayBuffer, params?: RouteParams): Promise<void>
  /** 'safest' searches with heavy hazard penalties; leg times are then search costs, so re-time with routeStats. */
  route(stops: number[], profile?: RouteProfile, ride?: boolean, roverStart?: number): Promise<RouteResult>
  walkHome(base: number): Promise<Float32Array>
  /** Walking time between every ordered pair of cells, seconds (Infinity where there is no path). */
  matrix(cells: number[]): Promise<number[][]>
  /** 1 for every cell with radio line of sight to at least one antenna */
  viewshed(antennas: Antenna[], targetHeightM: number): Promise<Uint8Array>
  terminate(): void
}

export function createRouteClient(): RouteClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()
  let nextId = 1

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.type === 'error') p.reject(new Error(e.data.message))
    else p.resolve(e.data)
  }

  function send(message: object, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id }, transfer)
    })
  }

  return {
    init: async (meta, buffer, params) => {
      await send({ type: 'init', meta, buffer, params }, [buffer])
    },
    route: async (stops, profile = 'fastest', ride = false, roverStart) => {
      const r = await send({ type: 'route', stops, profile, ride, roverStart })
      if (r.type !== 'route') throw new Error(`unexpected response ${r.type}`)
      return r.result
    },
    walkHome: async (base) => {
      const r = await send({ type: 'walkHome', base })
      if (r.type !== 'walkHome') throw new Error(`unexpected response ${r.type}`)
      return r.field
    },
    matrix: async (cells) => {
      const r = await send({ type: 'matrix', cells })
      if (r.type !== 'matrix') throw new Error(`unexpected response ${r.type}`)
      return r.times
    },
    viewshed: async (antennas, targetHeightM) => {
      const r = await send({ type: 'viewshed', antennas, targetHeightM })
      if (r.type !== 'viewshed') throw new Error(`unexpected response ${r.type}`)
      return r.visible
    },
    terminate: () => worker.terminate(),
  }
}

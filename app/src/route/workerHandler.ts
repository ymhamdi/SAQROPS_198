// Message protocol of the route worker, as a plain function so it can be tested without a Worker.

import { parseCostGrid } from '../costGrid'
import type { CostGridMeta } from '../types'
import { DEFAULT_ROUTE_PARAMS, prepareGrid, ROVER_ROUTE_PARAMS, SAFEST_ROUTE_PARAMS, type PreparedGrid, type RouteParams, type RouteProfile } from './cost'
import { annotateRover, planRide, planRoute, type RouteResult } from './route'
import { ROVER_ANTENNA_HEIGHT_M, ROVER_BOARDING_S, ROVER_DROP_MAX_DISTANCE_M, SUIT_ANTENNA_HEIGHT_M } from '../config'
import { findPath, walkHomeField } from './search'
import { combinedViewshed, type Antenna } from './viewshed'

export type WorkerRequest =
  | { type: 'init'; id: number; meta: CostGridMeta; buffer: ArrayBuffer; params?: RouteParams }
  | {
      type: 'route'
      id: number
      stops: number[]
      profile?: RouteProfile
      ride?: boolean
      /** rover-assisted re-plan of the rest of a walk: where the rover is parked at stops[0]; default stops[0] */
      roverStart?: number
    }
  | { type: 'walkHome'; id: number; base: number }
  | { type: 'matrix'; id: number; cells: number[] }
  | { type: 'viewshed'; id: number; antennas: Antenna[]; targetHeightM: number }

export type WorkerResponse =
  | { type: 'init'; id: number }
  | { type: 'route'; id: number; result: RouteResult }
  | { type: 'walkHome'; id: number; field: Float32Array }
  | { type: 'matrix'; id: number; times: number[][] }
  | { type: 'viewshed'; id: number; visible: Uint8Array }
  | { type: 'error'; id: number; message: string }

export interface WorkerState {
  prepared: PreparedGrid | null
  /** the same grid with the safest-route penalties, prepared on first use */
  safest?: PreparedGrid
  /** the rover's driving grid and its time-to-base field, prepared on the first rover-assisted route */
  rover?: PreparedGrid
  roverReach?: { base: number; field: Float32Array }
}

/** Handles one request. Returns the response and any buffers to transfer back. */
export function handleRequest(state: WorkerState, req: WorkerRequest): { response: WorkerResponse; transfer: Transferable[] } {
  try {
    if (req.type === 'init') {
      state.prepared = prepareGrid(parseCostGrid(req.meta, req.buffer), req.params ?? DEFAULT_ROUTE_PARAMS)
      state.safest = undefined
      state.rover = undefined
      state.roverReach = undefined
      return { response: { type: 'init', id: req.id }, transfer: [] }
    }
    if (!state.prepared) throw new Error('route worker not initialised: send init first')
    if (req.type === 'route') {
      let grid = state.prepared
      if (req.profile === 'safest') grid = state.safest ??= prepareGrid(state.prepared.grid, SAFEST_ROUTE_PARAMS)
      if (!req.ride) return { response: { type: 'route', id: req.id, result: planRoute(grid, req.stops) }, transfer: [] }
      const rover = (state.rover ??= prepareGrid(state.prepared.grid, ROVER_ROUTE_PARAMS))
      const base = req.stops[req.stops.length - 1] // the habitat
      if (state.roverReach?.base !== base) state.roverReach = { base, field: walkHomeField(rover, base) }
      const planned = planRide(grid, rover, state.roverReach.field, req.stops, ROVER_DROP_MAX_DISTANCE_M, ROVER_BOARDING_S, req.roverStart)
      // Emergency times to the parked rover on the standard walking model, as the walk-home field (any route profile).
      const result = planned.ok ? { ...planned, legs: annotateRover(state.prepared, planned.legs, ROVER_ANTENNA_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M) } : planned
      return { response: { type: 'route', id: req.id, result }, transfer: [] }
    }
    if (req.type === 'matrix') {
      // Walking time between every ordered pair of points (asymmetric: uphill and downhill differ).
      const p = state.prepared
      const times = req.cells.map((a) => req.cells.map((b) => (a === b ? 0 : (findPath(p, a, b)?.timeS ?? Infinity))))
      return { response: { type: 'matrix', id: req.id, times }, transfer: [] }
    }
    if (req.type === 'viewshed') {
      const visible = combinedViewshed(state.prepared.grid, req.antennas, req.targetHeightM)
      return { response: { type: 'viewshed', id: req.id, visible }, transfer: [visible.buffer] }
    }
    const field = walkHomeField(state.prepared, req.base)
    return { response: { type: 'walkHome', id: req.id, field }, transfer: [field.buffer] }
  } catch (e) {
    return { response: { type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) }, transfer: [] }
  }
}

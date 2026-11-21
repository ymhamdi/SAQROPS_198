// Walking-time cost model (CLAUDE.md §5). Edge cost = seconds to walk from one cell centre to a neighbour's.

import {
  ROVER_SLOPE_IMPASSABLE_DEG,
  ROVER_SLOPE_PENALTY_PER_DEG,
  ROVER_SLOPE_PENALTY_START_DEG,
  ROVER_SPEED_KMH,
  ROVER_TERRAIN_MULTIPLIER,
  SLOPE_IMPASSABLE_DEG,
  SLOPE_PENALTY_PER_DEG,
  SLOPE_PENALTY_START_DEG,
  SAFE_ROUTE_SLOPE_PENALTY_PER_DEG,
  SAFE_ROUTE_TERRAIN_MULTIPLIER,
  SUIT_SPEED_FACTOR,
  TERRAIN_COST_MULTIPLIER,
  TOBLER_DECAY,
  TOBLER_MAX_SPEED_KMH,
  TOBLER_SLOPE_OFFSET,
} from '../config'
import type { CostGrid, TerrainClass } from '../types'

export interface RouteParams {
  suitSpeedFactor: number
  slopePenaltyStartDeg: number
  slopeImpassableDeg: number
  slopePenaltyPerDeg: number
  terrainMultiplier: Record<TerrainClass, number>
  /** A vehicle's constant speed, m/s; when set it replaces the walking (Tobler) speed. */
  fixedSpeedMs?: number
}

export const DEFAULT_ROUTE_PARAMS: RouteParams = {
  suitSpeedFactor: SUIT_SPEED_FACTOR,
  slopePenaltyStartDeg: SLOPE_PENALTY_START_DEG,
  slopeImpassableDeg: SLOPE_IMPASSABLE_DEG,
  slopePenaltyPerDeg: SLOPE_PENALTY_PER_DEG,
  terrainMultiplier: TERRAIN_COST_MULTIPLIER,
}

/** Search costs for the "safest" alternative: same physics, much heavier hazard penalties (config.ts). */
export const SAFEST_ROUTE_PARAMS: RouteParams = {
  ...DEFAULT_ROUTE_PARAMS,
  slopePenaltyPerDeg: SAFE_ROUTE_SLOPE_PENALTY_PER_DEG,
  terrainMultiplier: SAFE_ROUTE_TERRAIN_MULTIPLIER,
}

/** The support rover driving (config.ts): constant speed, stricter slope limit, slow in sand, no rocky ground. */
export const ROVER_ROUTE_PARAMS: RouteParams = {
  ...DEFAULT_ROUTE_PARAMS,
  fixedSpeedMs: ROVER_SPEED_KMH / 3.6,
  slopePenaltyStartDeg: ROVER_SLOPE_PENALTY_START_DEG,
  slopeImpassableDeg: ROVER_SLOPE_IMPASSABLE_DEG,
  slopePenaltyPerDeg: ROVER_SLOPE_PENALTY_PER_DEG,
  terrainMultiplier: ROVER_TERRAIN_MULTIPLIER,
}

export type RouteProfile = 'fastest' | 'safest'

/** A CostGrid plus the per-cell cost multiplier and scratch buffers the searches reuse. */
export interface PreparedGrid {
  grid: CostGrid
  params: RouteParams
  /** terrain × slope-penalty multiplier per cell; Infinity = impassable */
  mult: Float32Array
  scratch: { g: Float64Array; came: Int32Array; closed: Uint8Array }
}

/**
 * Tobler's hiking function × suit factor, in m/s. tanTheta is the signed slope along the
 * direction of travel (rise / horizontal run), so uphill and downhill differ.
 */
export function walkingSpeedMs(tanTheta: number, suitSpeedFactor: number): number {
  const kmh = TOBLER_MAX_SPEED_KMH * Math.exp(-TOBLER_DECAY * Math.abs(tanTheta + TOBLER_SLOPE_OFFSET))
  return (kmh * suitSpeedFactor) / 3.6
}

/** Fastest possible walking speed, m/s (Tobler's peak, on a 5% downhill). Used by the A* heuristic. */
export function maxWalkingSpeedMs(params: RouteParams): number {
  if (params.fixedSpeedMs) return params.fixedSpeedMs
  return walkingSpeedMs(-TOBLER_SLOPE_OFFSET, params.suitSpeedFactor)
}

/** Cost multiplier of a cell from its terrain class and its (direction-free) slope. */
export function cellMultiplier(slopeDeg: number, terrain: number, params: RouteParams): number {
  if (slopeDeg >= params.slopeImpassableDeg) return Infinity
  const terrainMult = params.terrainMultiplier[terrain as TerrainClass] ?? Infinity
  const slopeMult = 1 + params.slopePenaltyPerDeg * Math.max(0, slopeDeg - params.slopePenaltyStartDeg)
  return terrainMult * slopeMult
}

export function prepareGrid(grid: CostGrid, params: RouteParams = DEFAULT_ROUTE_PARAMS): PreparedGrid {
  const n = grid.width * grid.height
  const mult = new Float32Array(n)
  for (let i = 0; i < n; i++) mult[i] = cellMultiplier(grid.slopeDeg[i], grid.terrainClass[i], params)
  return {
    grid,
    params,
    mult,
    scratch: { g: new Float64Array(n), came: new Int32Array(n), closed: new Uint8Array(n) },
  }
}

export function isPassable(p: PreparedGrid, cell: number): boolean {
  return Number.isFinite(p.mult[cell])
}

/**
 * Seconds to walk from cell `from` to neighbouring cell `to`, distM apart horizontally.
 * Half the step lies in each cell, so the two multipliers are averaged; either impassable → Infinity.
 * Distance is horizontal map distance, as in Tobler's function.
 */
export function stepTime(p: PreparedGrid, from: number, to: number, distM: number): number {
  const m = (p.mult[from] + p.mult[to]) / 2
  if (!Number.isFinite(m)) return Infinity
  const tanTheta = (p.grid.elevation[to] - p.grid.elevation[from]) / distM
  const speed = p.params.fixedSpeedMs ?? walkingSpeedMs(tanTheta, p.params.suitSpeedFactor)
  return (distM / speed) * m
}

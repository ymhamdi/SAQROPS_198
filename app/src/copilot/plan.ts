// Builds what the copilot needs from the planner's state, so App.tsx only wires a few lines.

import { useMemo, useRef } from 'react'
import type { AbortPlan } from '../panels/Hud'
import type { PreparedGrid, RouteProfile } from '../route/cost'
import type { RouteClient } from '../route/client'
import type { RouteResult } from '../route/route'
import type { EvaParams } from '../stats/goNoGo'
import { stopDwellS } from '../stats/stats'
import type { Conditions, ScienceTarget, Waypoint } from '../types'
import type { CopilotPlan } from './useCopilot'
import type { ApplyAction } from './whatIf'

/** Extra dwell per stop id, s, added by an applied "stay longer". */
export type DwellExtras = Record<string, number>

/**
 * Per-stop dwell for evaluateEva: the planned time at each stop (none at via points) plus any applied extra; undefined
 * when that is the engine default at every stop.
 */
export function dwellWithExtras(stops: Waypoint[], extras: DwellExtras): number[] | undefined {
  if (!stops.some((s) => extras[s.id] || s.kind === 'via')) return undefined
  return stops.map((s) => stopDwellS(s) + (extras[s.id] ?? 0))
}

/** An applied stay as a new extras map (null when this Apply is not supported: a pause mid-leg has no stop). */
export function withExtra(extras: DwellExtras, action: ApplyAction): DwellExtras | null {
  if (action.kind !== 'extend_stay' || !action.stopId) return null
  return { ...extras, [action.stopId]: (extras[action.stopId] ?? 0) + action.extraS }
}

interface Inputs {
  prepared: PreparedGrid
  route: RouteResult | null
  profile: RouteProfile
  stops: Waypoint[]
  targets: ScienceTarget[]
  walkHome: Float32Array | null
  startTime: string
  conditions: Conditions[]
  params: EvaParams
  lonEast: number
  extras: DwellExtras
  setExtras: (e: DwellExtras) => void
  client: { current: { client: RouteClient; ready: Promise<void> } | null }
  planAbort: (cell: number) => AbortPlan | null
  /** the rover's prepared grid when the plan is rover-assisted */
  drive?: PreparedGrid
}

/** The copilot's view of the current plan, or null while there is no walkable route. */
export function useCopilotPlan(i: Inputs): CopilotPlan | null {
  const latest = useRef(i)
  latest.current = i
  const { prepared, route, profile, stops, targets, walkHome, startTime, conditions, params, lonEast, extras, drive } = i
  return useMemo(() => {
    if (!route?.ok || !walkHome) return null
    return {
      ctx: { prepared, legs: route.legs, stops, targets, walkHome, startTime, conditions, params, lonEast, dwellS: dwellWithExtras(stops, extras), drive },
      // Path searches run in the planner's route worker, with the same profile as the plan.
      findPath: async (a: number, b: number) => {
        const c = latest.current.client.current
        if (!c) return null
        await c.ready
        const r = await c.client.route([a, b], profile)
        return r.ok ? r.legs[0].cells : null
      },
      planAbort: (cell: number) => latest.current.planAbort(cell),
      canApply: (a: ApplyAction) => withExtra(latest.current.extras, a) !== null,
      onApply: (a: ApplyAction) => {
        const next = withExtra(latest.current.extras, a)
        if (!next) return false
        latest.current.setExtras(next)
        return true
      },
    }
  }, [prepared, route, profile, stops, targets, walkHome, startTime, conditions, params, lonEast, extras, drive])
}

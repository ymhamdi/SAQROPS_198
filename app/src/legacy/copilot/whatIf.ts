// What-if questions asked during the walk ("can we stay 20 more minutes?"), answered by re-running the existing
// engine (evaluateEva on the plan as it stands now). Pure: no LLM, no DOM. Every number the copilot says or shows
// comes from a WhatIfResult built here.
//
// Model of "now": the crew is at track point `index` of the plan at EVA time `elapsedS`. Being later than the plan at
// that point is treated as a pause there, so everything after it shifts by the delay. The past is left as planned.

import { SCIENCE_STOP_DWELL_MIN } from '../config'
import { isPassable, type PreparedGrid } from '../route/cost'
import { cellAt, type Leg } from '../route/route'
import { marsClockAt } from '../stats/card'
import { findSunset, radiationAlertsIn } from '../stats/conditions'
import { evaDoseMSv, evaluateEva, type EvaParams, type EvaVerdict, type Reason, type ReasonCode } from '../stats/goNoGo'
import { worstStatus } from '../stats/status'
import type { Conditions, DataStatus, ScienceTarget, Waypoint } from '../types'

export const INTENTS = ['extend_stay', 'add_stop', 'skip_stop', 'time_left', 'go_home', 'unknown'] as const
export type Intent = (typeof INTENTS)[number]

export type WhatIfVerdict = 'GO' | 'PARTIAL' | 'NO_GO'

/** Why a question has no budget answer (not a goNoGo reason). */
export type CopilotCode =
  | 'ALREADY_LEFT'
  | 'ALREADY_PLANNED'
  | 'ALREADY_VISITED'
  | 'NOT_ON_PLAN'
  | 'UNKNOWN_PLACE'
  | 'NO_PATH_TO_TARGET'
  | 'WALK_DONE'
  | 'NO_HAVEN'

export type Binding = ReasonCode | CopilotCode

/** Longest extra stay searched, minutes. */
export const MAX_EXTRA_MIN = 240

export interface WhatIfNumbers {
  /** suit O₂ left now, min */
  o2_left_min: number
  /** minutes until the crew must start home from where they stand (the HUD's walk-home margin) */
  pnr_in_min: number
  /** latest time to leave (Mars local "14:35") and how many minutes from now; null when it does not apply */
  head_back_by: string | null
  head_back_in_min: number | null
  /** back at base this long before sunset under the answer's plan, min; null when the sunset is not in the data */
  sunset_margin_min: number | null
  /** surface background dose of the whole Marswalk under the answer's plan, mSv */
  dose_msv: number
  /** O₂ above the reserve on return under the answer's plan, min */
  o2_at_return_min: number | null
  /** add_stop: extra Marswalk time (walking + work), min; O₂ cost is the same number (O₂ is a time budget) */
  extra_min?: number
  /** skip_stop: time (and O₂) saved, min */
  saved_min?: number
  /** go_home: walking time and distance to the nearest safe haven, and O₂ above reserve on arrival at the slow pace */
  to_safety_min?: number
  distance_m?: number
  spare_o2_min?: number
}

/** What "Apply" would change in the plan. The copilot never applies it by itself. */
export type ApplyAction =
  | { kind: 'extend_stay'; stopId: string | null; extraS: number }
  | { kind: 'add_stop'; targetId: string; insertAt: number }
  | { kind: 'skip_stop'; stopId: string }
  | { kind: 'go_home' }

export interface WhatIfResult {
  intent: Intent
  verdict: WhatIfVerdict
  requested_min: number | null
  allowed_min: number | null
  /** the limit that decides the answer (the first one to break), or null when nothing binds */
  binding: Binding | null
  numbers: WhatIfNumbers
  /** no-go and caution reasons of the plan the answer refers to (for the requested change when it is refused) */
  reasons: Reason[]
  /** the stop, target or haven the answer is about */
  subject: string | null
  /** true when the next station after the stay is the habitat ("head back" rather than "move on") */
  next_is_home: boolean
  /** weakest data status behind the numbers; never better than MODELED */
  status: DataStatus
  apply: ApplyAction | null
}

/** The plan the crew is walking, exactly as the planner judged it. */
export interface PlanContext {
  /** grid prepared with the planner's route params (the same one evaluateEva gets in the app) */
  prepared: PreparedGrid
  /** legs of the active route: habitat → stops → habitat */
  legs: Leg[]
  stops: Waypoint[]
  targets: ScienceTarget[]
  /** seconds from every cell to the nearest safe haven (habitat or staged rover) */
  walkHome: Float32Array
  startTime: string
  conditions: Conditions[]
  params: EvaParams
  /** dwell at each stop, s; defaults to the engine's default for every stop */
  dwellS?: number[]
  /** site longitude, east, for Mars local clock times */
  lonEast: number
  /** the rover's prepared grid on a rover-assisted plan, so ridden steps are timed at rover speed (as the planner does) */
  drive?: PreparedGrid
}

/** Where the crew is now. */
export interface Snapshot {
  /** EVA clock, s since the start */
  elapsedS: number
  /** index into the plan's track of the last point reached (positionAt(track, t).index) */
  index: number
  /** O₂ used so far, in seconds of suit duration; defaults to elapsedS */
  o2UsedS?: number
}

/** Finds a walking path between two cells (in the app: the route worker, same profile as the plan). */
export type PathFinder = (from: number, to: number) => Promise<number[] | null>

// ---------- plan surgery ----------

/** A stretch of the plan still to walk, ending at a station. */
interface Segment {
  cells: number[]
  /** dwell at its end (ignored for the last segment, which ends at the habitat) */
  endDwellS: number
  /** index into ctx.stops of the station it ends at; null for the habitat or an inserted target */
  stopIndex: number | null
  name: string
}

/** The plan split at the crew's position: what is walked, the pause here, what is left. */
interface Split {
  past: Leg[]
  pastDwell: number[]
  /** planned dwell at the crew's point (a stop's dwell, or 0 mid-leg) */
  hereBaseDwellS: number
  hereArriveS: number
  /** planned departure from here = arrive + base dwell */
  hereDepartS: number
  future: Segment[]
  /** stop the crew is at (dwelling or just leaving), or null mid-leg */
  stopIndex: number | null
  cell: number
}

const toLeg = (cells: number[]): Leg => ({ from: cells[0], to: cells[cells.length - 1], cells, timeS: 0 })

function dwellsOf(ctx: PlanContext): number[] {
  return ctx.stops.map((_, i) => ctx.dwellS?.[i] ?? SCIENCE_STOP_DWELL_MIN * 60)
}

function evaluate(ctx: PlanContext, legs: Leg[], dwellS: number[], o2UsedExtraS: number): EvaVerdict {
  return evaluateEva({
    prepared: ctx.prepared,
    route: { ok: true, legs, timeS: 0 },
    walkHome: ctx.walkHome,
    startTime: ctx.startTime,
    conditions: ctx.conditions,
    dwellS,
    params: { ...ctx.params, o2DurationS: ctx.params.o2DurationS - o2UsedExtraS },
    drive: ctx.drive,
  })
}

/** Locate track point `index` on the legs: leg, offset in its cells, and whether it is a stop. */
function locate(legs: Leg[], index: number): { leg: number; k: number; atStop: boolean; done: boolean } {
  const last = legs.length - 1
  let start = 0
  let l = 0
  // Track layout: leg 0 contributes all its cells, every later leg all but its first (shared with the previous end).
  while (l < last && index > start + legs[l].cells.length - 1) {
    start += legs[l].cells.length - 1
    l++
  }
  const k = Math.max(0, Math.min(index - start, legs[l].cells.length - 1))
  const atEnd = k === legs[l].cells.length - 1
  return { leg: l, k, atStop: atEnd && l < last, done: atEnd && l === last }
}

function split(ctx: PlanContext, plan: EvaVerdict, index: number): Split | null {
  const { legs, stops } = ctx
  const dwell = dwellsOf(ctx)
  const where = locate(legs, index)
  if (where.done || !plan.stats) return null
  const point = plan.stats.track[Math.min(index, plan.stats.track.length - 1)]
  const L = legs.length
  const seg = (j: number, cells = legs[j].cells): Segment => ({
    cells,
    endDwellS: j < L - 1 ? dwell[j] : 0,
    stopIndex: j < L - 1 ? j : null,
    name: j < L - 1 ? stops[j].name : 'habitat',
  })
  const li = where.leg
  if (where.atStop) {
    return {
      past: legs.slice(0, li + 1),
      pastDwell: dwell.slice(0, li),
      hereBaseDwellS: dwell[li],
      hereArriveS: point.arriveS,
      hereDepartS: point.departS,
      future: legs.slice(li + 1).map((_, j) => seg(li + 1 + j)),
      stopIndex: li,
      cell: legs[li].cells[where.k],
    }
  }
  const cells = legs[li].cells
  return {
    past: [...legs.slice(0, li), toLeg(cells.slice(0, where.k + 1))],
    pastDwell: dwell.slice(0, li),
    hereBaseDwellS: 0,
    hereArriveS: point.arriveS,
    hereDepartS: point.departS,
    future: [seg(li, cells.slice(where.k)), ...legs.slice(li + 1).map((_, j) => seg(li + 1 + j))],
    stopIndex: null,
    cell: cells[where.k],
  }
}

/** Dwell at the crew's point so that they leave `extraS` after now (or on plan, whichever is later), plus any delay. */
function hereDwell(s: Split, elapsedS: number, extraS: number): number {
  return s.hereBaseDwellS + Math.max(0, elapsedS + extraS - s.hereDepartS)
}

function assemble(ctx: PlanContext, s: Split, hereDwellS: number, future: Segment[], o2UsedExtraS: number): EvaVerdict {
  const legs = [...s.past, ...future.map((f) => toLeg(f.cells))]
  const dwellS = [...s.pastDwell, hereDwellS, ...future.slice(0, -1).map((f) => f.endDwellS)]
  return evaluate(ctx, legs, dwellS, o2UsedExtraS)
}

// ---------- reading verdicts ----------

const noGoCodes = (v: EvaVerdict) => v.reasons.filter((r) => r.severity === 'no-go').map((r) => r.code)
const isGo = (v: EvaVerdict) => noGoCodes(v).length === 0

/** The first no-go reason of `worse` that `better` does not have (the limit that broke), else its first no-go. */
function newNoGo(worse: EvaVerdict, better: EvaVerdict | null): ReasonCode | null {
  const had = new Set(better ? noGoCodes(better) : [])
  const codes = noGoCodes(worse)
  return codes.find((c) => !had.has(c)) ?? codes[0] ?? null
}

const notable = (v: EvaVerdict) => v.reasons.filter((r) => r.severity !== 'info')

// ---------- shared numbers ----------

interface Now {
  plan: EvaVerdict
  split: Split
  elapsedS: number
  o2UsedS: number
  /** O₂ used beyond the plan's clock (positive = faster consumption), s */
  o2ExtraS: number
  startMs: number
}

function prepare(ctx: PlanContext, snap: Snapshot): Now | null {
  const dwell = dwellsOf(ctx)
  const plan = evaluate(ctx, ctx.legs, dwell, 0)
  const s = split(ctx, plan, snap.index)
  if (!s) return null
  const o2UsedS = snap.o2UsedS ?? snap.elapsedS
  return { plan, split: s, elapsedS: snap.elapsedS, o2UsedS, o2ExtraS: o2UsedS - snap.elapsedS, startMs: Date.parse(ctx.startTime) }
}

// Whole minutes, rounded toward the safe side, ignoring float noise from summing the same steps in another order.
const EPS = 1e-6
const floorMin = (s: number) => Math.floor(s / 60 + EPS)
const ceilMin = (s: number) => Math.ceil(s / 60 - EPS)
const roundMin = (s: number) => Math.round(s / 60)
const clock = (ctx: PlanContext, now: Now, s: number) => marsClockAt(now.startMs, s, ctx.lonEast)

function commonNumbers(ctx: PlanContext, now: Now, v: EvaVerdict): WhatIfNumbers {
  const p = ctx.params
  const usable = p.o2DurationS - now.o2ExtraS - p.o2ReserveS
  const home = ctx.walkHome[now.split.cell]
  const margin = usable - (now.elapsedS + p.walkHomeContingency * home)
  const sunset = findSunset(ctx.conditions, now.startMs)
  const end = v.stats ? now.startMs + v.stats.totalS * 1000 : null
  return {
    o2_left_min: floorMin(p.o2DurationS - now.o2UsedS),
    pnr_in_min: Number.isFinite(margin) ? floorMin(margin) : -Infinity,
    head_back_by: null,
    head_back_in_min: null,
    sunset_margin_min: sunset !== null && end !== null ? floorMin((sunset - end) / 1000) : null,
    dose_msv: Math.round(evaDoseMSv(v.stats?.totalS ?? now.elapsedS) * 100) / 100,
    o2_at_return_min: v.stats ? floorMin(usable - v.stats.totalS) : null,
  }
}

type ResultFields = Omit<Partial<WhatIfResult>, 'numbers'> & Pick<WhatIfResult, 'intent' | 'verdict'> & { numbers?: Partial<WhatIfNumbers> }

function result(ctx: PlanContext, now: Now | null, fields: ResultFields, v: EvaVerdict | null): WhatIfResult {
  const numbers = now && v ? commonNumbers(ctx, now, v) : emptyNumbers(ctx)
  return {
    requested_min: null,
    allowed_min: null,
    binding: null,
    reasons: v ? notable(v) : [],
    subject: null,
    next_is_home: false,
    status: worstStatus('MODELED', v?.status ?? 'MODELED'),
    apply: null,
    ...fields,
    numbers: { ...numbers, ...fields.numbers },
  }
}

function emptyNumbers(ctx: PlanContext): WhatIfNumbers {
  return {
    o2_left_min: floorMin(ctx.params.o2DurationS),
    pnr_in_min: 0,
    head_back_by: null,
    head_back_in_min: null,
    sunset_margin_min: null,
    dose_msv: 0,
    o2_at_return_min: null,
  }
}

/** An answer that is not a budget (walk over, place not on the plan, …). */
function notApplicable(ctx: PlanContext, now: Now | null, intent: Intent, binding: CopilotCode, subject: string | null): WhatIfResult {
  return result(ctx, now, { intent, verdict: 'NO_GO', binding, subject, reasons: [] }, now?.plan ?? null)
}

/** Departure (EVA s) from the end of future segment `fi` in verdict v built from split s. */
function departAfterSegment(v: EvaVerdict, s: Split, fi: number): number | null {
  if (!v.stats) return null
  const leg = s.past.length + fi
  let out: number | null = null
  for (const p of v.stats.track) if (p.leg === leg) out = p.departS
  return out
}

// ---------- the five questions ----------

/**
 * "Can we stay N more minutes (here / at <stop>)?" Here: N minutes from now. At a stop still ahead: N minutes beyond
 * its planned dwell. minutes = null asks for the maximum. Searches 0..MAX_EXTRA_MIN in whole minutes.
 */
export function extendStay(ctx: PlanContext, snap: Snapshot, minutes: number | null, stopId: string | null = null): WhatIfResult {
  const now = prepare(ctx, snap)
  if (!now) return notApplicable(ctx, null, 'extend_stay', 'WALK_DONE', null)
  const s = now.split
  let at: 'here' | number = 'here'
  let subject = s.stopIndex !== null ? ctx.stops[s.stopIndex].name : 'here'
  if (stopId !== null) {
    const si = ctx.stops.findIndex((x) => x.id === stopId)
    if (si < 0) return notApplicable(ctx, now, 'extend_stay', 'NOT_ON_PLAN', stopId)
    subject = ctx.stops[si].name
    if (si !== s.stopIndex) {
      const fi = s.future.findIndex((f) => f.stopIndex === si)
      if (fi < 0) return notApplicable(ctx, now, 'extend_stay', 'ALREADY_LEFT', subject)
      at = fi
    }
  }

  const run = (m: number): EvaVerdict => {
    if (at === 'here') return assemble(ctx, s, hereDwell(s, now.elapsedS, m * 60), s.future, now.o2ExtraS)
    const future = s.future.map((f, i) => (i === at ? { ...f, endDwellS: f.endDwellS + m * 60 } : f))
    return assemble(ctx, s, hereDwell(s, now.elapsedS, 0), future, now.o2ExtraS)
  }

  const requested = minutes === null ? null : Math.max(0, Math.min(MAX_EXTRA_MIN, Math.round(minutes)))
  const zero = run(0)
  let allowed: number
  let binding: ReasonCode | null
  if (!isGo(zero)) {
    allowed = 0
    binding = newNoGo(zero, null)
  } else if (isGo(run(MAX_EXTRA_MIN))) {
    allowed = MAX_EXTRA_MIN
    binding = null
  } else {
    // Largest whole minute that is still GO: more time only ever adds no-go reasons (O₂, PNR, sunset, radiation).
    let lo = 0
    let hi = MAX_EXTRA_MIN
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (isGo(run(mid))) lo = mid
      else hi = mid
    }
    allowed = lo
    binding = newNoGo(run(lo + 1), run(lo))
  }

  const verdict: WhatIfVerdict = requested === null ? (allowed >= 1 ? 'GO' : 'NO_GO') : allowed >= requested ? 'GO' : allowed >= 1 ? 'PARTIAL' : 'NO_GO'
  const chosen = requested === null ? allowed : Math.min(requested, allowed)
  const v = run(chosen)
  // Leave-by time: from here, or from the stop ahead.
  const leaveS = at === 'here' ? Math.max(now.elapsedS + chosen * 60, s.hereDepartS) : departAfterSegment(v, s, at)
  const nextIsHome = (at === 'here' ? s.future[0] : s.future[at + 1])?.stopIndex === null
  const refused = requested !== null && requested > allowed ? run(requested) : v
  const extraS = at === 'here' ? Math.max(0, now.elapsedS + chosen * 60 - s.hereDepartS) : chosen * 60
  return result(
    ctx,
    now,
    {
      intent: 'extend_stay',
      verdict,
      requested_min: requested,
      allowed_min: allowed,
      binding: verdict === 'GO' && requested !== null ? binding : binding,
      subject,
      next_is_home: nextIsHome,
      reasons: notable(refused),
      numbers: {
        ...commonNumbers(ctx, now, v),
        head_back_by: leaveS !== null && verdict !== 'NO_GO' ? clock(ctx, now, leaveS) : verdict === 'NO_GO' ? clock(ctx, now, now.elapsedS) : null,
        head_back_in_min: leaveS !== null && verdict !== 'NO_GO' ? Math.max(0, floorMin(leaveS - now.elapsedS)) : verdict === 'NO_GO' ? 0 : null,
      },
      apply:
        verdict === 'NO_GO' || extraS <= 0
          ? null
          : { kind: 'extend_stay', stopId: at === 'here' ? (s.stopIndex !== null ? ctx.stops[s.stopIndex].id : null) : ctx.stops[s.future[at].stopIndex!].id, extraS },
    },
    v,
  )
}

/** "Can we also visit <target>?" Inserted where it adds the least time among the legs still to walk. */
export async function addStop(ctx: PlanContext, snap: Snapshot, targetId: string, findPath: PathFinder): Promise<WhatIfResult> {
  const now = prepare(ctx, snap)
  if (!now) return notApplicable(ctx, null, 'add_stop', 'WALK_DONE', null)
  const target = ctx.targets.find((t) => t.id === targetId)
  if (!target) return notApplicable(ctx, now, 'add_stop', 'UNKNOWN_PLACE', targetId)
  const s = now.split
  const onPlan = ctx.stops.findIndex((x) => x.id === targetId)
  if (onPlan >= 0) {
    const ahead = onPlan === s.stopIndex || s.future.some((f) => f.stopIndex === onPlan)
    return notApplicable(ctx, now, 'add_stop', ahead ? 'ALREADY_PLANNED' : 'ALREADY_VISITED', target.name)
  }
  const tc = cellAt(ctx.prepared.grid, target.lat, target.lon)
  if (tc < 0 || !isPassable(ctx.prepared, tc)) return notApplicable(ctx, now, 'add_stop', 'NO_PATH_TO_TARGET', target.name)

  const base = assemble(ctx, s, hereDwell(s, now.elapsedS, 0), s.future, now.o2ExtraS)
  const starts = s.future.map((_, q) => (q === 0 ? s.cell : s.future[q - 1].cells[s.future[q - 1].cells.length - 1]))
  const ends = s.future.map((f) => f.cells[f.cells.length - 1])
  const [toTarget, fromTarget] = await Promise.all([Promise.all(starts.map((a) => findPath(a, tc))), Promise.all(ends.map((b) => findPath(tc, b)))])

  let best: { v: EvaVerdict; q: number } | null = null
  s.future.forEach((f, q) => {
    const a = toTarget[q]
    const b = fromTarget[q]
    if (!a || !b) return
    const future = [
      ...s.future.slice(0, q),
      { cells: a, endDwellS: SCIENCE_STOP_DWELL_MIN * 60, stopIndex: null, name: target.name },
      { ...f, cells: b },
      ...s.future.slice(q + 1),
    ]
    const v = assemble(ctx, s, hereDwell(s, now.elapsedS, 0), future, now.o2ExtraS)
    if (!v.stats) return
    // GO beats NO-GO, then shorter; under a second apart counts as a tie and the earlier insertion stays.
    const better = !best || (isGo(v) && !isGo(best.v)) || (isGo(v) === isGo(best.v) && v.stats.totalS < best.v.stats!.totalS - 1)
    if (better) best = { v, q }
  })
  if (!best) return notApplicable(ctx, now, 'add_stop', 'NO_PATH_TO_TARGET', target.name)
  const { v, q } = best as { v: EvaVerdict; q: number }
  const ok = isGo(v)
  const insertAt = s.future[q].stopIndex ?? ctx.stops.length
  return result(
    ctx,
    now,
    {
      intent: 'add_stop',
      verdict: ok ? 'GO' : 'NO_GO',
      binding: ok ? null : newNoGo(v, base),
      subject: target.name,
      numbers: { ...commonNumbers(ctx, now, v), extra_min: ceilMin(v.stats!.totalS - base.stats!.totalS) },
      apply: ok ? { kind: 'add_stop', targetId, insertAt } : null,
    },
    v,
  )
}

/** "What if we skip <stop>?" A stop ahead is cut out (one new leg past it); the current stop means leaving now. */
export async function skipStop(ctx: PlanContext, snap: Snapshot, stopId: string, findPath: PathFinder): Promise<WhatIfResult> {
  const now = prepare(ctx, snap)
  if (!now) return notApplicable(ctx, null, 'skip_stop', 'WALK_DONE', null)
  const s = now.split
  const si = ctx.stops.findIndex((x) => x.id === stopId)
  if (si < 0) return notApplicable(ctx, now, 'skip_stop', 'NOT_ON_PLAN', stopId)
  const name = ctx.stops[si].name
  const base = assemble(ctx, s, hereDwell(s, now.elapsedS, 0), s.future, now.o2ExtraS)

  let v: EvaVerdict
  if (si === s.stopIndex) {
    // Leave now: cut what is left of the planned dwell here.
    v = assemble(ctx, s, Math.max(0, now.elapsedS - s.hereArriveS), s.future, now.o2ExtraS)
  } else {
    const fi = s.future.findIndex((f) => f.stopIndex === si)
    if (fi < 0) return notApplicable(ctx, now, 'skip_stop', 'ALREADY_VISITED', name)
    const from = fi === 0 ? s.cell : s.future[fi - 1].cells[s.future[fi - 1].cells.length - 1]
    const next = s.future[fi + 1]
    const cells = await findPath(from, next.cells[next.cells.length - 1])
    if (!cells) return notApplicable(ctx, now, 'skip_stop', 'NO_PATH_TO_TARGET', name)
    v = assemble(ctx, s, hereDwell(s, now.elapsedS, 0), [...s.future.slice(0, fi), { ...next, cells }, ...s.future.slice(fi + 2)], now.o2ExtraS)
  }
  if (!v.stats || !base.stats) return notApplicable(ctx, now, 'skip_stop', 'NO_PATH_TO_TARGET', name)
  const ok = isGo(v)
  return result(
    ctx,
    now,
    {
      intent: 'skip_stop',
      verdict: ok ? 'GO' : 'NO_GO',
      binding: ok ? null : newNoGo(v, null),
      subject: name,
      numbers: {
        ...commonNumbers(ctx, now, v),
        saved_min: Math.max(0, floorMin(base.stats.totalS - v.stats.totalS)),
        head_back_by: clock(ctx, now, v.stats.totalS),
        head_back_in_min: null,
      },
      apply: { kind: 'skip_stop', stopId },
    },
    v,
  )
}

/**
 * "How long until we must turn back?" The latest moment to start home from here, from the tightest of: the point of
 * no return (emergency walk home at the slow pace must fit in the O₂ above reserve), back before sunset with the
 * margin, and in shelter before a radiation alert.
 */
export function timeLeft(ctx: PlanContext, snap: Snapshot): WhatIfResult {
  const now = prepare(ctx, snap)
  if (!now) return notApplicable(ctx, null, 'time_left', 'WALK_DONE', null)
  const s = now.split
  const p = ctx.params
  const v = assemble(ctx, s, hereDwell(s, now.elapsedS, 0), s.future, now.o2ExtraS)
  const home = ctx.walkHome[s.cell]
  if (!Number.isFinite(home)) return notApplicable(ctx, now, 'time_left', 'NO_HAVEN', null)
  const nowMs = now.startMs + now.elapsedS * 1000
  const usable = p.o2DurationS - now.o2ExtraS - p.o2ReserveS
  // The point of no return uses the engine's emergency walk home (fastest way, slow pace). For sunset and radiation:
  // when the plan's next station is the habitat, the crew walks the plan's route home, so count that walk if longer
  // (then "time left" and "can we stay longer" agree to the minute).
  const leaveS = departAfterSegment(v, s, -1) ?? now.elapsedS
  const planHome = s.future.length === 1 && v.stats ? v.stats.totalS - leaveS : 0
  const walkBack = Math.max(home, planHome)
  const deadlines: { code: ReasonCode; s: number }[] = [{ code: 'POINT_OF_NO_RETURN', s: usable - (now.elapsedS + p.walkHomeContingency * home) }]
  const sunset = findSunset(ctx.conditions, now.startMs)
  if (sunset !== null) deadlines.push({ code: 'SUNSET', s: (sunset - nowMs) / 1000 - p.sunsetMarginS - walkBack })
  const lastMs = ctx.conditions.length ? Date.parse(ctx.conditions[ctx.conditions.length - 1].time) : nowMs
  const alert = radiationAlertsIn(ctx.conditions, nowMs, lastMs)[0]
  if (alert) deadlines.push({ code: 'RADIATION', s: Math.max(Date.parse(alert.time) - nowMs, 0) / 1000 - walkBack })
  const bind = deadlines.reduce((a, b) => (b.s < a.s ? b : a))
  const ok = bind.s >= 0
  return result(
    ctx,
    now,
    {
      intent: 'time_left',
      verdict: ok ? 'GO' : 'NO_GO',
      binding: bind.code,
      numbers: {
        ...commonNumbers(ctx, now, v),
        head_back_by: clock(ctx, now, now.elapsedS + Math.max(0, bind.s)),
        head_back_in_min: Math.max(0, floorMin(bind.s)),
      },
    },
    v,
  )
}

/** The existing abort route from here to the nearer safe haven (the HUD's planAbort), as an answer. */
export interface AbortRoute {
  haven: string
  timeS: number
  distanceM: number
}

export function goHome(ctx: PlanContext, snap: Snapshot, abort: AbortRoute | null): WhatIfResult {
  const now = prepare(ctx, snap)
  if (!abort) return notApplicable(ctx, now, 'go_home', 'NO_HAVEN', null)
  const p = ctx.params
  const o2ExtraS = now?.o2ExtraS ?? 0
  const usable = p.o2DurationS - o2ExtraS - p.o2ReserveS
  const spare = usable - (snap.elapsedS + p.walkHomeContingency * abort.timeS)
  const ok = spare >= 0
  return result(
    ctx,
    now,
    {
      intent: 'go_home',
      verdict: ok ? 'GO' : 'NO_GO',
      binding: ok ? null : 'O2_BUDGET',
      subject: abort.haven,
      numbers: {
        to_safety_min: Math.max(1, roundMin(abort.timeS)),
        distance_m: Math.round(abort.distanceM / 10) * 10,
        spare_o2_min: floorMin(spare),
      },
      reasons: [],
      apply: { kind: 'go_home' },
    },
    now?.plan ?? null,
  )
}

// ---------- context for understanding ----------

export type StopState = 'done' | 'current' | 'next' | 'ahead'

/** The plan's stops as seen from the crew's position: what has been done, where they are, what comes next. */
export function stopStates(ctx: PlanContext, snap: Snapshot): { id: string; name: string; state: StopState }[] {
  const where = locate(ctx.legs, snap.index)
  return ctx.stops.map((st, i) => {
    if (where.done) return { id: st.id, name: st.name, state: 'done' }
    if (where.atStop && i === where.leg) return { id: st.id, name: st.name, state: 'current' }
    const firstAhead = where.atStop ? where.leg + 1 : where.leg
    return { id: st.id, name: st.name, state: i < firstAhead ? 'done' : i === firstAhead ? 'next' : 'ahead' }
  })
}

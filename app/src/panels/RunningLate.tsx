// Running late, on the tablet: spare time at the stop, "stay longer", and, when the rest of the walk no longer fits,
// which stops to drop (lowest priority first) with one button to do it.

import { useEffect, useMemo, useState } from 'react'
import type { RouteResult } from '../route/route'
import { formatDuration } from '../stats/format'
import type { ReasonCode } from '../stats/goNoGo'
import type { Priority, Spare } from '../stats/risk'
import type { Waypoint } from '../types'

export interface StopRef {
  /** 1-based stop number on the plan */
  number: number
  name: string
  priority: Priority
}

export type CutResult =
  | { kind: 'drop'; stops: StopRef[]; savedS: number; apply: { route: RouteResult; stops: Waypoint[] } }
  | { kind: 'none' }

/** What the planner gives the walk views to manage a late walk (App builds it on the plan's own judge). */
export interface RiskTools {
  /** how much longer the crew can stay at stop i (index into the stops) and stay GO; null when the plan is not GO */
  spareAt: (i: number) => Spare | null
  /** extra time already added at stop i, s */
  extraS: (i: number) => number
  /** stay longer (or shorter, never below the plan) at stop i */
  stayLonger: (i: number, deltaS: number) => void
  /** the stops after stop i in the order they would be dropped */
  dropOrder: (i: number) => StopRef[]
  /** the fewest lowest-priority stops after stop i to drop so the rest of the walk is GO again */
  cutsFrom: (i: number) => Promise<CutResult>
  applyCuts: (cut: Extract<CutResult, { kind: 'drop' }>) => void
}

/** The limit a spare time ends at, in a few words. */
export const LIMIT_WORDS: Partial<Record<ReasonCode, string>> = {
  O2_BUDGET: 'the O₂ reserve',
  POINT_OF_NO_RETURN: 'the point of no return',
  SUNSET: 'sunset',
  RADIATION: 'a radiation alert',
  DARK_START: 'darkness',
}

export const PRIORITY_WORD: Record<Priority, string> = { high: 'high', medium: 'medium', low: 'low' }

const STEP_S = 15 * 60

/**
 * `at` = index into the stops of the stop the crew is at, or heading to. The plan check reruns whenever the plan
 * changes (risk is rebuilt by the planner), e.g. after "stay longer".
 */
export function RunningLate({ risk, at, atStop, planGo }: { risk: RiskTools; at: number; atStop: boolean; planGo: boolean }) {
  const spare = useMemo(() => (atStop && planGo ? risk.spareAt(at) : null), [risk, at, atStop, planGo])
  const [cut, setCut] = useState<{ for: RiskTools; at: number; result: CutResult | null } | null>(null)

  useEffect(() => {
    if (planGo) return
    let alive = true
    setCut({ for: risk, at, result: null })
    risk
      .cutsFrom(at)
      .catch((): CutResult => ({ kind: 'none' }))
      .then((result) => alive && setCut({ for: risk, at, result }))
    return () => {
      alive = false
    }
  }, [risk, at, planGo])

  const extra = risk.extraS(at)
  const current = cut && cut.for === risk && cut.at === at ? cut.result : null

  return (
    <div className="late">
      {atStop && (
        <div className="late-row">
          <span>
            {extra > 0 && <strong>+{Math.round(extra / 60)} min here. </strong>}
            {planGo && spare && (spare.limit ? `${spare.minutes} min spare, then ${LIMIT_WORDS[spare.limit] ?? 'a no-go'}.` : `Over ${formatDuration(spare.minutes * 60)} spare.`)}
          </span>
          <span className="late-btns">
            {extra > 0 && (
              <button type="button" className="tablet-btn" onClick={() => risk.stayLonger(at, -STEP_S)}>
                −15 min
              </button>
            )}
            <button type="button" className="tablet-btn" onClick={() => risk.stayLonger(at, STEP_S)}>
              Stay 15 min longer
            </button>
          </span>
        </div>
      )}
      {!planGo && (
        <div className="late-cut" role="status">
          {current === null ? (
            <p>The rest of the walk no longer fits. Checking which stops to drop…</p>
          ) : current.kind === 'drop' ? (
            <>
              <p>
                <strong>The rest of the walk no longer fits.</strong> Drop{' '}
                {current.stops.map((s, k) => (
                  <span key={s.number}>
                    {k > 0 && (k === current.stops.length - 1 ? ' and ' : ', ')}
                    {s.number}. {s.name} ({PRIORITY_WORD[s.priority]} priority)
                  </span>
                ))}{' '}
                to stay GO{current.savedS >= 60 ? `: saves ${formatDuration(current.savedS)}` : ''}.
              </p>
              <button type="button" className="tablet-btn is-primary" onClick={() => risk.applyCuts(current)}>
                Drop {current.stops.length === 1 ? current.stops[0].name : `${current.stops.length} stops`}
              </button>
            </>
          ) : (
            <p>
              <strong>The rest of the walk no longer fits</strong>, and dropping the stops ahead does not fix it. Head back to safety: use Abort.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

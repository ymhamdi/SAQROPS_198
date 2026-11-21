// The copilot's state machine: question → understand → compute (engine) → answer text → (speech). One question at a
// time. Numbers on the card come from the WhatIfResult, never from any text.

import { useCallback, useRef, useState } from 'react'
import type { AbortPlan } from '../panels/Hud'
import { answerText, CAPABILITIES } from './templates'
import { isConfirm, parseRules, resolve, resolveClarify, type PlaceRef, type Resolution, type UnderstandContext } from './understand'
import { addStop, extendStay, goHome, skipStop, stopStates, timeLeft, type ApplyAction, type Intent, type PathFinder, type PlanContext, type Snapshot, type WhatIfResult } from './whatIf'

/** What the planner hands the copilot: the plan as judged, and the engine's path and abort functions. */
export interface CopilotPlan {
  ctx: PlanContext
  findPath: PathFinder
  /** fastest way from a cell to the nearer safe haven (the planner's planAbort) */
  planAbort: (cell: number) => AbortPlan | null
  /** applies a change to the plan; absent → the card offers no Apply for that kind */
  onApply?: (action: ApplyAction) => boolean
  /** which Apply kinds the planner supports */
  canApply?: (action: ApplyAction) => boolean
}

/** Where the crew is, from the HUD / tablet clock. */
export interface CopilotLive {
  t: number
  index: number
  cell: number
  /** the view's own abort (switches it to the abort screen) */
  onAbort?: () => void
  /** the simulated storm drill is on (answers it limits are labelled SIMULATED) */
  drill?: boolean
}

export type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'

export interface Timing {
  sttMs?: number
  understandMs?: number
  computeMs?: number
  explainMs?: number
  totalMs?: number
  /** where the understanding came from */
  source?: 'llm' | 'rules'
}

export interface Answer {
  question: string
  text: string
  result: WhatIfResult | null
  /** set while waiting for the crew to pick between places */
  clarify: PlaceRef[] | null
  applied: boolean
  at: number
  /** who worded the answer: the deterministic template, or the LLM (passed the number guard) */
  wording?: { text: string; source: 'llm' | 'template' }
  /** EVA clock when the question was asked, s: the answer is true as of then */
  evaT?: number
}

const elapsedClock = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** The understanding context sent with a question (also what the LLM sees). */
export function understandContext(ctx: PlanContext, snap: Snapshot): UnderstandContext {
  const stops = stopStates(ctx, snap)
  return {
    targets: ctx.targets.map((t) => ({ id: t.id, name: t.name })),
    stops,
    current_stop_id: stops.find((s) => s.state === 'current')?.id ?? null,
    eva_clock: elapsedClock(snap.elapsedS),
  }
}

/** Runs the engine for a resolved question. */
export async function compute(plan: CopilotPlan, live: CopilotLive, snap: Snapshot, r: Extract<Resolution, { kind: 'ask' }>): Promise<WhatIfResult | null> {
  const { ctx } = plan
  switch (r.intent) {
    case 'extend_stay':
      return extendStay(ctx, snap, r.minutes, r.targetId)
    case 'add_stop':
      return r.targetId ? addStop(ctx, snap, r.targetId, plan.findPath) : null
    case 'skip_stop':
      return r.targetId ? skipStop(ctx, snap, r.targetId, plan.findPath) : null
    case 'time_left':
      return timeLeft(ctx, snap)
    case 'go_home': {
      const abort = plan.planAbort(live.cell)
      return goHome(ctx, snap, abort && { haven: abort.haven, timeS: abort.timeS, distanceM: abort.distanceM })
    }
    default:
      return null
  }
}

/** Pluggable stages, so voice and the LLM can be added without changing the flow. */
export interface Stages {
  understand?: (text: string, uctx: UnderstandContext) => Promise<{ resolution: Resolution; source: 'llm' | 'rules' }>
  explain?: (result: WhatIfResult, template: string) => Promise<{ text: string; source: 'llm' | 'template' }>
  speak?: (text: string) => Promise<void>
  stopSpeaking?: () => void
}

/** Rules-only understanding (no server). */
export async function understandByRules(text: string, uctx: UnderstandContext): Promise<{ resolution: Resolution; source: 'rules' }> {
  return { resolution: resolve(text, parseRules(text, uctx), uctx), source: 'rules' }
}

export function useCopilot(plan: CopilotPlan, live: CopilotLive, stages: Stages = {}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [timing, setTiming] = useState<Timing>({})
  const [error, setError] = useState<string | null>(null)
  // The latest props, read when a question is asked (the clock moves every frame while the walk plays).
  const latest = useRef({ plan, live, stages })
  latest.current = { plan, live, stages }
  const pending = useRef<{ intent: Intent; minutes: number | null; options: PlaceRef[] } | null>(null)
  const last = useRef<Answer | null>(null)
  /** true while a question is being understood and computed (not while its answer is spoken: that can be interrupted) */
  const computing = useRef(false)

  const finish = useCallback(async (a: Answer, t: Timing) => {
    last.current = a
    setAnswer(a)
    setTiming(t)
    computing.current = false
    const { speak } = latest.current.stages
    if (speak) {
      setPhase('speaking')
      try {
        await speak(a.text)
      } catch {
        // the card still shows the answer
      }
      // Only if nothing else started meanwhile (push-to-talk pressed during the answer).
      setPhase((p) => (p === 'speaking' ? 'idle' : p))
    } else {
      setPhase('idle')
    }
  }, [])

  const applyAction = useCallback((): boolean => {
    const a = last.current
    const action = a?.result?.apply
    if (!a || !action || a.applied) return false
    const { plan: p, live: l } = latest.current
    let ok = false
    if (action.kind === 'go_home' && l.onAbort) {
      l.onAbort()
      ok = true
    } else if (p.onApply && (p.canApply?.(action) ?? true)) {
      ok = p.onApply(action)
    }
    if (ok) {
      const done = { ...a, applied: true }
      last.current = done
      setAnswer(done)
    }
    return ok
  }, [])

  /** Ask a question (typed, or a transcript). `sttMs` is the transcription time when it came from voice. */
  const ask = useCallback(
    async (question: string, sttMs?: number) => {
      const text = question.trim()
      if (!text || computing.current) return
      computing.current = true
      const { plan: p, live: l, stages: s } = latest.current
      s.stopSpeaking?.()
      setError(null)
      setPhase('thinking')
      const t0 = performance.now()
      const snap: Snapshot = { elapsedS: l.t, index: l.index }
      try {
        // "Confirm" right after an answer applies it.
        if (isConfirm(text) && last.current?.result?.apply && Date.now() - last.current.at < 60_000) {
          const ok = applyAction()
          await finish({ ...last.current!, question: text, text: ok ? 'Done. The plan is updated.' : 'I cannot apply that here; use the planner.' }, { totalMs: performance.now() - t0 })
          return
        }
        const uctx = understandContext(p.ctx, snap)
        let resolution: Resolution
        let source: 'llm' | 'rules' = 'rules'
        const tu = performance.now()
        const open = pending.current
        const picked = open ? resolveClarify(text, open.options) : null
        if (open && picked) {
          resolution = { kind: 'ask', intent: open.intent, minutes: open.minutes, targetId: picked }
        } else {
          const u = await (s.understand ?? understandByRules)(text, uctx)
          resolution = u.resolution
          source = u.source
        }
        pending.current = null
        const understandMs = performance.now() - tu

        if (resolution.kind === 'clarify') {
          pending.current = { intent: resolution.intent, minutes: resolution.minutes, options: resolution.options }
          await finish(
            { question: text, text: resolution.question, result: null, clarify: resolution.options, applied: false, at: Date.now(), evaT: snap.elapsedS },
            { understandMs, totalMs: performance.now() - t0 + (sttMs ?? 0), sttMs, source },
          )
          return
        }

        const tc = performance.now()
        const result = resolution.intent === 'unknown' ? null : await compute(p, l, snap, resolution)
        const computeMs = performance.now() - tc
        if (!result) {
          await finish({ question: text, text: CAPABILITIES, result: null, clarify: null, applied: false, at: Date.now(), evaT: snap.elapsedS }, { understandMs, computeMs, sttMs, source, totalMs: performance.now() - t0 + (sttMs ?? 0) })
          return
        }

        const template = answerText(result)
        const te = performance.now()
        let wording: Answer['wording'] = { text: template, source: 'template' }
        if (s.explain) {
          try {
            wording = await s.explain(result, template)
          } catch {
            // keep the template
          }
        }
        const explainMs = performance.now() - te
        const t: Timing = { sttMs, understandMs, computeMs, explainMs, source, totalMs: performance.now() - t0 + (sttMs ?? 0) }
        console.info(
          `[copilot] stt ${Math.round(sttMs ?? 0)} ms · understand ${Math.round(understandMs)} ms (${source}) · compute ${Math.round(computeMs)} ms · explain ${Math.round(explainMs)} ms (${wording.source}) · total ${Math.round(t.totalMs!)} ms`,
        )
        await finish({ question: text, text: wording.text, wording, result, clarify: null, applied: false, at: Date.now(), evaT: snap.elapsedS }, t)
      } catch (e) {
        computing.current = false
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    },
    [applyAction, finish],
  )

  const dismiss = useCallback(() => {
    setAnswer(null)
    pending.current = null
    setPhase((p) => (p === 'error' ? 'idle' : p))
  }, [])

  /** Stop the spoken answer (the card stays). */
  const stopSpeaking = useCallback(() => {
    latest.current.stages.stopSpeaking?.()
    setPhase((p) => (p === 'speaking' ? 'idle' : p))
  }, [])

  /** Whether the current answer's change can be applied in this view. */
  const canApply = (() => {
    const action = answer?.result?.apply
    if (!action || answer.applied) return false
    if (action.kind === 'go_home') return !!live.onAbort
    return !!plan.onApply && (plan.canApply?.(action) ?? true)
  })()

  return { phase, setPhase, answer, timing, error, setError, ask, apply: applyAction, canApply, dismiss, stopSpeaking }
}

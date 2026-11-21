import type { ReactNode } from 'react'
import { formatDistance, formatDuration } from '../stats/format'
import { StatusBadge } from '../ui/StatusBadge'
import { CheckIcon, CloseIcon, PartIcon, SpeakerIcon } from '../ui/icons'
import type { Answer, Timing } from './useCopilot'
import type { Binding, WhatIfResult } from './whatIf'

/** The binding limit in plain words: "Limit: back too close to sunset". */
const LIMIT: Partial<Record<Binding, string>> = {
  O2_BUDGET: 'the O₂ reserve',
  POINT_OF_NO_RETURN: 'the walk home would cut into the O₂ reserve',
  SUNSET: 'back too close to sunset',
  RADIATION: 'the radiation alert',
  DARK_START: 'the sun is not up',
  NO_PATH: 'no walkable path',
  NO_GO_CELLS: 'impassable ground',
  NO_HAVEN: 'no walkable way to a safe haven',
  NO_PATH_TO_TARGET: 'no walkable path to it',
  COMMS: 'out of radio line of sight too long',
  SPACE_WEATHER: 'the space-weather advisory',
}

/** Answers that are not a budget (place not on the plan, already visited, walk over): said as a sentence. */
const NOT_A_BUDGET: Binding[] = ['ALREADY_LEFT', 'ALREADY_PLANNED', 'ALREADY_VISITED', 'NOT_ON_PLAN', 'UNKNOWN_PLACE', 'WALK_DONE']

export type Tone = 'yes' | 'partly' | 'no' | 'info'

const min = (m: number) => formatDuration(m * 60)
const elapsed = (s: number) => `T+${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`

/** The verdict word first: YES / PARTLY / NO for decisions; what was asked for information. */
export function verdictOf(r: WhatIfResult): { word: string; tone: Tone } {
  if (r.intent === 'time_left') return r.verdict === 'NO_GO' ? { word: 'No time left', tone: 'no' } : { word: 'Time left', tone: 'info' }
  if (r.intent === 'go_home') return r.verdict === 'NO_GO' ? { word: 'Way home · short', tone: 'no' } : { word: 'Way home', tone: 'info' }
  if (r.binding === 'ALREADY_PLANNED') return { word: 'Already planned', tone: 'info' }
  if (r.verdict === 'GO') return { word: 'Yes', tone: 'yes' }
  if (r.verdict === 'PARTIAL') return { word: 'Partly', tone: 'partly' }
  return { word: 'No', tone: 'no' }
}

/** The one number that answers the question, and what it means. */
export function headline(r: WhatIfResult): { value: string; label: string } | null {
  const n = r.numbers
  if (r.binding && NOT_A_BUDGET.includes(r.binding)) return null
  switch (r.intent) {
    case 'extend_stay':
      return { value: min(r.allowed_min ?? 0), label: r.requested_min !== null ? `you can stay · asked ${r.requested_min} min` : 'you can stay' }
    case 'add_stop':
      return { value: `+${min(n.extra_min ?? 0)}`, label: `added walk and O₂ for ${r.subject ?? 'the stop'}` }
    case 'skip_stop':
      return { value: `−${min(n.saved_min ?? 0)}`, label: `saved by skipping ${r.subject ?? 'the stop'}` }
    case 'time_left':
      return { value: min(n.head_back_in_min ?? 0), label: 'until you must turn back' }
    case 'go_home':
      return { value: min(n.to_safety_min ?? 0), label: `to ${r.subject ?? 'safety'}${n.distance_m ? ` · ${formatDistance(n.distance_m)}` : ''}` }
    default:
      return null
  }
}

export function leaveLine(r: WhatIfResult): ReactNode {
  const n = r.numbers
  if (!n.head_back_by || r.intent === 'go_home') return null
  const verb = r.intent === 'skip_stop' ? 'Back by' : r.intent === 'time_left' ? 'Turn back by' : r.next_is_home ? 'Head back by' : 'Move on by'
  return (
    <p className="copilot-leave">
      {verb} <strong>{n.head_back_by}</strong> Mars local
      {n.head_back_in_min !== null && r.intent !== 'skip_stop' && <span> · in {min(n.head_back_in_min)}</span>}
    </p>
  )
}

export const ICON: Record<Tone, ReactNode> = {
  yes: <CheckIcon size={30} />,
  partly: <PartIcon size={30} />,
  no: <CloseIcon size={30} />,
  info: <SpeakerIcon size={30} />,
}

interface Props {
  answer: Answer
  timing: Timing
  variant: 'hud' | 'tablet'
  canApply: boolean
  /** the storm drill is on: a limit set by it is SIMULATED, not modelled from real weather */
  drill?: boolean
  onApply: () => void
  onDismiss: () => void
  /** pick an option of a clarifying question */
  onPick: (name: string) => void
}

/**
 * The answer: verdict word, the one number, the limit in plain words, the time to head back, then Apply / Confirm.
 * What was asked stays small at the bottom. Every number comes from the WhatIfResult.
 */
export function CopilotCard({ answer, timing, variant, canApply, drill = false, onApply, onDismiss, onPick }: Props) {
  const r = answer.result
  const v = r ? verdictOf(r) : null
  const head = r ? headline(r) : null
  const limit = r?.binding ? (LIMIT[r.binding] ?? null) : null
  const simulated = drill && r?.binding === 'RADIATION'
  const timingNote = timing.totalMs !== undefined ? `${timing.source ?? 'rules'} · ${(timing.totalMs / 1000).toFixed(1)} s` : undefined
  return (
    <section className={`copilot-answer is-${v?.tone ?? 'info'}`} aria-label="Copilot answer" title={timingNote}>
      <header className="copilot-verdict-row">
        {v ? (
          <p className="copilot-verdict">
            {ICON[v.tone]}
            <strong>{v.word}</strong>
          </p>
        ) : (
          <p className="copilot-verdict">
            <strong>{answer.clarify ? 'Which one?' : 'Copilot'}</strong>
          </p>
        )}
        <button type="button" className="copilot-icon-btn" aria-label="Dismiss answer" onClick={onDismiss}>
          <CloseIcon size={22} />
        </button>
      </header>

      {head && (
        <p className="copilot-big">
          <strong>{head.value}</strong>
          <span>{head.label}</span>
        </p>
      )}

      {limit && (
        <p className="copilot-limit">
          Limit: <strong>{limit}</strong>
        </p>
      )}

      {r && leaveLine(r)}

      {/* The spoken sentence: the main line when there is no number; on the tablet always; on the visor for screen readers. */}
      <p className={`copilot-say${head && variant === 'hud' ? ' is-sr-only' : ''}`} aria-live="polite">
        {answer.text}
      </p>

      {answer.clarify && (
        <div className="copilot-options" role="group" aria-label="Say or tap one">
          {answer.clarify.map((o) => (
            <button key={o.id} type="button" className="copilot-btn" onClick={() => onPick(o.name)}>
              {o.name}
            </button>
          ))}
        </div>
      )}

      {(canApply || answer.applied) && (
        <div className="copilot-actions">
          {canApply && (
            <button type="button" className="copilot-btn is-primary" onClick={onApply}>
              {r?.apply?.kind === 'go_home' ? 'Start abort' : 'Apply'}
            </button>
          )}
          {canApply && <span className="copilot-hint">or say “confirm”</span>}
          {answer.applied && (
            <span className="copilot-applied">
              <CheckIcon size={20} /> Applied to the plan
            </span>
          )}
        </div>
      )}

      <footer className="copilot-asked">
        <span>
          You asked “{answer.question}”{answer.evaT !== undefined && <> · at {elapsed(answer.evaT)}</>}
        </span>
        {r && <StatusBadge status={r.status} />}
        {simulated && <StatusBadge status="SIMULATED" />}
        {variant === 'tablet' && answer.wording?.source === 'llm' && <span>LLM wording, numbers checked</span>}
      </footer>
    </section>
  )
}

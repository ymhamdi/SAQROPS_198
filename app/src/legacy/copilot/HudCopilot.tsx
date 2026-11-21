import { useEffect, useState } from 'react'
import { StatusBadge } from '../ui/StatusBadge'
import { CheckIcon, OfflineIcon, RecordIcon, WorkingIcon } from '../ui/icons'
import { headline, ICON, leaveLine, verdictOf } from './CopilotCard'
import { usePushToTalk, VOICE_OFFLINE } from './PushToTalk'
import type { Answer, useCopilot } from './useCopilot'

/** How long an answer stays on the visor after it arrives, then it fades (it stays up while it is being spoken). */
export const ANSWER_SHOWN_MS = 8000
/** After the voice finishes, the answer stays at least this long. */
const AFTER_SPEECH_MS = 2500
/** A notice ("Voice offline", "Didn't catch that") clears itself after this. */
const NOTICE_MS = 4000
/** The fade itself (CSS, none under prefers-reduced-motion). */
const FADE_MS = 600

interface Props {
  copilot: ReturnType<typeof useCopilot>
  /** words whisper should expect (place names of the current data) */
  prompt: string
  /** server up and whisper loaded */
  ready: boolean
  /** the storm drill is on: a limit set by it is SIMULATED */
  drill: boolean
}

/** When the visor shows `answer`: until it has been up ANSWER_SHOWN_MS and its voice has finished, then it fades. */
function useAnswerShown(answer: Answer | null, speaking: boolean): 'shown' | 'fading' | 'gone' {
  const [state, setState] = useState<{ for: Answer | null; phase: 'shown' | 'fading' | 'gone' }>({ for: null, phase: 'gone' })
  const current = state.for === answer ? state.phase : answer ? 'shown' : 'gone'
  useEffect(() => {
    if (!answer || speaking) return
    const wait = Math.max(ANSWER_SHOWN_MS - (Date.now() - answer.at), AFTER_SPEECH_MS)
    const fade = setTimeout(() => setState({ for: answer, phase: 'fading' }), wait)
    const gone = setTimeout(() => setState({ for: answer, phase: 'gone' }), wait + FADE_MS)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [answer, speaking])
  return current
}

/**
 * The copilot on the visor: voice only and out of sight until used. The space bar stands in for a suit button. While
 * it listens or thinks, one status word sits at the bottom-right edge; an answer shows there in the same see-through
 * symbology (verdict, the one number, when to head back) and fades after about 8 s. Nothing stays up while idle.
 * Every number comes from the WhatIfResult; "confirm" by voice applies a change, as on the tablet.
 */
export function HudCopilot({ copilot, prompt, ready, drill }: Props) {
  usePushToTalk(copilot, prompt, ready, true)
  const { phase, answer, error, setError } = copilot
  const shown = useAnswerShown(answer, phase === 'speaking')

  // A notice clears itself: the visor has no dismiss button.
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), NOTICE_MS)
    return () => clearTimeout(id)
  }, [error, setError])

  const status =
    phase === 'listening'
      ? { key: 'listening', Icon: RecordIcon, word: 'Listening' }
      : phase === 'transcribing' || phase === 'thinking'
        ? { key: 'thinking', Icon: WorkingIcon, word: 'Thinking' }
        : error
          ? { key: 'notice', Icon: OfflineIcon, word: error === VOICE_OFFLINE ? 'Voice offline · ask on the tablet' : 'Didn’t catch that · try again' }
          : null

  const r = answer?.result ?? null
  const v = r ? verdictOf(r) : null
  const head = r ? headline(r) : null
  const simulated = drill && r?.binding === 'RADIATION'

  return (
    <div className="hud-voice">
      {answer && shown !== 'gone' && !status && (
        <section className={`hud-voice-answer is-${v?.tone ?? 'info'}${shown === 'fading' ? ' is-fading' : ''}`} aria-label="Copilot answer">
          <p className="hud-voice-verdict">
            {v && ICON[v.tone]}
            <strong>{v ? v.word : answer.clarify ? 'Which one?' : 'Copilot'}</strong>
          </p>
          {head ? (
            <p className="hud-voice-big">
              <strong>{head.value}</strong>
              <span>
                {head.label} {r && <StatusBadge status={r.status} />} {simulated && <StatusBadge status="SIMULATED" />}
              </span>
            </p>
          ) : (
            // No single number (information, a clarifying question): the spoken sentence is the answer.
            <p className="hud-voice-say">{answer.clarify ? `Say ${answer.clarify.map((o) => o.name).join(' or ')}.` : answer.text}</p>
          )}
          {r && leaveLine(r)}
          {copilot.canApply && <p className="hud-voice-hint">Say “confirm” to apply</p>}
          {answer.applied && (
            <p className="hud-voice-hint">
              <CheckIcon size={18} /> Applied to the plan
            </p>
          )}
        </section>
      )}
      {status && (
        <p className={`hud-voice-status is-${status.key}`} role="status">
          <status.Icon size={24} />
          {status.word}
        </p>
      )}
      {/* The whole spoken sentence, for screen readers: the visor shows only its key parts. */}
      <p className="copilot-say is-sr-only" aria-live="polite">
        {answer?.text ?? ''}
      </p>
    </div>
  )
}

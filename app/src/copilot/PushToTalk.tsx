import { useEffect, useRef } from 'react'
import { MicIcon, OfflineIcon, RecordIcon, SpeakerIcon, WorkingIcon } from '../ui/icons'
import { transcribeRemote } from './api'
import type { useCopilot } from './useCopilot'
import { createRecorder, stopSpeaking, voiceSupported, type Recorder } from './voice'

interface Props {
  copilot: ReturnType<typeof useCopilot>
  /** words whisper should expect (place names of the current data) */
  prompt: string
  /** server up and whisper loaded */
  ready: boolean
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

/** Said when the space bar is pressed with no voice available (no server, no microphone support). */
export const VOICE_OFFLINE = 'Voice offline'

/**
 * Push-to-talk without the button: the space bar anywhere in the view (except while typing) stands in for a suit
 * button. Releasing sends the clip to the server's speech-to-text, then asks the copilot. Pressing while it speaks
 * interrupts it. `start` / `finish` drive it from a button too. With `sayOffline`, pressing the space bar while voice
 * is unavailable sets the error VOICE_OFFLINE instead of doing nothing (the visor has no other way to say so).
 */
export function usePushToTalk(copilot: Props['copilot'], prompt: string, ready: boolean, sayOffline = false) {
  const rec = useRef<Recorder | null>(null)
  const held = useRef(false)
  const latest = useRef({ copilot, prompt })
  latest.current = { copilot, prompt }
  const supported = voiceSupported()
  const { phase } = copilot
  const blocked = !ready || !supported || phase === 'transcribing' || phase === 'thinking'

  const start = async () => {
    const c = latest.current.copilot
    if (held.current || c.phase === 'transcribing' || c.phase === 'thinking') return
    held.current = true
    stopSpeaking()
    c.setError(null)
    try {
      rec.current ??= createRecorder()
      await rec.current.start()
      // Released before the microphone opened: nothing to send.
      if (!held.current) return rec.current.cancel()
      c.setPhase('listening')
    } catch (e) {
      held.current = false
      c.setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone blocked: allow it in the browser, or type the question.' : 'No microphone: type the question.')
      c.setPhase('error')
    }
  }

  const finish = async () => {
    if (!held.current) return
    held.current = false
    const c = latest.current.copilot
    const clip = await rec.current?.stop()
    if (!clip) {
      c.setPhase('idle')
      return
    }
    c.setPhase('transcribing')
    const t0 = performance.now()
    const heard = await transcribeRemote(clip, latest.current.prompt)
    const sttMs = performance.now() - t0
    console.info(`[copilot] voice ${Math.round(sttMs)} ms round trip (whisper ${Math.round(heard?.ms ?? 0)} ms, ${heard?.model ?? 'failed'}, ${Math.round(clip.size / 1024)} kB)`)
    if (!heard) {
      c.setError('Voice did not get through: type the question, or try again.')
      c.setPhase('error')
      return
    }
    if (!heard.text) {
      c.setError('I did not catch that. Hold the button while you speak.')
      c.setPhase('idle')
      return
    }
    await c.ask(heard.text, sttMs)
  }

  // Space bar push-to-talk. Capture phase, so a focused HUD button is not also pressed.
  useEffect(() => {
    const live = ready && supported
    if (!live && !sayOffline) return
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (live) void start()
      else latest.current.copilot.setError(VOICE_OFFLINE)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (live) void finish()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
    // start/finish read the latest props through refs, so the listeners are bound once.
  }, [ready, supported, sayOffline])

  useEffect(() => () => rec.current?.release(), [])

  return { start, finish, supported, blocked }
}

/** Hold to talk: the big button (tablet), with the space bar too. */
export function PushToTalk({ copilot, prompt, ready }: Props) {
  const { start, finish, supported, blocked } = usePushToTalk(copilot, prompt, ready)
  const { phase } = copilot

  const listening = phase === 'listening'
  // Each state has its own glyph, word and outline, so it is told apart by shape and word, never by colour alone.
  const state = !supported
    ? { key: 'off', Icon: OfflineIcon, word: 'Voice off', sub: 'no microphone' }
    : !ready
      ? { key: 'off', Icon: OfflineIcon, word: 'Voice loading', sub: 'type meanwhile' }
      : phase === 'listening'
        ? { key: 'listening', Icon: RecordIcon, word: 'Listening', sub: 'release to send' }
        : phase === 'transcribing' || phase === 'thinking'
          ? { key: 'working', Icon: WorkingIcon, word: 'Working', sub: phase === 'transcribing' ? 'hearing you' : 'checking the budget' }
          : phase === 'speaking'
            ? { key: 'speaking', Icon: SpeakerIcon, word: 'Speaking', sub: 'hold to interrupt' }
            : phase === 'error'
              ? { key: 'error', Icon: OfflineIcon, word: 'No answer', sub: 'hold to try again' }
              : { key: 'idle', Icon: MicIcon, word: 'Hold to talk', sub: 'or hold the space bar' }
  return (
    <button
      type="button"
      className={`copilot-ptt is-${state.key}`}
      disabled={blocked && !listening}
      aria-pressed={listening}
      aria-label={`${state.word}: ${state.sub}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        void start()
      }}
      onPointerUp={() => void finish()}
      onPointerCancel={() => void finish()}
      onKeyDown={(e) => e.key === 'Enter' && !e.repeat && void start()}
      onKeyUp={(e) => e.key === 'Enter' && void finish()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <state.Icon size={30} />
      <span className="copilot-ptt-text">
        <strong>{state.word}</strong>
        <span>{state.sub}</span>
      </span>
    </button>
  )
}

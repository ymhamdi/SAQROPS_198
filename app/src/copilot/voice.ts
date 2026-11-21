// Voice in and out in the browser: a push-to-talk recorder (MediaRecorder) and speech synthesis (a local voice when
// there is one, so it works offline). Speech-to-text itself runs on the copilot server (faster-whisper).

import type { PlanContext } from './whatIf'
import { shortName } from './templates'

/** Longest clip recorded per press, ms (a question, not a monologue). */
export const MAX_CLIP_MS = 15_000
/** Presses shorter than this are treated as accidental, ms. */
export const MIN_CLIP_MS = 350

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']

export interface Recorder {
  start(): Promise<void>
  /** the clip, or null when nothing (or too little) was recorded */
  stop(): Promise<Blob | null>
  cancel(): void
  /** close the microphone */
  release(): void
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

/** A recorder that keeps the microphone stream open between questions (no permission prompt or start-up delay). */
export function createRecorder(): Recorder {
  let stream: MediaStream | null = null
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

  const halt = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  return {
    async start() {
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      chunks = []
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.start()
      startedAt = performance.now()
      timer = setTimeout(halt, MAX_CLIP_MS)
    },
    stop() {
      const r = rec
      if (!r || r.state === 'inactive') return Promise.resolve(null)
      const long = performance.now() - startedAt >= MIN_CLIP_MS
      return new Promise((resolve) => {
        r.onstop = () => resolve(long && chunks.length ? new Blob(chunks, { type: r.mimeType || mimeType || 'audio/webm' }) : null)
        halt()
      })
    },
    cancel() {
      if (rec) rec.onstop = null
      halt()
      chunks = []
    },
    release() {
      this.cancel()
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    },
  }
}

/**
 * Words whisper should expect (its initial_prompt): the place names of the current site data, read live, plus the
 * walk's vocabulary.
 */
export function whisperPrompt(ctx: PlanContext): string {
  const names = [...new Set([...ctx.stops.map((s) => s.name), ...ctx.targets.map((t) => t.name)].map(shortName))]
  return `Mars walk copilot. Boxwork ridge, hollow, habitat, rover, EV1, EV2, oxygen, point of no return, sunset. Places: ${names.join(', ')}.`
}

// ---------- speech out ----------

let chosen: SpeechSynthesisVoice | null = null

/** A local English voice if there is one (works offline), else any English voice. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  chosen = voices.find((v) => v.localService && /en-(us|gb)/i.test(v.lang)) ?? voices.find((v) => v.localService) ?? voices[0] ?? null
  return chosen
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

if (speechSupported()) window.speechSynthesis.addEventListener?.('voiceschanged', () => (chosen = null))

/** Speak, resolving when done (or interrupted). Never rejects. */
export function speak(text: string): Promise<void> {
  if (!speechSupported() || !text) return Promise.resolve()
  const synth = window.speechSynthesis
  synth.cancel()
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice()
    if (v) u.voice = v
    u.lang = v?.lang ?? 'en-US'
    u.rate = 1.05
    // Some engines never fire `end`: do not hang the copilot on it.
    const guard = setTimeout(resolve, 2000 + text.split(/\s+/).length * 600)
    u.onend = u.onerror = () => {
      clearTimeout(guard)
      resolve()
    }
    synth.speak(u)
  })
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}

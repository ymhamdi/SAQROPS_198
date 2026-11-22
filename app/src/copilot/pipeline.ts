// From a question (typed, spoken or a button) to the answer the tablet shows, and the line the PC logs (C7):
//   1. MAYDAY words first, by rules, before any understanding: the LLM never sees them (C6);
//   2. engagement questions and orders, by rules: the verdict without yes or no (C3), the refusal (C1, C5);
//   3. otherwise the local LLM, when it is ready, maps the question to an intent of the catalogue, within
//      `copilot.understandTimeoutMs`; slow, down, unsure or invalid, and the rules answer instead (C5);
//   4. PNR computes the answer from the snapshot (answers.ts): the LLM never gives a number, a consigne or an order.

import { H, v } from '../config'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { type Answer, answerFor, MAYDAY_SENT, refusal, verdictAnswer } from './answers'
import { INTENTS, type Intent } from './catalog'
import { understandRules, type Understanding } from './rules'

/** How the question was understood: LLM, rules, a catalogue button, or the SOS button. */
export type CopilotPath = 'llm' | 'regles' | 'bouton' | 'sos'

/** One exchange, as the PC logs it (C7). */
export interface CopilotEntry {
  id: string
  /** simulation time of the snapshot the answer was built from, s */
  t: number
  question: string
  /** the intent, or mayday / engagement / hors_liste */
  intent: string
  answer: string
  path: CopilotPath
  latencyMs: number
  mayday: boolean
}

/** What the LLM proposes; checked here before anything is used. */
export interface LlmGuess {
  intent: string
  room?: string | null
  door?: string | null
  confidence?: number
}

export type LlmUnderstand = (question: string, signal: AbortSignal) => Promise<LlmGuess | null>

export interface Reply {
  answer: Answer
  understanding: Understanding
  path: CopilotPath
  latencyMs: number
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const maydayAnswer = (): Answer => ({ kind: 'mayday', intent: null, text: MAYDAY_SENT, items: [], sources: [] })

/** The answer to an understanding: computed by PNR from the snapshot only. */
export function answerOf(u: Understanding, site: Site, s: Snapshot): Answer {
  switch (u.kind) {
    case 'mayday':
      return maydayAnswer()
    case 'engagement':
      return { ...verdictAnswer(s), kind: 'refusal' }
    case 'hors_liste':
      return refusal()
    case 'intent':
      return answerFor(u.intent, { room: u.room, door: u.door }, site, s)
  }
}

/** The LLM's guess, kept only if it names an intent of the list, a room and a door of the site, with enough confidence. */
export function checkGuess(g: LlmGuess | null, site: Site): Understanding | null {
  if (!g || typeof g.intent !== 'string') return null
  if (g.intent === 'hors_liste') return { kind: 'hors_liste', why: 'inconnu' }
  if (!(INTENTS as readonly string[]).includes(g.intent)) return null
  if (typeof g.confidence === 'number' && g.confidence < v(H.copilot.minConfidence)) return { kind: 'hors_liste', why: 'inconnu' }
  const room = site.rooms.some((r) => r.id === g.room) ? (g.room as string) : null
  const door = site.doors.some((d) => d.id === g.door && d.id.startsWith('d-')) ? (g.door as string) : null
  return { kind: 'intent', intent: g.intent as Intent, room, door }
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort()
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([run(ctl.signal).catch(() => null), late])
  } finally {
    clearTimeout(timer)
  }
}

/** A question in words (typed or spoken). `llm` is absent in rules mode. */
export async function respond(question: string, site: Site, s: Snapshot, llm?: LlmUnderstand): Promise<Reply> {
  const t0 = now()
  const rules = understandRules(question, site)
  const done = (understanding: Understanding, path: CopilotPath): Reply => ({ answer: answerOf(understanding, site, s), understanding, path, latencyMs: now() - t0 })
  // 1–2: MAYDAY, engagement and orders never wait for, nor reach, the LLM.
  if (rules.kind === 'mayday' || rules.kind === 'engagement' || (rules.kind === 'hors_liste' && rules.why === 'ordre')) return done(rules, 'regles')
  if (!llm) return done(rules, 'regles')
  const guess = checkGuess(await withTimeout((signal) => llm(question, signal), v(H.copilot.understandTimeoutMs)), site)
  if (!guess) return done(rules, 'regles')
  // The LLM is unsure but the rules found an intent: the rules answer.
  if (guess.kind === 'hors_liste' && rules.kind === 'intent') return done(rules, 'regles')
  if (guess.kind === 'intent' && rules.kind === 'intent' && guess.intent === rules.intent)
    return done({ ...guess, room: guess.room ?? rules.room, door: guess.door ?? rules.door }, 'llm')
  return done(guess, 'llm')
}

/** A button of the catalogue, or a room / door picked after one. */
export function respondButton(intent: Intent, target: { room: string | null; door: string | null }, site: Site, s: Snapshot): Reply {
  const t0 = now()
  return { answer: answerFor(intent, target, site, s), understanding: { kind: 'intent', intent, ...target }, path: 'bouton', latencyMs: now() - t0 }
}

/** The red SOS button: a MAYDAY, with no question to understand. */
export function respondSos(): Reply {
  return { answer: maydayAnswer(), understanding: { kind: 'mayday', words: 'SOS (bouton)' }, path: 'sos', latencyMs: 0 }
}

let seq = 0
/** The line the PC logs for one exchange (C7). */
export function entryOf(question: string, r: Reply, s: Snapshot): CopilotEntry {
  const u = r.understanding
  return {
    id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
    t: s.t,
    question,
    intent: u.kind === 'intent' ? u.intent : u.kind,
    answer: r.answer.text,
    path: r.path,
    latencyMs: Math.round(r.latencyMs),
    mayday: u.kind === 'mayday',
  }
}

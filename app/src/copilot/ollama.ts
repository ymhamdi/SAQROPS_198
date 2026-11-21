// The copilot's language model reached directly from the browser, for deployments with no copilot server (the static
// Vercel site). The address is an https tunnel to the crew laptop's Ollama, so the page can call it. Same prompt,
// schema and validation as server/llm.py; the model still only reads the question, and the engine computes every
// number. Any failure returns null and the rule parser answers.

import type { UnderstandContext, Understood } from './understand'
import { findRemote, validRemoteUrl } from './remote'
import { INTENTS, MAX_EXTRA_MIN } from './whatIf'

/** The model to ask (VITE_OLLAMA_MODEL at build time, else qwen3:8b). */
export const OLLAMA_MODEL: string = import.meta.env.VITE_OLLAMA_MODEL || 'qwen3:8b'

/** A usable Ollama base address: https, or plain http only for this machine (browsers block mixed content). */
export const validOllamaUrl = validRemoteUrl

/** Ollama reached directly, when it answers with the model: see remote.ts for where the address comes from. */
export function findOllama(gist?: string): Promise<string | null> {
  return findRemote('ollama', ollamaReady, gist)
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    return r.ok ? r : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** True when Ollama answers and has the model. */
export async function ollamaReady(base: string): Promise<boolean> {
  const r = await call(`${base}/api/tags`, {}, 4000)
  if (!r) return false
  try {
    const tags = (await r.json()) as { models?: { name: string }[] }
    return (tags.models ?? []).some((m) => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}:`))
  } catch {
    return false
  }
}

// ---------- the same request as server/llm.py ----------

const SYSTEM = `You classify one question an astronaut asks during a walk on Mars. Reply with JSON only.

intent is one of:
- extend_stay: they want to stay or work longer, here or at a named stop. minutes = how many more minutes they ask for (integer, "half an hour" = 30), or null if they ask how long they can stay.
- add_stop: they want to also visit a place that is not on the plan. target_id = that place.
- skip_stop: they want to skip or drop a stop of the plan. target_id = that stop.
- time_left: they ask how long until they must turn back, or how much time or oxygen is left.
- go_home: they ask for the fastest or safest way back, or want to abort.
- unknown: anything else.

Rules:
- target_id must be one of the listed ids, or null. "here" or "this stop" means the current stop.
- If the place they name could be more than one listed place, set target_id to null and put a short question in clarify_question naming the options. Otherwise clarify_question is null.
- minutes is null unless the intent is extend_stay. Never more than ${MAX_EXTRA_MIN}.
- Do not answer the question. Only classify it.`

const idsOf = (ctx: UnderstandContext) => [...new Set([...ctx.stops.map((s) => s.id), ...ctx.targets.map((t) => t.id)])]

export function understandSchema(ids: string[]) {
  return {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: [...INTENTS] },
      minutes: { anyOf: [{ type: 'integer', minimum: 1, maximum: MAX_EXTRA_MIN }, { type: 'null' }] },
      target_id: ids.length ? { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] } : { type: 'null' },
      clarify_question: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['intent', 'minutes', 'target_id', 'clarify_question'],
  }
}

export function understandPrompt(transcript: string, ctx: UnderstandContext): string {
  const stops = ctx.stops.map((s) => `- ${s.id}: ${s.name} (${s.state})`).join('\n') || '- none'
  const onPlan = new Set(ctx.stops.map((s) => s.id))
  const others = ctx.targets.filter((t) => !onPlan.has(t.id)).map((t) => `- ${t.id}: ${t.name}`).join('\n') || '- none'
  return `Stops on the plan:\n${stops}\n\nOther places that could be added:\n${others}\n\nCurrent stop: ${ctx.current_stop_id ?? 'none (walking between stops)'}\nWalk clock: ${ctx.eva_clock}\n\nQuestion: ${transcript}`
}

/** The model's reply checked like the server's Pydantic model; null when it does not validate. */
export function validateUnderstood(raw: unknown, ids: string[]): Understood | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.intent !== 'string' || !(INTENTS as readonly string[]).includes(o.intent)) return null
  const minutes = o.minutes
  if (minutes !== null && minutes !== undefined && !(Number.isInteger(minutes) && (minutes as number) >= 1 && (minutes as number) <= MAX_EXTRA_MIN)) return null
  const intent = o.intent as Understood['intent']
  const target = typeof o.target_id === 'string' && ids.includes(o.target_id) ? o.target_id : null
  const clarify = typeof o.clarify_question === 'string' && o.clarify_question.length <= 200 ? o.clarify_question : null
  return { intent, minutes: intent === 'extend_stay' ? ((minutes as number | null | undefined) ?? null) : null, target_id: target, clarify_question: clarify }
}

/** Ollama's understanding of one question, or null (unreachable, slow, invalid): then the rules answer. */
export async function understandDirect(base: string, transcript: string, ctx: UnderstandContext, timeoutMs = 8000): Promise<Understood | null> {
  const ids = idsOf(ctx)
  const body = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: understandPrompt(transcript, ctx) },
    ],
    format: understandSchema(ids),
    stream: false,
    think: false,
    keep_alive: '1h',
    options: { temperature: 0, num_predict: 160 },
  }
  const r = await call(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs)
  if (!r) return null
  try {
    const content = ((await r.json()) as { message?: { content?: string } }).message?.content ?? ''
    return validateUnderstood(JSON.parse(content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()), ids)
  } catch {
    return null
  }
}

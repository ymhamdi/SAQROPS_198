// Calls to the copilot server (server/): through the Vite proxy at /api when the app runs on the laptop, otherwise
// through the laptop's https tunnel (remote.ts says how the address is found). Every call has a timeout and returns
// null on any failure, so the copilot carries on with its deterministic path.

import type { UnderstandContext, Understood } from './understand'
import { findRemote } from './remote'
import type { WhatIfResult } from './whatIf'

const PATH = 'api/copilot'
/** Same origin: the Vite dev or preview server on the laptop proxies /api to the copilot server. */
const LOCAL = `${import.meta.env.BASE_URL}${PATH}`
/** Where calls go: the local proxy, or the laptop's server through its tunnel once that answered. */
let base = LOCAL

export interface Health {
  ok: boolean
  ollama: boolean
  model: string
  model_available: boolean
  llm_ready: boolean
  whisper_model: string | null
  whisper_loaded: boolean
}

async function call<T>(path: string, init: RequestInit, timeoutMs: number, at = base): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(at + path, { ...init, signal: ctrl.signal })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const healthAt = (at: string, timeoutMs: number) => call<Health>('/health', {}, timeoutMs, at).then((h) => (h?.ok ? h : null))

/**
 * Server health, or null when no server answers. Tries the server already in use, then the local proxy, then the
 * laptop's tunnel; later calls go to whichever answered.
 */
export async function fetchHealth(timeoutMs = 2000): Promise<Health | null> {
  if (base !== LOCAL) {
    const h = await healthAt(base, timeoutMs + 3000)
    if (h) return h
    base = LOCAL
  }
  const local = await healthAt(LOCAL, timeoutMs)
  if (local) return local
  let found: Health | null = null
  const remote = await findRemote('copilot', async (b) => !!(found = await healthAt(`${b}/${PATH}`, timeoutMs + 3000)))
  if (!remote || !found) return null
  base = `${remote}/${PATH}`
  return found
}

/** True when the server in use is the laptop's, reached through its tunnel. */
export function serverIsRemote(): boolean {
  return base !== LOCAL
}

export interface Transcribed {
  text: string
  /** whisper time on the server, ms */
  ms: number
  model: string | null
}

/** Speech to text on the server (faster-whisper), or null. `prompt` lists the words to expect (place names). */
export async function transcribeRemote(audio: Blob, prompt: string, timeoutMs = 15_000): Promise<Transcribed | null> {
  const form = new FormData()
  form.append('audio', audio, audio.type.includes('ogg') ? 'question.ogg' : audio.type.includes('mp4') ? 'question.m4a' : 'question.webm')
  form.append('prompt', prompt)
  const r = await call<{ ok: boolean; text: string; ms: number; model: string | null }>('/transcribe', { method: 'POST', body: form }, timeoutMs)
  return r?.ok ? { text: r.text, ms: r.ms, model: r.model } : null
}

/** The answer reworded by the LLM and passed by the server's number guard, or null (use the template). */
export async function explainRemote(template: string, result: WhatIfResult, timeoutMs = 5000): Promise<string | null> {
  const r = await call<{ text: string; source: 'llm' | 'template' }>('/explain', json({ template, result }), timeoutMs)
  return r?.source === 'llm' ? r.text : null
}

/** The LLM's understanding, or null (server down, LLM down / slow / invalid): then use the rule parser. */
export async function understandRemote(transcript: string, context: UnderstandContext, timeoutMs = 9000): Promise<Understood | null> {
  const r = await call<{ ok: boolean; understood: Understood | null }>('/understand', json({ transcript, context }), timeoutMs)
  return r?.ok && r.understood ? r.understood : null
}

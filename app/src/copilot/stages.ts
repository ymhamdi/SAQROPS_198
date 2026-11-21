// The copilot's stages, each falling back to the deterministic path: LLM understanding (through the copilot server, or
// Ollama directly when there is no server) → rule parser.

import { useEffect, useMemo, useState } from 'react'
import { explainRemote, fetchHealth, understandRemote, type Health } from './api'
import { wordingOk } from './guard'
import { findOllama, ollamaReady, understandDirect } from './ollama'
import { forSpeech } from './templates'
import { resolve } from './understand'
import { understandByRules, type Stages } from './useCopilot'
import { speak, stopSpeaking } from './voice'

/** How often the dock re-checks the server, ms (it may be started after the app, or the model may still load). */
const HEALTH_EVERY_MS = 15_000

/** Server health, polled while the dock is open; null while the server is unreachable. */
export function useServerHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let alive = true
    const check = () => fetchHealth().then((h) => alive && setHealth(h))
    check()
    const id = setInterval(check, HEALTH_EVERY_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return health
}

/**
 * Ollama reached directly (no copilot server, e.g. the static deployment): its address when it answers with the
 * model, else null. Checked only while the server is unreachable.
 */
export function useDirectOllama(serverUp: boolean): string | null {
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    if (serverUp) {
      setReady(null)
      return
    }
    let alive = true
    let base: string | null = null
    // Keep the address that answered; when it stops, look again (the tunnel may have restarted with a new address).
    const check = async () => {
      if (base && (await ollamaReady(base))) return
      base = await findOllama()
      if (alive) setReady(base)
    }
    check()
    const id = setInterval(check, HEALTH_EVERY_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [serverUp])
  return ready
}

/**
 * Stages for the current state: the server's LLM when it is loaded; otherwise Ollama directly when reachable; otherwise
 * rules, at once. Answers are spoken by the browser's speech synthesis when `speakAnswers` is on.
 */
export function useServerStages(health: Health | null, speakAnswers: boolean, llmWording: boolean, directOllama: string | null = null): Stages {
  return useMemo<Stages>(
    () => ({
      understand: async (text, uctx) => {
        if (health?.llm_ready) {
          const u = await understandRemote(text, uctx)
          if (u) return { resolution: resolve(text, u, uctx), source: 'llm' }
        } else if (directOllama) {
          const u = await understandDirect(directOllama, text, uctx)
          if (u) return { resolution: resolve(text, u, uctx), source: 'llm' }
        }
        return understandByRules(text, uctx)
      },
      // Optional polish: the LLM's wording only if both the server's guard and ours pass it; otherwise the template.
      explain:
        llmWording && health?.llm_ready
          ? async (result, template) => {
              const text = await explainRemote(template, result)
              return text && wordingOk(text, template, result) ? { text, source: 'llm' } : { text: template, source: 'template' }
            }
          : undefined,
      speak: speakAnswers ? (text) => speak(forSpeech(text)) : undefined,
      stopSpeaking,
    }),
    [health?.llm_ready, speakAnswers, llmWording, directOllama],
  )
}

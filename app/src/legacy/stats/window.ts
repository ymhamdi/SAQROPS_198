// Start-time window: what each possible start time does to the verdict, so the crew can pick a clear start.

import { shortReason } from './format'
import type { EvaVerdict, ReasonCode } from './goNoGo'

/** Cautions that depend on when the walk starts (others, like steep ground, are the same at any start). */
const TIME_DEPENDENT: ReasonCode[] = ['SPACE_WEATHER', 'NO_CONDITIONS']

export type WindowLevel = 'go' | 'caution' | 'nogo'

export interface WindowSlot {
  time: string
  /** Mars local time "HH:MM" */
  ltst: string
  level: WindowLevel
  /** the reason, first clause ("Space-weather advisory until 16:00 UTC"), or "Clear" */
  why: string
}

/** One start option judged: NO-GO, a start-dependent caution, or clear. */
export function windowLevel(v: EvaVerdict): { level: WindowLevel; why: string } {
  const nogo = v.reasons.find((r) => r.severity === 'no-go')
  if (nogo) return { level: 'nogo', why: shortReason(nogo.message) }
  const caution = v.reasons.find((r) => r.severity === 'caution' && TIME_DEPENDENT.includes(r.code))
  if (caution) return { level: 'caution', why: shortReason(caution.message) }
  return { level: 'go', why: 'Clear' }
}

/** A clear start to suggest when the chosen one is not clear: the first clear slot after it, else the first clear slot. */
export function betterStart(slots: WindowSlot[], current: string): WindowSlot | null {
  const now = slots.find((s) => s.time === current)
  if (!now || now.level === 'go') return null
  const t = Date.parse(current)
  return slots.find((s) => s.level === 'go' && Date.parse(s.time) > t) ?? slots.find((s) => s.level === 'go') ?? null
}

// R6: a NO-GO is latched. Once the verdict has gone NO-GO it stays NO-GO, whatever the computation says next, until
// the COS re-engages; that action is logged and broadcast.

import type { Reason, Verdict } from './verdict.ts'

export interface LatchLogEntry {
  /** simulation time, s */
  t: number
  action: 'NO-GO' | 'RE-ENGAGE'
  by: 'system' | 'COS'
  note: string
}

export interface Latch {
  latched: boolean
  /** the NO-GO that set the latch, kept for the record */
  cause: Reason[] | null
  log: LatchLogEntry[]
}

export const OPEN_LATCH: Latch = { latched: false, cause: null, log: [] }

/** Feeds the freshly computed verdict through the latch; returns what to show and the new latch. */
export function applyLatch(latch: Latch, computed: Verdict, t: number): { shown: Verdict; latch: Latch } {
  if (computed.verdict === 'NO-GO' && !latch.latched) {
    const next: Latch = {
      latched: true,
      cause: computed.reasons.filter((r) => r.severity === 'no-go'),
      log: [...latch.log, { t, action: 'NO-GO', by: 'system', note: computed.reasons.find((r) => r.severity === 'no-go')?.message ?? '' }],
    }
    return { shown: computed, latch: next }
  }
  if (!latch.latched) return { shown: computed, latch }
  if (computed.verdict === 'NO-GO') return { shown: computed, latch }
  // Computed GO while latched: stays NO-GO, with the original cause and why.
  const kept: Reason = {
    code: 'LATCHED',
    severity: 'no-go',
    message: 'NO-GO maintenu : seul le COS peut ré-engager',
    source: 'latch',
    status: 'MODELED',
  }
  return { shown: { verdict: 'NO-GO', reasons: [kept, ...(latch.cause ?? []), ...computed.reasons] }, latch }
}

/** The COS re-engages: the latch opens, the action is logged. */
export function reengage(latch: Latch, t: number, note = 'Ré-engagement décidé par le COS'): Latch {
  return { latched: false, cause: null, log: [...latch.log, { t, action: 'RE-ENGAGE', by: 'COS', note }] }
}

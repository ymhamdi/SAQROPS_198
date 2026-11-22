// The verdict and its reasons, shared by every view. A verdict is an aid: the decision belongs to the COS (R2).

import type { DataStatus } from '../types.ts'

export type Severity = 'no-go' | 'caution' | 'info'

export type ReasonCode =
  | 'NO_PATH'
  | 'AIR_BUDGET'
  | 'POINT_OF_NO_RETURN'
  | 'FLASHOVER_PREDICTED'
  | 'ROOM_FAILED'
  | 'ROOM_HOT'
  | 'RADIO'
  | 'HAZARD'
  | 'MODEL_DUMMY'
  | 'LATCHED'
  | 'ROOM_UNKNOWN'
  | 'DRONE_HOT'

/** Where a reason comes from: the AI and the indoor drone may only add reasons, never remove one (R1, R9). */
export type ReasonSource = 'rules' | 'ai' | 'air' | 'route' | 'latch' | 'drone'

export interface Reason {
  code: ReasonCode
  severity: Severity
  /** French, for the interface */
  message: string
  source: ReasonSource
  status: DataStatus
  /** the room it is about, if any */
  room?: number
}

export interface Verdict {
  verdict: 'GO' | 'NO-GO'
  reasons: Reason[]
}

const ORDER: Record<Severity, number> = { 'no-go': 0, caution: 1, info: 2 }

export function verdictOf(reasons: Reason[]): Verdict {
  return {
    verdict: reasons.some((r) => r.severity === 'no-go') ? 'NO-GO' : 'GO',
    reasons: [...reasons].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]),
  }
}

/** Shown with every verdict on the PC, the tablet and the printed card (R2). */
export const DECISION_COS = 'Décision : COS'

export type Surface = 'pc' | 'tablet' | 'card' | 'hud'

/**
 * The verdict line of a view. PC, tablet and card always carry « Décision : COS »; the HUD shows one short word, read
 * in under a second (R2).
 */
export function verdictLine(v: Verdict, surface: Surface): string {
  const word = v.verdict === 'GO' ? 'GO' : 'NO-GO'
  if (surface === 'hud') return word
  const first = v.reasons.find((r) => r.severity === 'no-go')
  return first ? `${word} : ${first.message} · ${DECISION_COS}` : `${word} · ${DECISION_COS}`
}

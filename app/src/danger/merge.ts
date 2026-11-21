// R1: the AI can only make a verdict worse (GO → NO-GO), never better. Its reasons are added to the rules'; nothing
// it says can remove a reason or lower a severity.

import { verdictOf, type Reason, type Verdict } from '../stats/verdict.ts'

export function mergeAi(base: Verdict, ai: Reason[]): Verdict {
  // Only additions: AI reasons are tagged as such; any 'info' the AI emits cannot outrank the base.
  const added = ai.map((r) => ({ ...r, source: 'ai' as const }))
  const merged = verdictOf([...base.reasons, ...added])
  if (base.verdict === 'NO-GO' && merged.verdict !== 'NO-GO') throw new Error('mergeAi: R1 violated')
  return merged
}

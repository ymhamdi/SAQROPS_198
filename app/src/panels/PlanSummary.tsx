// The plan the COS validated, as the team sees it: on the tablet and on the printed reflex card. The order of the objectives,
// the hours and pressures of the plan, the latest time to turn back and the fall-back exit. It comes from the rehearsal, so it
// says so (R12); its verdict carries « Décision : COS » (R2) and every number its label (R3). Never on the HUD.

import type { RehearsalPlan } from '../rehearsal/engine'
import { RehearsalFrame } from '../rehearsal/RehearsalBanner'
import { verdictLine } from '../stats/verdict'
import { Num } from '../ui/Num'
import { clock } from './clock'

export function PlanSummary({ plan, validatedAtS, surface }: { plan: RehearsalPlan; validatedAtS: number; surface: 'tablet' | 'card' }) {
  return (
    <RehearsalFrame className="plansum">
      <span className="plansum-kick">Plan validé par le COS · {clock(validatedAtS)}</span>
      <p>
        <strong>{verdictLine({ verdict: plan.verdict, reasons: plan.reasons }, surface)}</strong>
      </p>
      <ol className="rehearsal-timeline">
        {plan.timeline
          .filter((e) => e.kind !== 'turn-back')
          .map((e, k) => (
            <li key={k}>
              <time>{clock(e.tS)}</time> {e.label}
              {e.bar !== null && <Num value={Math.round(e.bar)} unit="bar" status={plan.status} />}
            </li>
          ))}
      </ol>
      {plan.turnBackS !== null && (
        <p>
          Demi-tour au plus tard à <strong>{clock(plan.turnBackS)}</strong> ({plan.turnBackAt})
        </p>
      )}
      {plan.fallback && (
        <p>
          Sortie de repli : {plan.fallback.name}, <Num value={Math.round(plan.fallback.timeS)} unit="s" status={plan.status} /> depuis le dernier objectif
        </p>
      )}
    </RehearsalFrame>
  )
}

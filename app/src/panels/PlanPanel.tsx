// PC cards for the first step of an intervention: the indoor drone's reconnaissance (what it saw, when, how sure), then the
// rehearsal and the plan it produces. The plan is a SIMULATION (R12): framed and labelled as such, and it only applies once
// the COS validates it. Every verdict carries « Décision : COS » (R2) and every number its label (R3).

import { confidenceAt } from '../knowledge/observation'
import type { RehearsalPlan } from '../rehearsal/engine'
import { RehearsalFrame } from '../rehearsal/RehearsalBanner'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { DECISION_COS, verdictLine } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { clock } from './clock'
import { ReasonList } from './ReasonList'

const INDOOR_LABEL = { ground: 'au sol', flown: 'vol terminé', refused: 'vol refusé' } as const

/** The indoor drone: launch it, and read what it brought back with the time each picture was taken and received. */
export function IndoorCard({ site, snap, onLaunch }: { site: Site; snap: Snapshot; onLaunch: () => void }) {
  const i = snap.indoor
  const unknown = snap.known.rooms.flatMap((k, r) => (k.unknown ? [site.rooms[r].short] : []))
  return (
    <section className="pc-card">
      <span className="pc-kick">Drone d’intérieur · {INDOOR_LABEL[i.status]}</span>
      <p className="pc-note">
        Il entre par une sortie, passe par les portes déjà ouvertes et n’en ouvre jamais ; au-delà d’une porte fermée, le local reste INCONNU. Observations simulées <StatusBadge status="SIMULATED" />
      </p>
      {i.reason && <p className="pc-note">{i.reason}</p>}
      <div className="pc-actions">
        <button type="button" className="pc-primary" disabled={i.status !== 'ground' || snap.team.mode !== 'standby'} onClick={onLaunch}>
          Lancer la reconnaissance intérieure
        </button>
      </div>
      {i.status === 'flown' && (
        <>
          <p className="pc-note">
            Vol de <Num value={Math.round(i.durationS)} unit="s" status="SIMULATED" />
            {i.pending > 0 && ` · ${i.pending} observation${i.pending > 1 ? 's' : ''} en zone morte radio, en attente de la liaison`}
          </p>
          <ul className="rehearsal-obs">
            {[...i.observations]
              .sort((a, b) => a.takenAtS - b.takenAtS)
              .map((o) => (
                <li key={o.id}>
                  {o.label}{' '}
                  <Num value={Math.round(confidenceAt(o, snap.t) * 100)} unit="%" status={o.status} />
                  <small>
                    pris à {clock(o.takenAtS)} · reçu à {clock(o.receivedAtS)}
                  </small>
                </li>
              ))}
          </ul>
          {unknown.length > 0 && <p className="pc-note">INCONNU, aucune observation récente : {unknown.join(', ')}</p>}
        </>
      )}
    </section>
  )
}

/** The rehearsal and its plan: entry, order, hours, turn-back time, fall-back exit, risks, a GO or NO-GO per phase. */
export function PlanCard({ snap, plan, onRehearse, onValidate }: { snap: Snapshot; plan: RehearsalPlan | null; onRehearse: () => void; onValidate: (p: RehearsalPlan) => void }) {
  const validated = snap.plan
  const shown = validated?.plan ?? plan
  return (
    <RehearsalFrame>
      <span className="pc-kick">Répétition de l’intervention · plan</span>
      {!shown && (
        <>
          <p className="pc-note">PNR joue la mission prévue en avance rapide, sur ce qu’il sait (détecteurs, IA, drone), jamais sur la vérité du simulateur. Moins d’une seconde de calcul.</p>
          <div className="pc-actions">
            <button type="button" className="pc-primary" disabled={snap.team.mode !== 'standby'} onClick={onRehearse}>
              Lancer la répétition
            </button>
          </div>
        </>
      )}
      {shown && (
        <>
          <div className={`rehearsal-verdict is-${shown.verdict === 'GO' ? 'go' : 'nogo'}`} aria-live="polite">
            <strong>{shown.verdict}</strong>
            <span>{verdictLine({ verdict: shown.verdict, reasons: shown.reasons }, 'pc')}</span>
          </div>
          <p className="pc-note">
            {validated ? `Plan validé à ${clock(validated.validatedAtS)} (décision COS)` : `Calculée à ${clock(shown.builtAtS)}, maintenant ${clock(snap.t)}`} · <StatusBadge status={shown.status} />
          </p>
          <ol className="rehearsal-timeline">
            {shown.timeline
              .filter((e) => e.kind !== 'turn-back')
              .map((e, k) => (
              <li key={k}>
                <time>{clock(e.tS)}</time> {e.label}
                {e.bar !== null && <Num value={Math.round(e.bar)} unit="bar" status={shown.status} />}
              </li>
            ))}
          </ol>
          {shown.turnBackS !== null && (
            <p>
              Demi-tour au plus tard à <strong>{clock(shown.turnBackS)}</strong> ({shown.turnBackAt})
            </p>
          )}
          {shown.fallback && (
            <p className="pc-note">
              Sortie de repli : {shown.fallback.name}, <Num value={Math.round(shown.fallback.timeS)} unit="s" status={shown.status} /> depuis le dernier objectif
            </p>
          )}
          <p className="pc-note">Verdict par phase · {DECISION_COS}</p>
          <ul className="rehearsal-phases">
            {shown.phases.map((p, k) => (
              <li key={k} className={`is-${p.verdict === 'GO' ? 'go' : 'nogo'}`}>
                <strong>{p.label}</strong> · {p.verdict}
                <ReasonList reasons={p.reasons.filter((r) => r.severity !== 'info')} />
              </li>
            ))}
          </ul>
          {!validated && (
            <div className="pc-actions">
              <button type="button" className="pc-primary" disabled={snap.team.mode !== 'standby'} onClick={() => onValidate(shown)}>
                Valider le plan (décision COS)
              </button>
              <button type="button" onClick={onRehearse}>
                Refaire la répétition
              </button>
            </div>
          )}
        </>
      )}
    </RehearsalFrame>
  )
}

// Tablette du chef de binôme: verdict (« Décision : COS »), where to go, air, alerts and the PC's messages.
// Displays what the PC broadcasts; it does not simulate. Touch targets sized for gloves.

import { useEffect, useRef, useState } from 'react'
import { H, v } from '../config'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { verdictLine } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { nextStep } from './crew'
import { clock } from './Pc'
import { Plan } from './Plan'
import './crew.css'

export function Tablet({ site, snap }: { site: Site; snap: Snapshot | null }) {
  const lastPlan = useRef<number | null>(null)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  useEffect(() => {
    if (!snap) return
    if (lastPlan.current !== null && snap.planVersion !== lastPlan.current && snap.team.mode !== 'standby') {
      setRouteNote(`Nouvel itinéraire reçu du PC à ${clock(snap.t)}`)
    }
    lastPlan.current = snap.planVersion
  }, [snap])
  if (!snap) return <main className="crew-wait">Tablette : en attente du PC (ouvrez le PC dans une autre fenêtre).</main>
  const live = worstStatus('MODELED', snap.readingsStatus)
  const next = nextStep(site, snap)
  const alerts = snap.shown.reasons.filter((r) => r.severity !== 'info')
  const lastNote = snap.notes.at(-1)
  return (
    <main className={`tablet2 is-${snap.shown.verdict === 'GO' ? 'go' : 'nogo'}`}>
      <header className="tablet2-head">
        <span className="crew-kick">Tablette chef de binôme · {clock(snap.t)}</span>
        <StatusBadge status="SIMULATED" />
      </header>
      <section className="tablet2-verdict" aria-live="assertive">
        <h1>{snap.shown.verdict}</h1>
        <p>{verdictLine(snap.shown, 'tablet')}</p>
      </section>
      {(routeNote || lastNote) && (
        <section className="tablet2-msg" aria-live="assertive">
          <span className="crew-kick">Message du PC</span>
          {routeNote && <p>{routeNote}</p>}
          {lastNote && <p>{lastNote.text}</p>}
          {routeNote && (
            <button type="button" onClick={() => setRouteNote(null)}>
              Lu
            </button>
          )}
        </section>
      )}
      <section className="tablet2-next">
        <span className="crew-kick">{snap.team.mode === 'evacuating' ? 'Sortie' : 'Prochain'}</span>
        <h2>{next ? next.label : snap.team.mode === 'out' ? 'Binôme sorti' : 'En attente d’engagement'}</h2>
        {next && (
          <p>
            <Num value={next.distanceM} unit="m" status={live} /> par l'itinéraire
          </p>
        )}
      </section>
      <dl className="tablet2-gauges">
        <div>
          <dt>Pression ARI</dt>
          <dd>
            <Num value={snap.team.bar} unit="bar" status={live} />
          </dd>
        </div>
        <div>
          <dt>À la sortie</dt>
          <dd>
            <Num value={snap.team.exitBar} unit="bar" status={live} />
          </dd>
        </div>
        <div>
          <dt>Marge PNR</dt>
          <dd>
            <Num value={snap.team.pnrMarginBar} unit="bar" status={live} />
          </dd>
        </div>
        <div>
          <dt>Sifflet</dt>
          <dd>
            <Num value={v(H.ari.whistleBar)} unit="bar" status="MODELED" />
          </dd>
        </div>
      </dl>
      <section className="tablet2-alerts">
        <span className="crew-kick">Alertes</span>
        {alerts.length === 0 ? (
          <p>Aucune alerte.</p>
        ) : (
          <ul>
            {alerts.map((r, i) => (
              <li key={i} className={`is-${r.severity}`}>
                {r.severity === 'no-go' ? '⛔' : '⚠'} {r.message} <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="tablet2-map">
        <Plan site={site} snap={snap} truth={false} mode="view" onDoor={() => {}} onFire={() => {}} />
      </section>
    </main>
  )
}

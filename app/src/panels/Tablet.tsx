// Tablette du chef de binôme: verdict (« Décision : COS »), the phase of the mission, where to go, air, alerts and the
// PC's messages, beside a live map that follows the team. It displays what the PC broadcasts; it does not simulate.
// Touch targets sized for gloves.

import { useEffect, useRef, useState } from 'react'
import { H, v } from '../config'
import { CopilotPanel } from '../copilot/CopilotPanel'
import { demoHref } from '../demo/links'
import { LiveMap, type MapView } from '../scene/LiveMap'
import { MISSION_STEPS, missionOf } from '../scene/mission'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { verdictLine } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { nextStep } from './crew'
import { clock } from './Pc'
import { PlanSummary } from './PlanSummary'
import './crew.css'

/** Zoom steps of the map: 0 is the closest. */
const ZOOM_MAX = 2

export function Tablet({ site, snap }: { site: Site; snap: Snapshot | null }) {
  const lastPlan = useRef<number | null>(null)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const [mapView, setMapView] = useState<MapView>('heading')
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    if (!snap) return
    if (lastPlan.current !== null && snap.planVersion !== lastPlan.current && snap.team.mode !== 'standby') {
      setRouteNote(`Nouvel itinéraire reçu du PC à ${clock(snap.t)}`)
    }
    lastPlan.current = snap.planVersion
  }, [snap])
  if (!snap)
    return (
      <main className="crew-wait">
        <p>Tablette : en attente du PC (ouvrez le PC dans une autre fenêtre).</p>
        <a className="demo-link" href={demoHref('tablet')}>
          Lancer la démonstration automatique
        </a>
      </main>
    )
  const live = worstStatus('MODELED', snap.readingsStatus)
  const next = nextStep(site, snap)
  const alerts = snap.shown.reasons.filter((r) => r.severity !== 'info')
  const lastNote = snap.notes.at(-1)
  const mission = missionOf(snap)
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
      <section className="tablet2-mission" aria-label="Phase de la mission">
        <span className="crew-kick">Mission</span>
        <ol>
          {MISSION_STEPS.map((step, i) => {
            const state = i < mission.current ? 'is-past' : i === mission.current ? 'is-current' : ''
            const alarm = i === mission.current && step.id === 'exit' && mission.noGo
            return (
              <li key={step.id} className={`${state}${alarm ? ' is-nogo' : ''}`} aria-current={i === mission.current ? 'step' : undefined}>
                {i < mission.current ? '✓ ' : i === mission.current ? (alarm ? '⛔ ' : '● ') : ''}
                {step.label}
              </li>
            )
          })}
        </ol>
        <p>
          Objectifs faits <Num value={mission.objectives.done} unit={`/ ${mission.objectives.total}`} status="SIMULATED" />
        </p>
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
      {snap.plan && <PlanSummary plan={snap.plan.plan} validatedAtS={snap.plan.validatedAtS} surface="tablet" />}
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
      <CopilotPanel site={site} snap={snap} />
      <section className="tablet2-map" aria-label="Carte en direct">
        <div className="tablet2-maptools" role="toolbar" aria-label="Affichage de la carte">
          <button type="button" aria-pressed={mapView === 'heading'} onClick={() => setMapView('heading')}>
            Cap en haut
          </button>
          <button type="button" aria-pressed={mapView === 'north'} onClick={() => setMapView('north')}>
            Nord en haut
          </button>
          <button type="button" aria-pressed={mapView === 'fit'} onClick={() => setMapView('fit')}>
            Plan complet
          </button>
          <button type="button" className="is-zoom" aria-label="Zoom avant" disabled={mapView === 'fit' || zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            +
          </button>
          <button type="button" className="is-zoom" aria-label="Zoom arrière" disabled={mapView === 'fit' || zoom === ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 1))}>
            −
          </button>
        </div>
        <LiveMap site={site} snap={snap} view={mapView} zoom={zoom} />
        <p className="tablet2-legend">
          Locaux teintés d’après leurs détecteurs · contour rouge pointillé : alerte IA · ◆ objectifs · ● binôme <StatusBadge status="SIMULATED" />
        </p>
      </section>
    </main>
  )
}

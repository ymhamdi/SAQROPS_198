// Fiche réflexe binôme: one printable sheet with the verdict (« Décision : COS »), the mission, the air budget, the
// plan, the exits and the hazards met on the route with their sourced instructions (data/consignes.json).

import consignes from '../../../data/consignes.json' with { type: 'json' }
import { H, v } from '../config'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { DECISION_COS, verdictLine } from '../stats/verdict'
import type { DataStatus } from '../types'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { clock } from './Pc'
import { Plan } from './Plan'
import './card2.css'

type HazardKey = keyof typeof consignes.hazards

/** Hazards of the rooms the plan crosses, then the rest of the site's. */
export function hazardsFor(site: Site, track: number[]): { onRoute: HazardKey[]; elsewhere: HazardKey[] } {
  const known = new Set(Object.keys(consignes.hazards))
  const rooms = new Set(track.map((c) => site.room[c]).filter((r) => r >= 0))
  const onRoute = new Set<HazardKey>()
  const all = new Set<HazardKey>()
  site.rooms.forEach((room) => {
    for (const h of room.hazards) {
      if (!known.has(h)) continue
      all.add(h as HazardKey)
      if (rooms.has(room.index)) onRoute.add(h as HazardKey)
    }
  })
  for (const o of site.obstacles) for (const h of o.hazards) if (known.has(h)) all.add(h as HazardKey)
  return { onRoute: [...onRoute], elsewhere: [...all].filter((h) => !onRoute.has(h)) }
}

function Consignes({ keys }: { keys: HazardKey[] }) {
  return (
    <>
      {keys.map((k) => {
        const h = consignes.hazards[k]
        return (
          <div key={k} className="fiche-hazard">
            <h4>
              {h.name} <StatusBadge status={h.status as DataStatus} />
            </h4>
            <ul>
              {h.items.map((it, i) => (
                <li key={i}>
                  {it.text} <small>— {it.source}</small>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

export function Card({ site, snap, onClose }: { site: Site; snap: Snapshot; onClose: () => void }) {
  const live = worstStatus('MODELED', snap.readingsStatus)
  const { onRoute, elsewhere } = hazardsFor(site, snap.team.track.slice(snap.team.index))
  const objectives = snap.team.objectives.map((id) => site.objectives.find((o) => o.id === id)?.name ?? id)
  const exitDoor = snap.team.track.length ? site.doors[site.door[snap.team.track[snap.team.track.length - 1]]] : undefined
  return (
    <div className="fiche-backdrop" role="dialog" aria-label="Fiche réflexe binôme">
      <div className="fiche-tools">
        <button type="button" onClick={() => window.print()}>
          Imprimer
        </button>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <article className="fiche">
        <header>
          <div>
            <span className="fiche-kick">Fiche réflexe binôme · {clock(snap.t)}</span>
            <h1>{site.name}</h1>
          </div>
          <StatusBadge status="SIMULATED" />
        </header>
        <section className={`fiche-verdict is-${snap.shown.verdict === 'GO' ? 'go' : 'nogo'}`}>
          <strong>{verdictLine(snap.shown, 'card')}</strong>
        </section>
        <div className="fiche-cols">
          <section>
            <h3>Mission</h3>
            <ol>
              {objectives.length ? objectives.map((o) => <li key={o}>{o}</li>) : <li>Aucun objectif en cours</li>}
              <li>Sortie : {exitDoor ? exitDoor.name : '—'}</li>
            </ol>
            <h3>Air (ARI)</h3>
            <dl>
              <dt>Départ</dt>
              <dd>
                <Num value={v(H.ari.startBar)} unit="bar" status="MODELED" />
              </dd>
              <dt>Pression actuelle</dt>
              <dd>
                <Num value={snap.team.bar} unit="bar" status={live} />
              </dd>
              <dt>Prévue à la sortie</dt>
              <dd>
                <Num value={snap.team.exitBar} unit="bar" status={live} />
              </dd>
              <dt>Sifflet (EN 137)</dt>
              <dd>
                <Num value={v(H.ari.whistleBar)} unit="bar" status="MODELED" />
              </dd>
            </dl>
            <p className="fiche-note">
              Point de non-retour : sortir avant le sifflet, retour compté ×{v(H.ari.returnFactor)}. Consommation supposée {v(H.ari.consumptionApproachLpm)} L/min en
              progression, {v(H.ari.consumptionWorkLpm)} L/min au travail (MODELED).
            </p>
            <h3>Sorties</h3>
            <ul>
              {site.exits.map((e) => (
                <li key={e}>{site.doors[e].name}</li>
              ))}
            </ul>
          </section>
          <section className="fiche-plan">
            <Plan site={site} snap={snap} truth={false} mode="view" onDoor={() => {}} onFire={() => {}} />
          </section>
        </div>
        <section>
          <h3>Dangers sur l'itinéraire</h3>
          {onRoute.length ? <Consignes keys={onRoute} /> : <p>Aucun danger particulier relevé sur l'itinéraire.</p>}
          <h3>Autres dangers du site</h3>
          <Consignes keys={elsewhere} />
        </section>
        <footer>
          Aide à la décision · {DECISION_COS} · Consignes {consignes.validation} · Données de démonstration (SIMULATED)
        </footer>
      </article>
    </div>
  )
}

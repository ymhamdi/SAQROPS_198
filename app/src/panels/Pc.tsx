// PC du COS: the plan, the verdict with its reasons, the team's air and point of no return, objectives, rooms, log.
// Every number carries its label (R3); every verdict line carries « Décision : COS » (R2).

import { useState } from 'react'
import { H, v } from '../config'
import type { SimControls } from '../sim/client'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { verdictLine, type Reason } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { Card } from './Card'
import { Plan } from './Plan'
import './pc.css'

const MODE_LABEL = { standby: 'En attente', engaged: 'Engagé', evacuating: 'Évacuation', out: 'Sorti' } as const
const CONDITION_LABEL = { clear: 'Clair', smoke: 'Fumées', hot: 'Fumées chaudes', failed: 'Détecteurs HS' } as const
const DRONE_LABEL = { ground: 'au sol', flying: 'en vol', landed: 'posé', refused: 'vol refusé' } as const
const SOURCE_LABEL: Record<Reason['source'], string> = { rules: 'Règles', ai: 'IA', air: 'Air', route: 'Itinéraire', latch: 'Verrou' }

export const clock = (s: number) => `T+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="pc-reasons">
      {reasons.map((r, i) => (
        <li key={i} className={`is-${r.severity}`}>
          <span className="pc-src">{SOURCE_LABEL[r.source]}</span> {r.message} <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
  )
}

export function Pc({ site, sim, onOpenCrew }: { site: Site; sim: SimControls; onOpenCrew: (view: 'tablet' | 'hud') => void }) {
  const [truth, setTruth] = useState(false)
  const [mode, setMode] = useState<'doors' | 'fire'>('doors')
  const [card, setCard] = useState(false)
  const snap = sim.snap
  if (!snap) return <main className="pc-loading">{sim.error ?? 'Chargement de la simulation…'}</main>
  const s: Snapshot = snap
  const live = worstStatus('MODELED', s.readingsStatus)
  const toggleObjective = (id: string, name: string) => {
    const on = s.team.objectives.includes(id)
    const ids = on ? s.team.objectives.filter((x) => x !== id) : [...s.team.objectives, id]
    sim.act({ type: 'objectives', ids, note: on ? `Objectif « ${name} » retiré par le PC` : `Objectif « ${name} » ajouté par le PC` })
  }

  return (
    <main className="pc">
      <header className="pc-head">
        <div>
          <span className="pc-kick">PNR · PC du COS</span>
          <h1>{site.name}</h1>
        </div>
        <div className="pc-clock">
          <strong>{clock(s.t)}</strong> <StatusBadge status="SIMULATED" />
        </div>
        <div className="pc-controls">
          <button type="button" onClick={() => sim.setPlaying(!sim.playing)}>
            {sim.playing ? 'Pause' : 'Lecture'}
          </button>
          {v(H.sim.playbackSpeeds).map((x) => (
            <button key={x} type="button" aria-pressed={sim.speed === x} onClick={() => sim.setSpeed(x)}>
              ×{x}
            </button>
          ))}
          <button type="button" onClick={() => sim.reset()}>
            Réinitialiser
          </button>
        </div>
      </header>

      <section className="pc-map">
        <div className="pc-maptools">
          <button type="button" aria-pressed={mode === 'doors'} onClick={() => setMode('doors')}>
            Clic : ouvrir / fermer une porte
          </button>
          <button type="button" aria-pressed={mode === 'fire'} onClick={() => setMode('fire')}>
            Clic : départ de feu
          </button>
          <button type="button" onClick={() => sim.act({ type: 'fire', at: site.demo.fireAt })}>
            Départ de feu (scénario : stockage solvants)
          </button>
          <label>
            <input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Vérité simulateur <StatusBadge status="SIMULATED" />
          </label>
        </div>
        <Plan site={site} snap={s} truth={truth} mode={mode} showDrone onDoor={(door) => sim.act({ type: 'door', door })} onFire={(at) => (sim.act({ type: 'fire', at }), setMode('doors'))} />
        <p className="pc-legend">
          Locaux teintés d'après leurs détecteurs uniquement (gris fumées, orange fumées chaudes, rouge détecteurs hors service) · contour rouge pointillé : alerte IA · portes bleues
          ouvertes, grises fermées · ◆ objectifs · ● binôme · ✕ détecteur hors service · ◇ violet : drone, son trajet et l'image thermique des toits (SIMULATED, jamais utilisée pour le
          verdict)
        </p>
      </section>

      <aside className="pc-side">
        <section className={`pc-verdict is-${s.shown.verdict === 'GO' ? 'go' : 'nogo'}`} aria-live="assertive">
          <span className="pc-kick">Verdict de l'engagement</span>
          <h2>{s.shown.verdict}</h2>
          <p>{verdictLine(s.shown, 'pc')}</p>
          <ReasonList reasons={s.shown.reasons} />
          {s.latched && (
            <button type="button" className="pc-danger" onClick={() => sim.act({ type: 'reengage' })}>
              Ré-engager (décision COS)
            </button>
          )}
        </section>

        <section className="pc-card">
          <span className="pc-kick">Binôme · {MODE_LABEL[s.team.mode]}</span>
          <dl className="pc-gauges">
            <div>
              <dt>Pression ARI</dt>
              <dd>
                <Num value={s.team.bar} unit="bar" status={live} />
              </dd>
            </div>
            <div>
              <dt>À la sortie</dt>
              <dd>
                <Num value={s.team.exitBar} unit="bar" status={live} />
              </dd>
            </div>
            <div>
              <dt>Marge PNR</dt>
              <dd>
                <Num value={s.team.pnrMarginBar} unit="bar" status={live} />
              </dd>
            </div>
            <div>
              <dt>Sortie la plus proche</dt>
              <dd>
                <Num value={s.team.toExitS} unit="s" status={live} />
              </dd>
            </div>
          </dl>
          <p className="pc-note">
            Sifflet <Num value={v(H.ari.whistleBar)} unit="bar" status="MODELED" /> (EN 137) · retour ×{v(H.ari.returnFactor)}
          </p>
          <div className="pc-actions">
            {s.team.mode === 'standby' && (
              <button type="button" className="pc-primary" disabled={s.team.objectives.length === 0} onClick={() => sim.act({ type: 'engage' })}>
                Engager le binôme
              </button>
            )}
            {s.team.mode === 'engaged' && (
              <button type="button" className="pc-danger" onClick={() => sim.act({ type: 'evacuate' })}>
                Évacuation
              </button>
            )}
            <button type="button" onClick={() => setCard(true)}>
              Fiche réflexe
            </button>
            <button type="button" onClick={() => onOpenCrew('tablet')}>
              Ouvrir la tablette
            </button>
            <button type="button" onClick={() => onOpenCrew('hud')}>
              Ouvrir le HUD
            </button>
          </div>
        </section>

        <section className="pc-card">
          <span className="pc-kick">Drone de reconnaissance · {DRONE_LABEL[s.drone.status]}</span>
          <dl className="pc-gauges">
            <div>
              <dt>Batterie</dt>
              <dd>
                <Num value={s.drone.at?.batteryPct ?? (s.drone.status === 'ground' ? 100 : null)} unit="%" status="SIMULATED" />
              </dd>
            </div>
            <div>
              <dt>Marge PNR batterie</dt>
              <dd>
                <Num value={s.drone.status === 'flying' ? (s.drone.at?.marginPct ?? null) : null} unit="%" status="SIMULATED" />
              </dd>
            </div>
            <div>
              <dt>Vent (vers {Math.round((s.drone.wind.fromDeg + 180) % 360)}°)</dt>
              <dd>
                <Num value={s.drone.wind.speedMs} unit="m/s" status={s.drone.wind.status} digits={1} />
              </dd>
            </div>
            <div>
              <dt>Limite de vent</dt>
              <dd>
                <Num value={s.drone.maxWindMs} unit="m/s" status="MODELED" />
              </dd>
            </div>
          </dl>
          {s.drone.reason && <p className="pc-note">{s.drone.reason}</p>}
          {s.drone.roofC.some((c) => c !== null) && (
            <div className="pc-roofs">
              <span className="pc-kick">Image thermique des toits (affichage PC, jamais pour le verdict)</span>
              <ul>
                {site.rooms.map((room, r) =>
                  s.drone.roofC[r] === null ? null : (
                    <li key={room.id}>
                      {room.short} <Num value={s.drone.roofC[r]} unit="°C" status="SIMULATED" />
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
          <p className="pc-note">
            Retour à l'engin garanti avec <Num value={s.drone.reservePct} unit="%" status="MODELED" /> de réserve · vol simulé (tout vol réel en Tunisie exige une autorisation
            préalable)
          </p>
          <div className="pc-actions">
            <button type="button" className="pc-primary" disabled={s.drone.status === 'flying'} onClick={() => sim.act({ type: 'drone' })}>
              {s.drone.status === 'ground' ? 'Décoller le drone' : 'Relancer le drone'}
            </button>
          </div>
        </section>

        <section className="pc-card">
          <span className="pc-kick">Objectifs (ordre d'engagement)</span>
          <ul className="pc-list">
            {site.objectives.map((o) => {
              const done = s.team.done.includes(o.id)
              return (
                <li key={o.id}>
                  <label>
                    <input type="checkbox" disabled={done || s.team.mode === 'out'} checked={done || s.team.objectives.includes(o.id)} onChange={() => toggleObjective(o.id, o.name)} />{' '}
                    {o.name} {done && <em>fait</em>}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="pc-card">
          <span className="pc-kick">Locaux · détecteurs et IA</span>
          <table className="pc-rooms">
            <thead>
              <tr>
                <th>Local</th>
                <th>Plafond</th>
                <th>IA P(emb. ≤ 60 s)</th>
              </tr>
            </thead>
            <tbody>
              {site.rooms.map((room, r) => {
                const rv = s.rooms[r]
                return (
                  <tr key={room.id} className={rv.pred?.alert ? 'is-alert' : ''}>
                    <td>
                      {room.name}
                      <small>{CONDITION_LABEL[rv.condition]}</small>
                    </td>
                    <td>
                      <Num value={rv.tLastC} unit="°C" status={rv.status} />
                    </td>
                    <td>
                      {rv.pred ? (
                        <>
                          <Num value={rv.pred.p60 * 100} unit="%" status={rv.pred.status} />
                          <span className="pc-tff">
                            délai ≈ <Num value={Math.round(rv.pred.tffS / 5) * 5} unit="s" status={rv.pred.status} />
                          </span>
                        </>
                      ) : (
                        <small>hors modèle (halle)</small>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="pc-note">
            Modèle : {s.model.trainedOn} · seuils P30 {s.model.thresholds.p30.toFixed(2)} / P60 {s.model.thresholds.p60.toFixed(2)} (rappel ≥ 0,95 en validation){' '}
            {s.model.dummy && <strong>· MODÈLE FACTICE</strong>}
          </p>
        </section>

        <section className="pc-card">
          <span className="pc-kick">Journal</span>
          <ul className="pc-log">
            {[...s.latchLog.map((l) => ({ t: l.t, text: `${l.action === 'NO-GO' ? 'NO-GO' : 'Ré-engagement'} (${l.by === 'COS' ? 'COS' : 'système'}) ${l.note}` })), ...s.notes]
              .sort((a, b) => b.t - a.t)
              .slice(0, 8)
              .map((n, i) => (
                <li key={i}>
                  <span>{clock(n.t)}</span> {n.text}
                </li>
              ))}
          </ul>
        </section>
      </aside>
      {card && <Card site={site} snap={s} onClose={() => setCard(false)} />}
    </main>
  )
}

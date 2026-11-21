// The decision chain, live: fire → detectors → 13 variables → AI and rules → merge → route and air → verdict → screens.
// Every stage shows the numbers it holds right now, with their labels (R3); a stage flashes when its output changes.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { H, v } from '../config'
import { DEFAULT_THRESHOLD_RULE } from '../ml/thresholdRule'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { verdictLine } from '../stats/verdict'
import { worstStatus } from '../stats/status'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { chainOf } from './chainView'
import { featureRows } from './featureLabels'

const CONDITION_LABEL = { clear: 'Clair', smoke: 'Fumées', hot: 'Fumées chaudes', failed: 'Détecteurs HS' } as const
const MODE_LABEL = { standby: 'En attente', engaged: 'Engagé', evacuating: 'Évacuation', out: 'Sorti' } as const

/** A class that changes each time `signature` changes, so a CSS animation restarts. */
function usePulse(signature: string): string {
  const previous = useRef(signature)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (previous.current !== signature) {
      previous.current = signature
      setN((x) => x + 1)
    }
  }, [signature])
  return n === 0 ? '' : n % 2 === 1 ? 'pulse-a' : 'pulse-b'
}

function Stage({ step, title, what, signature, className = '', children }: { step: number; title: string; what: string; signature: string; className?: string; children: ReactNode }) {
  const pulse = usePulse(signature)
  return (
    <li className={`stage ${className} ${pulse}`}>
      <span className="stage-step">{step}</span>
      <h3>{title}</h3>
      <p className="stage-what">{what}</p>
      {children}
    </li>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stage-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function Chain({ site, snap, room }: { site: Site; snap: Snapshot; room: number }) {
  const c = chainOf(site, snap, room)
  const rv = snap.rooms[room]
  const live = worstStatus('MODELED', snap.readingsStatus)
  const rows = rv.features ? featureRows(rv.features) : null
  const missing = rows ? rows.filter((r) => r.value === null).length : 0
  const pred = rv.pred
  const aiLine = pred ? (pred.alert ? `Alerte : embrasement sous ${pred.horizonS} s` : 'Pas d’alerte') : 'Hors modèle (halle)'
  const verdictClass = snap.shown.verdict === 'GO' ? 'is-go' : 'is-nogo'
  return (
    <section className="twin-chain" aria-label="Chaîne de décision en direct">
      <header>
        <span className="twin-kick">Chaîne de décision en direct</span>
        <p>
          Une seconde simulée = un passage dans toute la chaîne. Local suivi : <strong>{c.roomName}</strong>.
        </p>
      </header>
      <ol>
        <Stage step={1} title="Monde réel" what="Le moteur feu simule l’incendie, local par local. Le système n’y a pas accès (R5)." signature={`${c.world.burning}-${c.world.flashed}`}>
          <dl>
            <Row label="Locaux en feu">
              <Num value={c.world.burning} status="SIMULATED" />
            </Row>
            <Row label="Locaux embrasés">
              <Num value={c.world.flashed} status="SIMULATED" />
            </Row>
            <Row label="Puissance max">
              <Num value={c.world.maxKw} unit="kW" status="SIMULATED" />
            </Row>
          </dl>
        </Stage>

        <Stage step={2} title="Détecteurs" what={`Les seuls capteurs : retard, bruit, hors service au-delà de ${v(H.detectors.failureC)} °C.`} signature={`${c.sensors.failed}`}>
          <dl>
            <Row label="En service">
              <Num value={c.sensors.total - c.sensors.failed} unit={`/ ${c.sensors.total}`} status={snap.readingsStatus} />
            </Row>
            <Row label="Hors service">
              <Num value={c.sensors.failed} status={snap.readingsStatus} />
            </Row>
            <Row label="Lecture du local">
              <Num value={c.sensors.roomReadingC} unit="°C" status={rv.status} />
            </Row>
          </dl>
        </Stage>

        <Stage step={3} title="Variables" what="13 variables par local sur 60 s. Un détecteur en panne = valeur manquante, jamais inventée." signature={`${missing}`}>
          {rows ? (
            <dl>
              <Row label="Variables">
                <Num value={rows.length} status={rv.status} />
              </Row>
              <Row label="Valeurs manquantes">
                <Num value={missing} unit={`/ ${rows.length}`} status={rv.status} />
              </Row>
              <Row label="Pente sur 30 s">
                <Num value={rows.find((r) => r.name === 'self_slope_30')?.value} unit="°C/s" status={rv.status} digits={2} />
              </Row>
            </dl>
          ) : (
            <p className="stage-off">Ce local est hors modèle : la halle n’a que la fumée et la température.</p>
          )}
        </Stage>

        <li className="stage-pair">
          <ol>
          <Stage step={4} title="IA (XGBoost)" what="Trois modèles, évalués dans le navigateur." signature={`${pred?.alert}-${pred?.horizonS}`} className={pred?.alert ? 'is-alert' : ''}>
            {pred ? (
              <dl>
                <Row label="P(emb. ≤ 30 s)">
                  <Num value={pred.p30 * 100} unit="%" status={pred.status} />
                </Row>
                <Row label="P(emb. ≤ 60 s)">
                  <Num value={pred.p60 * 100} unit="%" status={pred.status} />
                </Row>
                <Row label="Délai estimé">
                  <Num value={Math.round(pred.tffS / 5) * 5} unit="s" status={pred.status} />
                </Row>
              </dl>
            ) : null}
            <p className={pred?.alert ? 'stage-alert' : 'stage-note'}>{pred?.alert ? '⚠ ' : ''}{aiLine}</p>
            <p className="stage-note">
              Seuils ({snap.model.thresholdRule ?? DEFAULT_THRESHOLD_RULE}) : P30 {snap.model.thresholds.p30.toFixed(2)} · P60 {snap.model.thresholds.p60.toFixed(2)} <StatusBadge status="MODELED" />
            </p>
          </Stage>
          <Stage step={4} title="Règles sur détecteurs" what="Des seuils sur ce que disent les détecteurs." signature={`${c.rules.counts.failed}-${c.rules.counts.hot}-${c.rules.counts.smoke}`}>
            <dl className="stage-counts">
              {(Object.keys(CONDITION_LABEL) as (keyof typeof CONDITION_LABEL)[]).map((k) => (
                <Row key={k} label={CONDITION_LABEL[k]}>
                  <Num value={c.rules.counts[k]} unit="locaux" status={snap.readingsStatus} />
                </Row>
              ))}
            </dl>
            <p className="stage-note">Local suivi : {CONDITION_LABEL[c.rules.roomCondition]}</p>
          </Stage>
          </ol>
        </li>

        <Stage step={5} title="Fusion (R1)" what="L’IA peut ajouter des raisons, jamais en retirer : elle ne peut qu’aggraver." signature={`${c.merge.withoutAi}-${c.merge.withAi}`} className={c.merge.worsened ? 'is-alert' : ''}>
          <dl>
            <Row label="Sans l’IA">
              <strong className={`stage-word is-${c.merge.withoutAi === 'GO' ? 'go' : 'nogo'}`}>{c.merge.withoutAi}</strong>
            </Row>
            <Row label="Avec l’IA">
              <strong className={`stage-word is-${c.merge.withAi === 'GO' ? 'go' : 'nogo'}`}>{c.merge.withAi}</strong>
            </Row>
          </dl>
          <p className={c.merge.worsened ? 'stage-alert' : 'stage-note'}>{c.merge.worsened ? '⚠ L’IA a aggravé le verdict' : 'L’IA ne change pas le verdict'}</p>
        </Stage>

        <Stage step={6} title="Itinéraire et air" what="A* sur les coûts de route, puis air de l’ARI et point de non-retour sur tout le trajet." signature={`${snap.planVersion}-${snap.team.mode}`}>
          <dl>
            <Row label="Binôme">{MODE_LABEL[snap.team.mode]}</Row>
            <Row label="Plan n°">
              <Num value={snap.planVersion} status="SIMULATED" />
            </Row>
            <Row label="Sortie la plus proche">
              <Num value={snap.team.toExitS} unit="s" status={live} />
            </Row>
            <Row label="Pression · à la sortie">
              <Num value={snap.team.bar} unit="bar" status={live} />
              <Num value={snap.team.exitBar} unit="bar" status={live} />
            </Row>
            <Row label="Sifflet">
              <Num value={v(H.ari.whistleBar)} unit="bar" status="MODELED" />
            </Row>
          </dl>
        </Stage>

        <Stage step={7} title="Verdict" what="GO ou NO-GO avec ses raisons ; un NO-GO reste verrouillé (R6)." signature={`${snap.shown.verdict}-${snap.latched}`} className={`stage-verdict ${verdictClass}`}>
          <p className="stage-verdict-word" aria-live="assertive">
            {snap.shown.verdict}
          </p>
          <p className="stage-line">{verdictLine(snap.shown, 'pc')}</p>
          {snap.latched ? <p className="stage-note">Verrouillé : seul le COS ré-engage.</p> : null}
        </Stage>

        <Stage step={8} title="Écrans" what="Le PC diffuse, la tablette et le HUD affichent sans simuler." signature={`${snap.planVersion}-${snap.shown.verdict}`}>
          <ul className="stage-screens">
            <li>PC du COS</li>
            <li>Tablette du chef de binôme</li>
            <li>HUD du masque</li>
            <li>Fiche réflexe</li>
          </ul>
          <p className="stage-note">
            Liaison simulée entre fenêtres <StatusBadge status="SIMULATED" />
          </p>
        </Stage>
      </ol>
    </section>
  )
}

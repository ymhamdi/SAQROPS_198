// Jumeau numérique: a window that mirrors the PC's live simulation (like the tablet and the HUD) and shows how PNR works.
// Left, the simulated REALITY (fire, smoke, real temperatures); right, the TWIN: only what PNR knows (detectors, the
// model's alerts, the route). Between them and below, the chain that turns one into the other, and the curves.
// The reality is drawn for comparison only: it never feeds the verdict (R5). Every number carries its label (R3).

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import contract from '../../../ml/model/contract.json' with { type: 'json' }
import { H, v } from '../config'
import { clock } from '../panels/Pc'
import { Plan, PX, roomBoxes } from '../panels/Plan'
import type { Snapshot } from '../sim/protocol'
import { cellAt, type Site } from '../site/site'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { Chain } from './Chain'
import { niceTicks } from './chartMath'
import { featureRows } from './featureLabels'
import { leadS, pickFocus, pushSample, type TwinSample } from './history'
import { LineChart } from './LineChart'
import { RealityPlan } from './RealityPlan'
import './twin.css'

const noop = () => {}

/** The last tick of a nice scale covering `max`, so curves end on a labelled gridline. */
const niceMax = (max: number) => niceTicks(max, 4).at(-1) ?? max

/** Which room a click on a plan landed in, or null. */
function roomAt(site: Site, ev: MouseEvent<HTMLElement>): number | null {
  const cv = ev.currentTarget.querySelector('canvas')
  if (!cv) return null
  const rect = cv.getBoundingClientRect()
  const x = ((ev.clientX - rect.left) / rect.width) * cv.width
  const y = ((ev.clientY - rect.top) / rect.height) * cv.height
  const cell = cellAt(site, { x: (x / PX) * site.cellM, y: (y / PX) * site.cellM })
  const room = cell >= 0 ? site.room[cell] : -1
  return room >= 0 ? room : null
}

export function Twin({ site, snap }: { site: Site; snap: Snapshot | null }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [history, setHistory] = useState<TwinSample[]>([])
  const boxes = useMemo(() => roomBoxes(site), [site])
  useEffect(() => {
    if (snap) setHistory((h) => pushSample(h, snap))
  }, [snap])

  if (!snap) {
    return (
      <main className="twin-loading">
        <h1>PNR · Jumeau numérique</h1>
        <p>En attente du PC du COS…</p>
        <p>
          Ce jumeau reflète la simulation du PC en direct. Ouvrez le <strong>PC du COS</strong> dans ce navigateur puis cliquez sur <strong>Lecture</strong>, ou lancez ce jumeau avec le bouton
          « Ouvrir le jumeau numérique » du PC.
        </p>
      </main>
    )
  }

  const s = snap
  const focus = pickFocus(s, picked)
  const fr = s.rooms[focus]
  const tr = fr.truth
  const room = site.rooms[focus]
  const roomDets = site.detectors.flatMap((d, i) => (d.room === focus ? [i] : []))
  const roomFailed = roomDets.filter((i) => s.detectors[i].failed).length
  const lead = leadS(fr)
  const rows = fr.features ? featureRows(fr.features) : null
  const pred = fr.pred
  const onClickPlan = (ev: MouseEvent<HTMLElement>) => {
    const r = roomAt(site, ev)
    if (r !== null) setPicked(r)
  }
  const ring = (
    <div
      className="twin-ring"
      aria-hidden="true"
      style={{ left: `${(boxes[focus].x / (site.width * PX)) * 100}%`, top: `${(boxes[focus].y / (site.height * PX)) * 100}%`, width: `${(boxes[focus].w / (site.width * PX)) * 100}%`, height: `${(boxes[focus].h / (site.height * PX)) * 100}%` }}
    />
  )

  // Curves for the followed room.
  const xs = history.map((h) => h.t)
  const col = <T,>(pick: (r: TwinSample['rooms'][number]) => T) => history.map((h) => pick(h.rooms[focus]))
  const xMax = Math.max(s.t, contract.windowS)
  const tMax = niceMax(Math.max(v(H.fire.flashoverC), ...col((r) => r.truthC)))
  const remaining = history.map((h) => (tr.flashedAt !== null && h.t <= tr.flashedAt ? tr.flashedAt - h.t : null))
  const events = [
    ...(fr.firstAlertAt !== null ? [{ x: fr.firstAlertAt, label: '1re alerte IA', colour: '#d93025' }] : []),
    ...(tr.flashedAt !== null ? [{ x: tr.flashedAt, label: 'embrasement réel', colour: '#202124' }] : []),
  ]
  const noGoAt = s.latchLog.find((l) => l.action === 'NO-GO')?.t
  const predStatus = pred?.status ?? 'SIMULATED'
  const live = s.readingsStatus

  return (
    <main className="twin">
      <header className="twin-head">
        <div>
          <span className="twin-kick">PNR · Jumeau numérique</span>
          <h1>{site.name}</h1>
        </div>
        <div className="twin-clock">
          <strong>{clock(s.t)}</strong> <StatusBadge status="SIMULATED" />
        </div>
        <nav className="twin-focus" aria-label="Local suivi">
          <span className="twin-kick">Local suivi</span>
          <button type="button" aria-pressed={picked === null} onClick={() => setPicked(null)}>
            Auto
          </button>
          {site.rooms
            .filter((r) => r.flashoverModel)
            .map((r) => (
              <button key={r.id} type="button" aria-pressed={picked === r.index} onClick={() => setPicked(r.index)}>
                {s.rooms[r.index].pred?.alert ? '⚠ ' : ''}
                {r.short}
              </button>
            ))}
        </nav>
      </header>

      <section className="twin-worlds">
        <figure className="twin-panel is-real">
          <figcaption>
            <span className="twin-kick">Monde réel</span>
            <strong>Ce qui se passe vraiment</strong> <StatusBadge status="SIMULATED" />
          </figcaption>
          <div className="twin-canvaswrap" onClick={onClickPlan}>
            <RealityPlan site={site} snap={s} />
            {ring}
          </div>
          <div className="twin-scale" aria-label="Échelle de température de la couche chaude">
            <span>
              <Num value={v(H.fire.ambientC)} unit="°C" status="MODELED" />
            </span>
            <i />
            <span>
              <Num value={v(H.fire.postFlashoverC)} unit="°C" status="MODELED" />
            </span>
            <small>couche chaude · le gris sombre est la fumée</small>
          </div>
          <ul className="twin-facts">
            <li>
              Couche chaude : <Num value={tr.layerC} unit="°C" status="SIMULATED" />
            </li>
            <li>
              Fumée descendue à <Num value={tr.layerZ} unit="m du sol" status="SIMULATED" digits={1} />
            </li>
            <li>
              Puissance du feu : <Num value={tr.qKw} unit="kW" status="SIMULATED" />
            </li>
            <li>
              Embrasement :{' '}
              {tr.flashedAt !== null ? (
                <>
                  <strong>{clock(tr.flashedAt)}</strong> <StatusBadge status="SIMULATED" />
                </>
              ) : (
                'pas encore'
              )}
            </li>
          </ul>
        </figure>

        <figure className="twin-panel is-twin">
          <figcaption>
            <span className="twin-kick">Jumeau numérique</span>
            <strong>Ce que PNR en sait</strong> <StatusBadge status={live} />
          </figcaption>
          <div className="twin-canvaswrap" onClick={onClickPlan}>
            <Plan site={site} snap={s} truth={false} mode="view" showDrone onDoor={noop} onFire={noop} />
            {ring}
          </div>
          <p className="twin-legend-line">
            Locaux teintés d’après leurs détecteurs seuls · contour rouge pointillé : alerte IA · ✕ détecteur hors service · ● binôme · ◇ drone
          </p>
          <ul className="twin-facts">
            <li>
              Capteurs : <Num value={Number.isFinite(fr.tLastC) ? fr.tLastC : null} unit="°C" status={fr.status} /> · <Num value={roomFailed} unit={`/ ${roomDets.length} hors service`} status={live} />
            </li>
            <li className={pred?.alert ? 'is-alert' : ''}>
              {pred ? (
                pred.alert ? (
                  <>
                    ⚠ IA : embrasement sous <strong>{pred.horizonS} s</strong>, délai ≈ <Num value={Math.round(pred.tffS / 5) * 5} unit="s" status={pred.status} />
                  </>
                ) : (
                  <>IA : pas d’alerte (P60 <Num value={pred.p60 * 100} unit="%" status={pred.status} />)</>
                )
              ) : (
                'IA : hors modèle (halle)'
              )}
            </li>
            <li>
              Verdict du jumeau : <strong className={s.shown.verdict === 'GO' ? 'is-go' : 'is-nogo'}>{s.shown.verdict}</strong> · Décision : COS
            </li>
            <li>
              Avance de l’IA :{' '}
              {lead !== null ? (
                <>
                  <Num value={lead} unit="s avant l’embrasement" status="SIMULATED" />
                </>
              ) : (
                '— (connue après l’embrasement)'
              )}
            </li>
          </ul>
        </figure>

        <aside className="twin-detail" aria-label="Variables du modèle pour le local suivi">
          <span className="twin-kick">Local suivi</span>
          <h2>{room.name}</h2>
          {rows ? (
            <>
              <p className="twin-note">Les 13 variables que reçoit le modèle, tirées des seuls détecteurs :</p>
              <table className="twin-vars">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className={r.value === null ? 'is-missing' : ''}>
                      <th scope="row">{r.label}</th>
                      <td>
                        {r.value === null ? (
                          <span className="twin-miss" title={r.missing}>
                            — <small>{r.missing}</small>
                          </span>
                        ) : (
                          <Num value={r.value} unit={r.unit} status={fr.status} digits={r.digits} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="twin-note">Ce local est hors modèle : la halle n’a que la fumée et la température, pas de prévision d’embrasement.</p>
          )}
          <p className="twin-note">
            Modèle : {s.model.trainedOn} <StatusBadge status="MODELED" />
          </p>
          <p className="twin-note">Cliquez sur un local, sur l’un ou l’autre plan, pour le suivre.</p>
        </aside>
      </section>

      <Chain site={site} snap={s} room={focus} />

      <section className="twin-curves" aria-label="Courbes en direct du local suivi">
        <LineChart
          title="Température : réalité et capteurs"
          statuses={['SIMULATED', live]}
          yUnit="°C"
          xMax={xMax}
          yMax={tMax}
          series={[
            { name: 'Couche chaude réelle', colour: '#202124', xs, ys: col((r) => r.truthC) },
            { name: 'Ce que lisent les détecteurs', colour: '#e37400', xs, ys: col((r) => r.sensorC) },
          ]}
          hlines={[
            { y: v(H.detectors.failureC), label: 'détecteurs hors service', colour: '#5f6368' },
            { y: v(H.fire.flashoverC), label: 'embrasement', colour: '#8c1d18' },
          ]}
          vmarks={events}
        />
        <LineChart
          title="IA : probabilité d’embrasement"
          statuses={[predStatus]}
          yUnit="%"
          xMax={xMax}
          yMax={100}
          series={[
            { name: 'P(emb. ≤ 60 s)', colour: '#d93025', xs, ys: col((r) => (r.p60 === null ? null : r.p60 * 100)) },
            { name: 'P(emb. ≤ 30 s)', colour: '#f28b82', xs, ys: col((r) => (r.p30 === null ? null : r.p30 * 100)), dash: '4 3' },
          ]}
          hlines={[{ y: s.model.thresholds.p60 * 100, label: 'seuil d’alerte 60 s', colour: '#5f6368' }]}
          vmarks={events}
          empty="Ce local est hors modèle"
        />
        <LineChart
          title="Délai avant l’embrasement"
          statuses={[predStatus, 'SIMULATED']}
          yUnit="s"
          xMax={xMax}
          yMax={contract.tffCapS}
          series={[
            { name: 'Estimation de l’IA', colour: '#1a73e8', xs, ys: col((r) => r.tffS) },
            { name: 'Réel (connu après coup)', colour: '#202124', xs, ys: remaining, dash: '5 3' },
          ]}
          vmarks={events.filter((e) => e.label === 'embrasement réel')}
          empty="Ce local est hors modèle"
        />
        <LineChart
          title="Air du binôme et sifflet"
          statuses={[live, 'MODELED']}
          yUnit="bar"
          xMax={xMax}
          yMax={v(H.ari.startBar)}
          series={[
            { name: 'Pression', colour: '#188038', xs, ys: history.map((h) => h.bar) },
            { name: 'Pression prévue à la sortie', colour: '#1a73e8', xs, ys: history.map((h) => h.exitBar), dash: '5 3' },
          ]}
          hlines={[{ y: v(H.ari.whistleBar), label: 'sifflet', colour: '#8c1d18' }]}
          vmarks={noGoAt !== undefined ? [{ x: noGoAt, label: 'NO-GO', colour: '#d93025' }] : []}
        />
      </section>

      <p className="twin-foot">
        Le jumeau ne voit que les détecteurs. La réalité n’est affichée que pour comparer : elle ne nourrit jamais le verdict (R5). Historique des courbes depuis l’ouverture de cette fenêtre.
      </p>
    </main>
  )
}

// HUD du masque ARI: read in under a second. One primary number per slot, one alert at a time (icon + word + colour),
// no sentence and no « Décision : COS » (R2: that line lives on the PC, the tablet and the card). Behind the symbology,
// a synthetic first-person view of the building that follows the team in real time (scene/), labelled as what it is.

import { H, v } from '../config'
import { Scene } from '../scene/Scene'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { verdictLine } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { nextStep } from './crew'
import './crew.css'

/** The one alert the visor shows: NO-GO first, then low air, then a caution. */
function topAlert(snap: Snapshot): { level: 'warning' | 'caution' | 'ok'; icon: string; word: string } {
  if (snap.shown.verdict === 'NO-GO') return { level: 'warning', icon: '⛔', word: snap.team.mode === 'evacuating' ? 'SORTIE' : 'NO-GO' }
  if (snap.team.bar < v(H.ari.airLowCautionBar)) return { level: 'caution', icon: '⚠', word: 'AIR' }
  if (snap.shown.reasons.some((r) => r.severity === 'caution')) return { level: 'caution', icon: '⚠', word: 'ATTENTION' }
  return { level: 'ok', icon: '●', word: verdictLine(snap.shown, 'hud') }
}

export function Hud({ site, snap }: { site: Site; snap: Snapshot | null }) {
  if (!snap) return <main className="hud2 crew-wait">HUD : en attente du PC.</main>
  const live = worstStatus('MODELED', snap.readingsStatus)
  const alert = topAlert(snap)
  const next = nextStep(site, snap)
  return (
    <main className={`hud2 is-${alert.level}`}>
      <Scene className="hud2-scene" site={site} snap={snap} />
      <p className="hud2-tag">
        Vue synthétique <StatusBadge status="SIMULATED" />
      </p>
      <section className="hud2-alert" aria-live="assertive">
        <span className="hud2-icon">{alert.icon}</span> <strong>{alert.word}</strong>
      </section>
      {next && (
        <section className="hud2-nav">
          <p>
            <Num value={Math.round(next.distanceM)} unit="m" status={live} /> <span>{next.label}</span>
          </p>
        </section>
      )}
      <section className="hud2-air">
        <span>AIR</span>
        <strong>{Math.round(snap.team.bar)}</strong>
        <small>bar</small>
        <StatusBadge status={live} />
      </section>
      <section className="hud2-pnr">
        <span>PNR</span>
        <strong>{snap.team.pnrMarginBar === null ? '—' : `+${Math.round(Math.max(0, snap.team.pnrMarginBar))}`}</strong>
        <small>bar</small>
        <StatusBadge status={live} />
      </section>
    </main>
  )
}

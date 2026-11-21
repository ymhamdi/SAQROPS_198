// HUD du masque ARI: read in under a second. One primary number per slot, one alert at a time (icon + word + colour),
// no sentence and no « Décision : COS » (R2: that line lives on the PC, the tablet and the card).

import { H, v } from '../config'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { worstStatus } from '../stats/status'
import { verdictLine } from '../stats/verdict'
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
      <section className="hud2-alert" aria-live="assertive">
        <span className="hud2-icon">{alert.icon}</span> <strong>{alert.word}</strong>
      </section>
      <section className="hud2-nav">
        {next && next.bearingDeg !== null && (
          <svg className="hud2-arrow" viewBox="-30 -30 60 60" role="img" aria-label="Direction à suivre">
            <circle r="26" />
            <g transform={`rotate(${next.bearingDeg})`}>
              <path d="M0,-20 L10,10 L0,4 L-10,10 Z" />
            </g>
          </svg>
        )}
        {next && (
          <p>
            <strong>{Math.round(next.distanceM)} m</strong> {next.label}
          </p>
        )}
      </section>
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

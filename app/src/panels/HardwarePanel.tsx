// « Télémétrie matérielle »: the two USB devices, what they read and where each value comes from. Live from the USB link a
// value is OBSERVED; played back from a recording it is REPLAY, under a banner that says so and never « en direct »; the
// reading scaled for the demo is MODELED, shown with its factor. Hardware can only aggravate (R13): the dangers it raises stay
// until the COS clears them with « Ré-engager (Décision : COS) ». Without hardware, the PC is the simulated PC it always was.

import { useRef, type ChangeEvent } from 'react'
import { isSilent, scaledStatus, statusOf, type HwSettings } from '../hardware/ingest'
import type { HardwareControls } from '../hardware/useHardware'
import type { Role } from '../hardware/serialManager'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { DECISION_COS } from '../stats/verdict'
import { Num } from '../ui/Num'
import { StatusBadge } from '../ui/StatusBadge'
import { clock } from './clock'
import './hardware.css'

const STATE_LABEL = { disconnected: 'déconnecté', connected: 'connecté', replay: 'rejeu' } as const

/** A number typed in a field: kept only when it is a real number (a half-typed value does not reset the setting). */
function numberFrom(e: ChangeEvent<HTMLInputElement>): number | null {
  const n = e.target.valueAsNumber
  return Number.isFinite(n) ? n : null
}

function DeviceLine({ hw, role, label }: { hw: HardwareControls; role: Role; label: string }) {
  const st = hw.status[role]
  const last = role === 'drone' ? hw.telemetry.drone.lastAtMs : hw.telemetry.hud.lastAtMs
  const silent = st.state === 'connected' && isSilent(last, hw.nowMs)
  return (
    <div className="hw-device">
      <button type="button" className={st.state === 'connected' ? '' : 'pc-primary'} disabled={!hw.supported || st.state === 'replay'} onClick={() => void (st.state === 'connected' ? hw.disconnect(role) : hw.connect(role))}>
        {st.state === 'connected' ? 'Déconnecter' : 'Connecter'} {label}
      </button>
      <span className={`hw-state is-${st.state}`} role="status">
        ● {STATE_LABEL[st.state]}
      </span>
      {silent && <span className="hw-silent">silencieux depuis plus de {Math.round((hw.nowMs - (last ?? hw.nowMs)) / 1000)} s : la dernière valeur est conservée, jamais lue comme « tout va bien »</span>}
      {st.error && <span className="hw-error">{st.error}</span>}
    </div>
  )
}

export function HardwarePanel({ site, snap, hw, onReengage }: { site: Site; snap: Snapshot; hw: HardwareControls; onReengage: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const t = hw.telemetry
  const origin = t.origin ?? 'live'
  const status = statusOf(origin)
  const scaled = scaledStatus(origin)
  const roomName = (name: string | null) => (name === null ? '—' : t.drone.roomIndex !== null ? site.rooms[t.drone.roomIndex].short : name)
  const set = (patch: Partial<HwSettings>) => hw.setSettings(patch)
  const h = snap.hardware
  return (
    <section className="pc-card hw-card" aria-label="Télémétrie matérielle">
      <span className="pc-kick">Télémétrie matérielle · drone et HUD par USB</span>

      {hw.replayBanner && (
        <p className="hw-banner" role="status">
          {hw.replayBanner}
        </p>
      )}
      {!hw.supported && <p className="pc-note">Web Serial indisponible dans ce navigateur : utilisez Chrome ou Edge. Le rejeu reste disponible.</p>}

      <DeviceLine hw={hw} role="drone" label="le drone (ESP32)" />
      <dl className="pc-gauges">
        <div>
          <dt>Local du drone</dt>
          <dd>{roomName(t.drone.room)}</dd>
        </div>
        <div>
          <dt>Altitude baro.</dt>
          <dd>
            <Num value={t.drone.altM} unit="m" status={status} digits={2} />
          </dd>
        </div>
        <div>
          <dt>Température relevée</dt>
          <dd>
            <Num value={t.drone.tempC} unit="°C" status={status} digits={1} />
          </dd>
        </div>
        <div>
          <dt>Température modélisée</dt>
          <dd>
            <Num value={t.drone.tempC === null ? null : t.drone.tempC * hw.settings.demoFactor} unit="°C" status={scaled} digits={0} />
          </dd>
        </div>
      </dl>
      <p className="pc-note">
        Modélisée = relevé × {hw.settings.demoFactor} (facteur du mode démo) : ce que donnerait un feu industriel, jamais une mesure.
      </p>

      <DeviceLine hw={hw} role="hud" label="le HUD binôme (STM32)" />
      <dl className="pc-gauges">
        <div>
          <dt>Pression ARI relevée</dt>
          <dd>
            <Num value={t.hud.ariBar} unit="bar" status={status} digits={0} />
          </dd>
        </div>
        <div>
          <dt>Dernier ordre au HUD</dt>
          <dd>{hw.lastHud ?? '—'}</dd>
        </div>
      </dl>

      <div className="hw-settings">
        <label>
          Seuil déclenchement (°C){' '}
          <input type="number" step="0.5" value={hw.settings.triggerThresholdC} onChange={(e) => numberFrom(e) !== null && set({ triggerThresholdC: numberFrom(e)! })} />
        </label>
        <label>
          Facteur Mode Démo{' '}
          <input type="number" step="1" min="0" value={hw.settings.demoFactor} onChange={(e) => numberFrom(e) !== null && set({ demoFactor: numberFrom(e)! })} />
        </label>
      </div>

      <div className="pc-actions">
        <button type="button" onClick={() => void hw.testHud()}>
          Test NO-GO HUD
        </button>
        <button type="button" aria-pressed={hw.recording} onClick={hw.toggleRecording}>
          {hw.recording ? `Arrêter et télécharger (${hw.recordedCount})` : 'Enregistrer session'}
        </button>
        {hw.replayBanner ? (
          <button type="button" onClick={hw.stopReplay}>
            Arrêter le rejeu
          </button>
        ) : (
          <>
            <button type="button" onClick={hw.playBuiltIn}>
              Rejouer démo
            </button>
            <button type="button" onClick={() => file.current?.click()}>
              Charger un rejeu…
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void hw.playFile(f)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      {hw.message && <p className="hw-error">{hw.message}</p>}

      {(h.critical.length > 0 || h.mayday) && (
        <ul className="hw-dangers" aria-label="Dangers relevés par le matériel">
          {h.critical.map((c, i) => (
            <li key={i}>
              ⚠ Chaleur anormale — {c.room !== null ? site.rooms[c.room].name : c.roomName} : <Num value={c.valueC} unit="°C" status={c.status} digits={1} /> (seuil {c.thresholdC} °C), depuis {clock(c.atS)}
            </li>
          ))}
          {h.mayday && (
            <li>
              ⛔ MAYDAY du chef de binôme depuis {clock(h.mayday.atS)} <StatusBadge status={h.mayday.status} />
            </li>
          )}
        </ul>
      )}
      <p className="pc-note">Le matériel ne peut qu’aggraver : un danger relevé reste jusqu’à la décision du COS.</p>
      <div className="pc-actions">
        <button type="button" className="pc-danger" disabled={!snap.latched} onClick={onReengage}>
          Ré-engager ({DECISION_COS})
        </button>
      </div>
    </section>
  )
}

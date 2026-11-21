import { useEffect, useState, type ReactNode } from 'react'
import type { LayerState } from '../map/MapView'
import { HAZARD_COLORS, HAZARD_LABELS, WALK_HOME_BANDS, WALK_HOME_UNREACHABLE, type GridOverlayMode, type Hazard, INK } from '../map/overlays'
import { formatMarsClock, ltstHours, marsTime } from '../marsTime'
import type { DataConfig, DataStatus, RoverTraverse } from '../types'
import { BookmarkIcon, CloseIcon, ControlIcon, LayersIcon, TabletIcon, VisorIcon } from '../ui/icons'
import { StatusBadge } from '../ui/StatusBadge'

interface Props {
  config: DataConfig
  baseLon: number
  gridStatus: DataStatus
  layerState: Record<string, LayerState>
  onLayerChange: (id: string, state: LayerState) => void
  overlay: GridOverlayMode
  onOverlayChange: (mode: GridOverlayMode) => void
  /** a rover's real path, with its own toggle; null when the site has none */
  traverse: RoverTraverse | null
  showTraverse: boolean
  onShowTraverse: (on: boolean) => void
  panel: Panel | null
  onPanel: (panel: Panel | null) => void
  conditionsPanel: ReactNode
  savedPanel: ReactNode
  savedCount: number
  stormActive: boolean
  hudEnabled: boolean
  onHud: () => void
  onTablet: () => void
  onControl: () => void
}

type Panel = 'layers' | 'conditions' | 'saved'

const OVERLAYS: { mode: GridOverlayMode; label: string }[] = [
  { mode: 'none', label: 'Off' },
  { mode: 'slope', label: 'Slope' },
  { mode: 'terrain', label: 'Terrain' },
  { mode: 'walkhome', label: 'Walk home' },
  { mode: 'radio', label: 'Radio' },
]

function MarsClock({ lon, open, alert, onClick }: { lon: number; open: boolean; alert: boolean; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const t = marsTime(now)
  return (
    <button
      type="button"
      className={`chip-float clock ${alert ? 'is-alert' : ''}`}
      aria-expanded={open}
      title={`Mars sol date ${t.msd.toFixed(2)} · season Ls ${t.lsDeg.toFixed(1)}° · open conditions`}
      onClick={onClick}
    >
      {alert && <span className="alert-dot" aria-label="Radiation alert" />}
      <span className="clock-label">Mars local time</span>
      <strong>{formatMarsClock(ltstHours(t, lon))}</strong>
      <StatusBadge status="DERIVED" />
    </button>
  )
}

export function MapControls(props: Props) {
  const { config, baseLon, gridStatus, layerState, onLayerChange, overlay, onOverlayChange, traverse, showTraverse, onShowTraverse } = props
  const { panel, onPanel, conditionsPanel, savedPanel, savedCount, stormActive, hudEnabled, onHud, onTablet, onControl } = props
  const toggle = (p: Panel) => onPanel(panel === p ? null : p)
  return (
    <div className="map-controls">
      <div className="map-controls-row">
        <MarsClock lon={baseLon} open={panel === 'conditions'} alert={stormActive} onClick={() => toggle('conditions')} />
        <button type="button" className="chip-float layers-btn" aria-expanded={panel === 'layers'} aria-controls="layers-panel" onClick={() => toggle('layers')}>
          <LayersIcon size={18} />
          Layers
        </button>
        <button type="button" className="chip-float layers-btn" aria-label="Saved plans" title="Saved plans" aria-expanded={panel === 'saved'} onClick={() => toggle('saved')}>
          <BookmarkIcon size={18} />
          <span className="chip-label">Saved</span>
          {savedCount > 0 && <span className="chip-count">{savedCount}</span>}
        </button>
        <button type="button" className="chip-float layers-btn" disabled={!hudEnabled} aria-label="Tablet" title={hudEnabled ? 'Tablet carried on the walk' : 'Plan a route first'} onClick={onTablet}>
          <TabletIcon size={18} />
          <span className="chip-label">Tablet</span>
        </button>
        <button type="button" className="chip-float layers-btn" disabled={!hudEnabled} aria-label="HUD" title={hudEnabled ? 'Helmet visor view' : 'Plan a route first'} onClick={onHud}>
          <VisorIcon size={18} />
          <span className="chip-label">HUD</span>
        </button>
        <button type="button" className="chip-float layers-btn" disabled={!hudEnabled} aria-label="Mission control" title={hudEnabled ? 'Mission control: follow the crew and change the rest of the walk' : 'Plan a route first'} onClick={onControl}>
          <ControlIcon size={18} />
          <span className="chip-label">Control</span>
        </button>
      </div>

      {panel === 'conditions' && conditionsPanel}

      {panel === 'saved' && savedPanel}

      {panel === 'layers' && (
        <section id="layers-panel" className="card layers-panel" aria-label="Map layers">
          <header className="layers-head">
            <h2>Map layers</h2>
            <button type="button" className="icon-btn" aria-label="Close layers" onClick={() => onPanel(null)}>
              <CloseIcon size={16} />
            </button>
          </header>

          <ul className="layer-list">
            {config.layers.map((layer) => {
              const state = layerState[layer.id]
              return (
                <li key={layer.id}>
                  <label className="layer-toggle">
                    <input type="checkbox" checked={state.visible} onChange={(e) => onLayerChange(layer.id, { ...state, visible: e.target.checked })} />
                    <span className="layer-name">
                      {layer.name}
                      <small>{layer.dataType}</small>
                    </span>
                    <StatusBadge status={layer.status} />
                  </label>
                  {state.visible && (
                    <input
                      className="opacity"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={state.opacity}
                      aria-label={`${layer.name} opacity`}
                      onChange={(e) => onLayerChange(layer.id, { ...state, opacity: Number(e.target.value) })}
                    />
                  )}
                </li>
              )
            })}
            {traverse && traverse.points.length > 1 && (
              <li>
                <label className="layer-toggle">
                  <input type="checkbox" checked={showTraverse} onChange={(e) => onShowTraverse(e.target.checked)} />
                  <span className="layer-name">
                    <span>
                      <span className="traverse-key" aria-hidden="true" />
                      {traverse.rover}'s real path, sols {traverse.points[0].sol}–{traverse.points[traverse.points.length - 1].sol}
                    </span>
                    <small>rover traverse</small>
                  </span>
                  <StatusBadge status={traverse.status} />
                </label>
              </li>
            )}
          </ul>

          <h3 id="overlay-h">
            Trafficability <StatusBadge status={gridStatus} />
          </h3>
          <div className="segmented" role="radiogroup" aria-labelledby="overlay-h">
            {OVERLAYS.map(({ mode, label }) => (
              <button key={mode} type="button" role="radio" aria-checked={overlay === mode} onClick={() => onOverlayChange(mode)}>
                {label}
              </button>
            ))}
          </div>
          {overlay === 'walkhome' ? (
            <>
              <p className="note">Minutes to the nearest safe haven (habitat, or the rover where it is staged), at planned pace.</p>
              <ul className="legend" aria-label="Walk-home time colours">
                {[...WALK_HOME_BANDS, WALK_HOME_UNREACHABLE].map((b) => (
                  <li key={b.label}>
                    <span className="swatch" style={{ background: b.color }} />
                    {b.label}
                  </li>
                ))}
              </ul>
            </>
          ) : overlay === 'radio' ? (
            <>
              <p className="note">
                Shaded ground has no straight radio line to the habitat mast or the staged rover (suit antenna 1.8 m, mast 5 m, rover 3 m;
                no orbiter relay). <StatusBadge status="MODELED" />
              </p>
              <ul className="legend" aria-label="Radio colours">
                <li>
                  <span className="swatch" style={{ background: INK.radioShadow }} />
                  Radio shadow
                </li>
              </ul>
            </>
          ) : (
            <ul className="legend" aria-label="Route and terrain colours">
              {(Object.keys(HAZARD_COLORS) as Hazard[]).map((h) => (
                <li key={h}>
                  <span className="swatch" style={{ background: HAZARD_COLORS[h] }} />
                  {h === 'clear' ? 'Clear walking' : HAZARD_LABELS[h]}
                </li>
              ))}
              <li>
                <span className="swatch swatch-dashed" style={{ borderColor: INK.rover }} />
                Riding the rover
              </li>
            </ul>
          )}
          {gridStatus === 'MOCK' && (
            <p className="note">Terrain, targets and conditions are a synthetic site placed on the real HiRISE imagery. They do not match the ground you see.</p>
          )}
        </section>
      )}
    </div>
  )
}

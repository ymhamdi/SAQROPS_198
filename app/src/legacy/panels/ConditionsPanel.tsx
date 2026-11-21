import { formatMarsClock, ltstHours, marsTime } from '../marsTime'
import { findSunset, sunElevationAt } from '../stats/conditions'
import type { StartOption } from '../stats/sun'
import type { WindowSlot } from '../stats/window'
import type { Conditions, SpaceWeather } from '../types'
import { CloseIcon } from '../ui/icons'
import { SourceLine } from '../ui/SourceLine'
import { StatusBadge } from '../ui/StatusBadge'

interface Props {
  conditions: Conditions[]
  startTime: string
  /** daylight start times in Mars local time */
  startChoices: StartOption[]
  onStartTime: (iso: string) => void
  lonEast: number
  endTime: string | null
  storm: boolean
  /** NASA DONKI events and windows for the planned sol, or null */
  spaceWeather: SpaceWeather | null
  /** every daylight start judged for the current plan (empty with no route) */
  startWindow: WindowSlot[]
  onStormChange: (on: boolean) => void
  onClose: () => void
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

const LEVEL_LABEL = { go: 'GO', caution: 'caution', nogo: 'NO-GO' } as const

/** Every daylight start as a coloured slot (GO / start-dependent caution / NO-GO); click one to start then. */
function StartWindow({ slots, current, onPick }: { slots: WindowSlot[]; current: string; onPick: (iso: string) => void }) {
  const now = slots.find((w) => w.time === current)
  return (
    <div className="start-window">
      <p className="panel-sub">
        Start window for this plan <StatusBadge status="MODELED" />
      </p>
      <div className="sw-strip" role="radiogroup" aria-label="Start times by verdict">
        {slots.map((w) => (
          <button
            key={w.time}
            type="button"
            role="radio"
            aria-checked={w.time === current}
            className={`sw-slot is-${w.level}`}
            title={`${w.ltst} Mars local: ${LEVEL_LABEL[w.level]} · ${w.why}`}
            aria-label={`${w.ltst} Mars local, ${LEVEL_LABEL[w.level]}: ${w.why}`}
            onClick={() => onPick(w.time)}
          />
        ))}
      </div>
      <div className="sw-axis" aria-hidden="true">
        <span>{slots[0].ltst}</span>
        <span>{slots[Math.floor(slots.length / 2)].ltst}</span>
        <span>{slots[slots.length - 1].ltst}</span>
      </div>
      <ul className="sw-legend">
        <li>
          <span className="sw-key is-go" />
          GO
        </li>
        <li>
          <span className="sw-key is-caution" />
          Caution that depends on the start
        </li>
        <li>
          <span className="sw-key is-nogo" />
          NO-GO
        </li>
      </ul>
      {now && (
        <p className="sw-now">
          {now.ltst} start: {now.why}.
        </p>
      )}
    </div>
  )
}

/** Weather, daylight and space weather for the EVA window, plus the solar-storm drill. */
export function ConditionsPanel({ conditions, startTime, startChoices, onStartTime, lonEast, endTime, storm, onStormChange, spaceWeather, startWindow, onClose }: Props) {
  const local = (ms: number) => formatMarsClock(ltstHours(marsTime(ms), lonEast)).slice(0, 5)
  const startMs = Date.parse(startTime)
  const endMs = endTime ? Date.parse(endTime) : null
  const at = conditions.reduce((best, c) => (Math.abs(Date.parse(c.time) - startMs) < Math.abs(Date.parse(best.time) - startMs) ? c : best), conditions[0])
  const sunNow = sunElevationAt(conditions, startMs)
  const sunset = findSunset(conditions, startMs)
  const status = at?.status ?? 'MOCK'
  const windowAt = (level: 'alert' | 'advisory') =>
    spaceWeather?.windows.find((w) => w.level === level && Date.parse(w.start) <= startMs && startMs <= Date.parse(w.end)) ?? null
  const radiation = storm ? 'Storm drill' : at?.radiationAlert || windowAt('alert') ? 'Alert' : windowAt('advisory') ? 'Advisory' : 'Background'

  // Sun elevation over the sol, with the EVA window shaded.
  const t0 = Date.parse(conditions[0].time)
  const t1 = Date.parse(conditions[conditions.length - 1].time)
  const W = 308
  const H = 84
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W
  const y = (e: number) => H / 2 - (e / 90) * (H / 2 - 4)
  const line = conditions.map((c, i) => `${i ? 'L' : 'M'}${x(Date.parse(c.time)).toFixed(1)},${y(c.sunElevationDeg).toFixed(1)}`).join('')

  return (
    <section className="card side-panel" aria-label="Conditions">
      <header className="layers-head">
        <h2>Conditions</h2>
        <button type="button" className="icon-btn" aria-label="Close conditions" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>
      <label className="start-select">
        <span>Planned start, Mars local time</span>
        <select value={startTime} onChange={(e) => onStartTime(e.target.value)}>
          {!startChoices.some((o) => o.time === startTime) && <option value={startTime}>{local(startMs)}</option>}
          {startChoices.map((o) => (
            <option key={o.time} value={o.time}>
              {o.ltst} · sun {Math.round(o.sunDeg)}° · {o.time.slice(11, 16)} UTC
            </option>
          ))}
        </select>
      </label>
      {startWindow.length > 0 && <StartWindow slots={startWindow} current={startTime} onPick={onStartTime} />}

      <p className="panel-sub">
        Weather at the start, {hhmm(startMs)} UTC <StatusBadge status={status} />
      </p>

      <dl className="readouts">
        <div>
          <dt>Air temperature</dt>
          <dd>{at.tempC.toFixed(0)} °C</dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd>{at.pressurePa.toFixed(0)} Pa</dd>
        </div>
        <div>
          <dt>Dust opacity τ</dt>
          <dd>{at.dustTau.toFixed(2)}</dd>
        </div>
        <div>
          <dt>
            Sun elevation <StatusBadge status="DERIVED" />
          </dt>
          <dd>{sunNow !== null ? `${sunNow.toFixed(0)}°` : '—'}</dd>
        </div>
        <div>
          <dt>
            Sunset <StatusBadge status="DERIVED" />
          </dt>
          <dd>{sunset !== null ? `${local(sunset)} local` : '—'}</dd>
        </div>
        <div>
          <dt>Radiation</dt>
          <dd className={radiation === 'Background' ? '' : 'is-alert'}>{radiation}</dd>
        </div>
      </dl>
      {at?.source && (
        <p className="panel-source">
          <SourceLine source={at.source} />
        </p>
      )}

      {spaceWeather && (
        <section className="space-weather" aria-label="Space weather">
          <p className="panel-sub">
            Space weather · NASA DONKI <StatusBadge status={spaceWeather.status} />
          </p>
          {spaceWeather.events.length === 0 ? (
            <p className="panel-source">No solar events catalogued around this sol.</p>
          ) : (
            <ul className="sw-events">
              {spaceWeather.events.map((e) => (
                <li key={e.time + e.kind} className={e.atMars ? 'at-mars' : ''}>
                  <strong>{e.atMars ? 'At Mars' : 'Near Earth'}</strong> <SourceLine source={`${e.summary} ${e.link}`} />
                </li>
              ))}
            </ul>
          )}
          <p className="panel-source">
            <SourceLine source={spaceWeather.source} />
          </p>
        </section>
      )}

      <figure className="sunchart">
        <figcaption>Sun over the sol from the Mars24 clock, Marswalk shaded</figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sun elevation through the sol">
          {endMs && <rect x={x(startMs)} y={0} width={Math.max(2, x(endMs) - x(startMs))} height={H} className="sun-window" />}
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="sun-horizon" />
          <path d={line} className="sun-line" />
        </svg>
      </figure>

      <label className="switch">
        <input type="checkbox" role="switch" checked={storm} onChange={(e) => onStormChange(e.target.checked)} />
        <span>
          <strong>Simulate solar storm</strong>
          <small>Raises a radiation alert over the Marswalk to rehearse the shelter call. SIMULATED, not a forecast.</small>
        </span>
      </label>
    </section>
  )
}

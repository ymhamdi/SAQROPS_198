import './alerts.css'
import { StatusBadge } from './StatusBadge'
import { AlertIcon, WarningIcon } from './icons'
import { takesOver, type WalkAlert } from './alerts'

interface Props {
  alerts: WalkAlert[]
  /** 'visor' on the HUD, 'tablet' on the tablet: same structure, sized for each */
  variant: 'visor' | 'tablet'
}

/**
 * The fixed alert slot: one alert at a time, always icon + word + colour, the rest counted. A live warning takes
 * over (a full band with the action); anything else is one line. Drone and storm feeds reuse this slot.
 */
export function AlertSlot({ alerts, variant }: Props) {
  const top = alerts[0]
  if (!top) return <div className={`alert-slot is-${variant} is-empty`} aria-live="polite" />
  const takeover = takesOver(alerts)
  const more = alerts.length - 1
  const Icon = top.level === 'warning' ? WarningIcon : AlertIcon
  return (
    <div
      className={`alert-slot is-${variant} is-${top.level}${takeover ? ' is-takeover' : ''}`}
      role={top.level === 'warning' ? 'alert' : 'status'}
      aria-live={top.level === 'warning' ? 'assertive' : 'polite'}
      title={top.detail}
    >
      <Icon size={takeover ? 34 : 24} />
      <span className="alert-word">{top.level === 'warning' ? 'Warning' : 'Caution'}</span>
      <span className="alert-text">
        <strong className="alert-title">{top.title}</strong>
        {(top.action || top.drill) && (
          <span className="alert-action">
            {top.action} {top.drill && <StatusBadge status="SIMULATED" />}
          </span>
        )}
      </span>
      {more > 0 && <span className="alert-more">+{more} more</span>}
    </div>
  )
}

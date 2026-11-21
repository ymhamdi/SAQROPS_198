// Authored icons: 24px grid, 1.75 stroke, round caps, currentColor.

import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  title?: string
}

function Svg({ size = 18, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

/** The wordmark's mark: a line bending at 45° through an interchange ring. */
export function LineMark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 20h5l5-5" />
      <path d="M17 10l5-5" />
      <circle cx="14.5" cy="12.5" r="3" />
    </Svg>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </Svg>
  )
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
    </Svg>
  )
}

export function TabletIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M10.5 18h3" />
    </Svg>
  )
}

/** A helmet visor seen from the front. */
export function VisorIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 13a8 8 0 0 1 16 0v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M7 12.5c1.5-1.5 8.5-1.5 10 0" />
    </Svg>
  )
}

/** Six dots: a handle to drag a row. */
export function GripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {[8, 16].map((x) => [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" stroke="none" />))}
    </Svg>
  )
}

/** Position fix: a crosshair. */
export function LocateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
    </Svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </Svg>
  )
}

/** WARNING (act now): an octagon, a different shape from the caution triangle so severity never rests on colour. */
export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </Svg>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  )
}

/** Recording: a filled dot inside a ring. */
export function RecordIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </Svg>
  )
}

/** Working: three steps. */
export function WorkingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h.01M12 12h.01M20 12h.01" strokeWidth={3.5} />
    </Svg>
  )
}

export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Svg>
  )
}

export function SpeakerOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </Svg>
  )
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  )
}

/** PARTLY: a half-filled circle. */
export function PartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </Svg>
  )
}

/** Not heard / rules mode: a ring with a bar. */
export function OfflineIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </Svg>
  )
}

/** Stop priority as three bars, like signal strength: 1 = low, 2 = medium, 3 = high. Unfilled bars stay faint. */
export function PriorityIcon({ level, ...props }: IconProps & { level: 1 | 2 | 3 }) {
  return (
    <Svg {...props}>
      {[0, 1, 2].map((k) => (
        <path key={k} d={`M${6 + k * 6} 19V${15 - k * 4}`} strokeWidth={3} opacity={k < level ? 1 : 0.25} />
      ))}
    </Svg>
  )
}

/** Mission control: a radio mast sending to the field. */
export function ControlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 11v10M8.5 21h7" />
      <circle cx="12" cy="9" r="2" />
      <path d="M8 5.5a5.5 5.5 0 0 0 0 7M16 5.5a5.5 5.5 0 0 1 0 7M5.2 3a9 9 0 0 0 0 12M18.8 3a9 9 0 0 1 0 12" />
    </Svg>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

import type { DataStatus } from '../types'
import { StatusBadge } from './StatusBadge'

/** Every number shown carries its label (CLAUDE.md R3). Non-finite values show as a dash, still labelled. */
export function Num({ value, unit, status, digits = 0 }: { value: number | null | undefined; unit?: string; status: DataStatus; digits?: number }) {
  const text = value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
  return (
    <span className="num">
      <strong>{text}</strong>
      {unit ? <small> {unit}</small> : null} <StatusBadge status={status} />
    </span>
  )
}

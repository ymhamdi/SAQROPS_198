/** "2 h 05 min", "45 min", "under 1 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unbounded'
  const sign = seconds < 0 ? '-' : ''
  const totalMin = Math.round(Math.abs(seconds) / 60)
  if (totalMin === 0) return 'under 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h === 0 ? `${sign}${m} min` : `${sign}${h} h ${String(m).padStart(2, '0')} min`
}

/** "850 m", "2.4 km". */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
}

/**
 * A safety message cut to its first clause, for the helmet visor: up to the first ": ", " (" or ". ".
 * "Space-weather advisory until 16:00 UTC: CME launched …" → "Space-weather advisory until 16:00 UTC".
 */
export function shortReason(message: string): string {
  const cuts = [': ', ' (', '. '].map((sep) => message.indexOf(sep)).filter((i) => i > 0)
  const end = cuts.length ? Math.min(...cuts) : message.length
  return message.slice(0, end).replace(/\.$/, '')
}


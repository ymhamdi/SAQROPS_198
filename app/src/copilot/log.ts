// The copilot's side of the live link: the tablet posts every exchange to the PC, a MAYDAY among them as an alert (C6, C7).
// Same BroadcastChannel as the snapshots (live/channel.ts). The PC only logs and alerts: the verdict does not change.

import { useEffect, useState } from 'react'
import { openChannel } from '../live/channel'
import type { CopilotEntry } from './pipeline'

/** Tablet: send one exchange to the PC. */
export function postEntry(entry: CopilotEntry): void {
  const ch = openChannel(() => {})
  ch.post({ type: 'copilot', entry })
  ch.close()
}

/** How many exchanges the PC keeps on screen. */
const KEEP = 50

/** PC: the exchanges of the tablet, newest first, and the MAYDAYs not yet acknowledged. */
export function useCopilotLog(): { entries: CopilotEntry[]; maydays: CopilotEntry[]; acknowledge: (id: string) => void } {
  const [entries, setEntries] = useState<CopilotEntry[]>([])
  const [acked, setAcked] = useState<string[]>([])
  useEffect(() => {
    const ch = openChannel((m) => {
      if (m.type === 'copilot') setEntries((xs) => [m.entry, ...xs].slice(0, KEEP))
    })
    return () => ch.close()
  }, [])
  return {
    entries,
    maydays: entries.filter((e) => e.mayday && !acked.includes(e.id)),
    acknowledge: (id) => setAcked((xs) => [...xs, id]),
  }
}

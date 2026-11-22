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
  // A MAYDAY stays on screen until the COS acknowledges it (C6): it is kept apart from the log, which is cut at KEEP, so that
  // fifty later exchanges cannot push an unacknowledged MAYDAY out of the alert.
  const [open, setOpen] = useState<CopilotEntry[]>([])
  useEffect(() => {
    const ch = openChannel((m) => {
      if (m.type !== 'copilot') return
      setEntries((xs) => [m.entry, ...xs].slice(0, KEEP))
      if (m.entry.mayday) setOpen((xs) => (xs.some((x) => x.id === m.entry.id) ? xs : [m.entry, ...xs]))
    })
    return () => ch.close()
  }, [])
  return {
    entries,
    maydays: open,
    acknowledge: (id) => setOpen((xs) => xs.filter((x) => x.id !== id)),
  }
}

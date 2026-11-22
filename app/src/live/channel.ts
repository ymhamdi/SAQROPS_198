// The live link PC → tablet and HUD: two windows of one browser (BroadcastChannel), standing in for the radio.
// SIMULATED. The PC is the master: it simulates and broadcasts; the crew views only display.

import type { CopilotEntry } from '../copilot/pipeline'
import type { Snapshot } from '../sim/protocol'
import { isCopilotEntry, isSnapshot } from './validate'

const NAME = 'pnr.live.v1'

/** 'copilot': tablet → PC, one exchange of the copilot, logged by the PC; a MAYDAY among them is an alert (C6, C7). */
export type LiveMessage = { type: 'snap'; snap: Snapshot } | { type: 'hello' } | { type: 'copilot'; entry: CopilotEntry }

export interface Channel {
  post: (m: LiveMessage) => void
  close: () => void
}

export function openChannel(onMessage: (m: LiveMessage) => void): Channel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} }
  const ch = new BroadcastChannel(NAME)
  // A message of an unexpected shape is dropped here, not rendered: one bad message must not unmount a window.
  ch.onmessage = (e: MessageEvent<unknown>) => {
    const m = e.data as { type?: unknown; snap?: unknown; entry?: unknown } | null
    if (m?.type === 'hello') onMessage({ type: 'hello' })
    else if (m?.type === 'snap' && isSnapshot(m.snap)) onMessage({ type: 'snap', snap: m.snap })
    else if (m?.type === 'copilot' && isCopilotEntry(m.entry)) onMessage({ type: 'copilot', entry: m.entry })
  }
  return {
    post: (m) => {
      try {
        ch.postMessage(m)
      } catch {
        // window closing: nothing to do
      }
    },
    close: () => ch.close(),
  }
}

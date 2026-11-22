// The live link PC → tablet and HUD: two windows of one browser (BroadcastChannel), standing in for the radio.
// SIMULATED. The PC is the master: it simulates and broadcasts; the crew views only display.

import type { Snapshot } from '../sim/protocol'

const NAME = 'pnr.live.v1'

export type LiveMessage = { type: 'snap'; snap: Snapshot } | { type: 'hello' }

export interface Channel {
  post: (m: LiveMessage) => void
  close: () => void
}

export function openChannel(onMessage: (m: LiveMessage) => void): Channel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} }
  const ch = new BroadcastChannel(NAME)
  ch.onmessage = (e: MessageEvent<LiveMessage>) => onMessage(e.data)
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

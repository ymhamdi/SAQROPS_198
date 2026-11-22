// The master window (the PC, or a self-playing demo window) broadcasts every snapshot to the crew windows, and answers
// the « hello » of a window that opens late with the latest one.

import { useEffect, useRef } from 'react'
import type { Snapshot } from '../sim/protocol'
import { openChannel, type Channel } from './channel'

export function useBroadcast(snap: Snapshot | null): void {
  const channel = useRef<Channel | null>(null)
  const latest = useRef<Snapshot | null>(null)
  useEffect(() => {
    const ch = openChannel((m) => {
      if (m.type === 'hello' && latest.current) ch.post({ type: 'snap', snap: latest.current })
    })
    channel.current = ch
    return () => ch.close()
  }, [])
  useEffect(() => {
    latest.current = snap
    if (snap) channel.current?.post({ type: 'snap', snap })
  }, [snap])
}

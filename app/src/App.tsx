import { useEffect, useMemo, useRef, useState } from 'react'
import { openChannel, type Channel } from './live/channel'
import { Hud } from './panels/Hud'
import { Pc } from './panels/Pc'
import { Tablet } from './panels/Tablet'
import { useSim } from './sim/client'
import type { Snapshot } from './sim/protocol'
import { buildSite } from './site/site'

type View = 'pc' | 'tablet' | 'hud'

/** The PC simulates and broadcasts every snapshot to the crew windows. */
function PcApp() {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
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
    latest.current = sim.snap
    if (sim.snap) channel.current?.post({ type: 'snap', snap: sim.snap })
  }, [sim.snap])
  const openCrew = (view: 'tablet' | 'hud') => {
    const url = `${window.location.pathname}?view=${view}`
    if (!window.open(url, `pnr-${view}`)) alert('Le navigateur a bloqué la nouvelle fenêtre : autorisez les fenêtres pour cette page.')
  }
  return <Pc site={site} sim={sim} onOpenCrew={openCrew} />
}

/** Tablet and HUD only display what the PC broadcasts. */
function CrewApp({ view }: { view: 'tablet' | 'hud' }) {
  const site = useMemo(() => buildSite(), [])
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    const ch = openChannel((m) => m.type === 'snap' && setSnap(m.snap))
    ch.post({ type: 'hello' })
    return () => ch.close()
  }, [])
  return view === 'tablet' ? <Tablet site={site} snap={snap} /> : <Hud site={site} snap={snap} />
}

export default function App() {
  const view = (new URLSearchParams(window.location.search).get('view') ?? 'pc') as View
  return view === 'pc' ? <PcApp /> : <CrewApp view={view} />
}

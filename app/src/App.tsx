import { useEffect, useMemo, useState } from 'react'
import { DemoHost } from './demo/DemoHost'
import { CAPTIONS, STEPS } from './demo/captions'
import { useDemo } from './demo/useDemo'
import { openChannel } from './live/channel'
import { useBroadcast } from './live/useBroadcast'
import { Hud } from './panels/Hud'
import { Pc } from './panels/Pc'
import { Tablet } from './panels/Tablet'
import { useSim } from './sim/client'
import type { Snapshot } from './sim/protocol'
import { buildSite } from './site/site'
import { Twin } from './twin/Twin'

type View = 'pc' | 'tablet' | 'hud' | 'twin'

/** The PC simulates and broadcasts every snapshot to the crew windows; « Démo automatique » plays the COS by script. */
function PcApp({ autoDemo }: { autoDemo: boolean }) {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
  const [demoOn, setDemoOn] = useState(autoDemo)
  const demo = useDemo(sim, site, demoOn)
  useBroadcast(sim.snap)
  const openCrew = (view: 'tablet' | 'hud' | 'twin') => {
    const url = `${window.location.pathname}?view=${view}`
    if (!window.open(url, `pnr-${view}`)) alert('Le navigateur a bloqué la nouvelle fenêtre : autorisez les fenêtres pour cette page.')
  }
  const caption = CAPTIONS[demo.scene]
  return (
    <Pc
      site={site}
      sim={sim}
      onOpenCrew={openCrew}
      demo={{ on: demoOn, onToggle: () => setDemoOn((x) => !x), onRestart: demo.restart, done: demo.done, caption: `Étape ${caption.step}/${STEPS}`, text: caption.text }}
    />
  )
}

/** Tablet, HUD and digital twin only display what the PC broadcasts. */
function CrewApp({ view }: { view: 'tablet' | 'hud' | 'twin' }) {
  const site = useMemo(() => buildSite(), [])
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    const ch = openChannel((m) => m.type === 'snap' && setSnap(m.snap))
    ch.post({ type: 'hello' })
    return () => ch.close()
  }, [])
  if (view === 'twin') return <Twin site={site} snap={snap} />
  return view === 'tablet' ? <Tablet site={site} snap={snap} /> : <Hud site={site} snap={snap} />
}

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const view = (params.get('view') ?? 'pc') as View
  const demo = params.get('demo') === '1'
  if (view === 'pc') return <PcApp autoDemo={demo} />
  return demo ? <DemoHost view={view} /> : <CrewApp view={view} />
}

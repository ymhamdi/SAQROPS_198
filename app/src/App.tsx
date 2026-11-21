import { useEffect, useMemo, useState } from 'react'
import { captionOf } from './demo/captions'
import { DemoHost } from './demo/DemoHost'
import { useDemo } from './demo/useDemo'
import { useHardware } from './hardware/useHardware'
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
function PcApp({ autoDemo, rehearsal }: { autoDemo: boolean; rehearsal: boolean }) {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
  const [demoOn, setDemoOn] = useState(autoDemo)
  // The PC shows the plan the rehearsal produced, so the simulation waits while the COS reads it.
  const opts = useMemo(() => ({ rehearsal, hold: rehearsal }), [rehearsal])
  const demo = useDemo(sim, site, demoOn, opts)
  // The USB hardware (drone payload and binôme HUD): inert until something is connected or a recording is played.
  const hw = useHardware(sim, site)
  useBroadcast(sim.snap)
  const openCrew = (view: 'tablet' | 'hud' | 'twin') => {
    const url = `${window.location.pathname}?view=${view}`
    if (!window.open(url, `pnr-${view}`)) alert('Le navigateur a bloqué la nouvelle fenêtre : autorisez les fenêtres pour cette page.')
  }
  const caption = captionOf(demo.scene, demo.rehearsal)
  return (
    <Pc
      site={site}
      sim={sim}
      onOpenCrew={openCrew}
      demoPlan={demoOn ? demo.plan : null}
      hw={hw}
      demo={{ on: demoOn, onToggle: () => setDemoOn((x) => !x), onRestart: demo.restart, done: demo.done, caption: `Étape ${caption.step}/${caption.steps}`, text: caption.text }}
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
  // The story of the video includes the rehearsal; &rehearsal=0 plays the shorter one without it.
  const rehearsal = params.get('rehearsal') !== '0'
  if (view === 'pc') return <PcApp autoDemo={demo} rehearsal={rehearsal} />
  return demo ? <DemoHost view={view} rehearsal={rehearsal} /> : <CrewApp view={view} />
}

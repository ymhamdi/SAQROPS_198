// ?view=hud|tablet|twin&demo=1: one window that simulates and plays the whole intervention by itself, full screen on the
// chosen crew view. It also broadcasts, so other crew windows opened beside it move too. Do not open it next to a real
// PC window: two masters would fight over the same channel.

import { useMemo } from 'react'
import { Hud } from '../panels/Hud'
import { Tablet } from '../panels/Tablet'
import { useBroadcast } from '../live/useBroadcast'
import { useSim } from '../sim/client'
import { buildSite } from '../site/site'
import { Twin } from '../twin/Twin'
import { DemoBar } from './DemoBar'
import type { DemoView } from './links'
import { useDemo } from './useDemo'

export function DemoHost({ view }: { view: DemoView }) {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
  useBroadcast(sim.snap)
  const demo = useDemo(sim, site, true)
  if (sim.error) return <main className="crew-wait">{sim.error}</main>
  return (
    <>
      {view === 'twin' ? <Twin site={site} snap={sim.snap} /> : view === 'tablet' ? <Tablet site={site} snap={sim.snap} /> : <Hud site={site} snap={sim.snap} />}
      <DemoBar scene={demo.scene} done={demo.done} playing={sim.playing} view={view} onToggle={() => sim.setPlaying(!sim.playing)} onRestart={demo.restart} />
    </>
  )
}

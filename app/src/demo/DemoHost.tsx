// ?view=hud|tablet|twin&demo=1: one window that simulates and plays the whole intervention by itself, full screen on the
// chosen crew view. It also broadcasts, so other crew windows opened beside it move too. Do not open it next to a real
// PC window: two masters would fight over the same channel.
//
// The story includes the rehearsal (the indoor drone, then PNR playing the mission, then the COS validating the plan).
// The twin switches to its « Répétition » tab and replays it while the simulation waits; the HUD and the tablet never
// show the rehearsal (R12), so for them the simulation does not wait. Add &rehearsal=0 for the story without it.

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

export function DemoHost({ view, rehearsal = true }: { view: DemoView; rehearsal?: boolean }) {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
  useBroadcast(sim.snap)
  const opts = useMemo(() => ({ rehearsal, hold: rehearsal && view === 'twin' }), [rehearsal, view])
  const demo = useDemo(sim, site, true, opts)
  if (sim.error) return <main className="crew-wait">{sim.error}</main>
  return (
    <>
      {view === 'twin' ? (
        <Twin site={site} snap={sim.snap} forceTab={demo.rehearsal ? (demo.scene === 'rehearsal' ? 'rehearsal' : 'live') : undefined} autoPlayRehearsal />
      ) : view === 'tablet' ? (
        <Tablet site={site} snap={sim.snap} />
      ) : (
        <Hud site={site} snap={sim.snap} />
      )}
      <DemoBar scene={demo.scene} rehearsal={demo.rehearsal} done={demo.done} playing={sim.playing} view={view} onToggle={() => sim.setPlaying(!sim.playing)} onRestart={demo.restart} />
    </>
  )
}

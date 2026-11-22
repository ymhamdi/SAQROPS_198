// « Répétition » tab of the digital twin: PNR plays the planned mission on what it knows, in the HUD's first-person view.
// The rehearsal runs when the tab opens (it takes a few milliseconds) and again on demand; it changes nothing in the simulation.

import { useState } from 'react'
import { rehearse, type KnownInput, type RehearsalPlan } from '../rehearsal/engine'
import { knownInputOf } from '../rehearsal/input'
import { RehearsalView } from '../rehearsal/RehearsalView'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { clock } from '../panels/clock'

export function RehearsalTab({ site, snap, autoPlay = false }: { site: Site; snap: Snapshot; autoPlay?: boolean }) {
  const [run, setRun] = useState<{ input: KnownInput; plan: RehearsalPlan; key: number }>(() => {
    const input = knownInputOf(site, snap)
    return { input, plan: rehearse(site, input), key: 0 }
  })
  const again = () => {
    const input = knownInputOf(site, snap)
    setRun((r) => ({ input, plan: rehearse(site, input), key: r.key + 1 }))
  }
  return (
    <section className="twin-rehearsal" aria-label="Répétition de l’intervention">
      <p className="twin-note">
        PNR rejoue la mission prévue en avance rapide, sur ce qu’il sait (détecteurs, IA, drone), jamais sur la vérité du simulateur. Calculée à {clock(run.plan.builtAtS)}, maintenant {clock(snap.t)}.{' '}
        <button type="button" onClick={again}>
          Refaire la répétition
        </button>
      </p>
      <RehearsalView key={run.key} site={site} input={run.input} plan={run.plan} autoPlay={autoPlay} />
    </section>
  )
}

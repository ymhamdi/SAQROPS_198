import { useMemo } from 'react'
import { Pc } from './panels/Pc'
import { useSim } from './sim/client'
import { buildSite } from './site/site'

type View = 'pc' | 'tablet' | 'hud'

function PcApp() {
  const site = useMemo(() => buildSite(), [])
  const sim = useSim()
  const openCrew = (view: 'tablet' | 'hud') => {
    const url = `${window.location.pathname}?view=${view}`
    if (!window.open(url, `pnr-${view}`)) alert("Le navigateur a bloqué la nouvelle fenêtre : autorisez les fenêtres pour cette page.")
  }
  return <Pc site={site} sim={sim} onOpenCrew={openCrew} />
}

export default function App() {
  const view = (new URLSearchParams(window.location.search).get('view') ?? 'pc') as View
  if (view === 'pc') return <PcApp />
  return <main style={{ padding: 24, fontFamily: 'Barlow, system-ui' }}>Vue {view} : en cours de construction.</main>
}

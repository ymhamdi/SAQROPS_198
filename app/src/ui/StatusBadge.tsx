import type { DataStatus } from '../types'

const TITLES: Record<DataStatus, string> = {
  OBSERVED: 'Mesure réelle',
  DERIVED: 'Calculé à partir de mesures',
  MODELED: 'Hypothèse, corrélation ou valeur normative',
  REPLAY: 'Rejeu d’un enregistrement : pas une mesure',
  SIMULATED: 'Produit par la simulation, pas une mesure',
  MOCK: 'Valeur factice',
}

/** Every value in the UI shows where it comes from (CLAUDE.md R3): SIMULATED and MOCK never look like OBSERVED. */
export function StatusBadge({ status }: { status: DataStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`} title={TITLES[status]}>
      {status}
    </span>
  )
}

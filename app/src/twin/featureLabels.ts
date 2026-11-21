// The 13 inputs of the flashover model (ml/model/contract.json), in plain French for the twin. A missing value is shown
// as a dash with its reason: a failed detector is a missing value, never an invented one.

import { FEATURE_NAMES } from '../ml/features'

interface FeatureLabel {
  label: string
  unit: string
  /** multiplier to the shown unit (a fraction shown as a percentage) */
  scale: number
  digits: number
  /** why the value can be missing */
  missing: string
}

const SLOPE = 'moins de 2 relevés valides'
const NO_FAIL = 'aucune panne pour l’instant'
const NO_NB = 'aucun voisin avec un relevé valide'

export const FEATURE_LABELS: Record<string, FeatureLabel> = {
  self_t_last: { label: 'Température du local', unit: '°C', scale: 1, digits: 0, missing: 'tous les détecteurs du local sont hors service' },
  self_slope_10: { label: 'Pente sur 10 s', unit: '°C/s', scale: 1, digits: 2, missing: SLOPE },
  self_slope_30: { label: 'Pente sur 30 s', unit: '°C/s', scale: 1, digits: 2, missing: SLOPE },
  self_slope_60: { label: 'Pente sur 60 s', unit: '°C/s', scale: 1, digits: 2, missing: SLOPE },
  self_t_max_60: { label: 'Température max sur 60 s', unit: '°C', scale: 1, digits: 0, missing: 'aucun relevé valide sur 60 s' },
  self_frac_failed: { label: 'Détecteurs hors service', unit: '%', scale: 100, digits: 0, missing: 'sans objet' },
  self_s_since_fail: { label: 'Temps depuis la 1re panne', unit: 's', scale: 1, digits: 0, missing: NO_FAIL },
  self_slope_at_fail: { label: 'Pente avant la 1re panne', unit: '°C/s', scale: 1, digits: 2, missing: NO_FAIL },
  nb_t_last_max: { label: 'Voisins : température max', unit: '°C', scale: 1, digits: 0, missing: NO_NB },
  nb_slope_30_max: { label: 'Voisins : pente max sur 30 s', unit: '°C/s', scale: 1, digits: 2, missing: NO_NB },
  nb_frac_failed_max: { label: 'Voisins : détecteurs HS (max)', unit: '%', scale: 100, digits: 0, missing: 'sans objet' },
  nb_s_since_fail_max: { label: 'Voisins : temps depuis 1re panne', unit: 's', scale: 1, digits: 0, missing: 'aucune panne chez les voisins' },
  nb_slope_at_fail_max: { label: 'Voisins : pente avant panne', unit: '°C/s', scale: 1, digits: 2, missing: 'aucune panne chez les voisins' },
}

export interface FeatureRow {
  name: string
  label: string
  unit: string
  /** the value in the shown unit, null when missing */
  value: number | null
  digits: number
  missing: string
}

/** The model's inputs for a room, named and scaled for display (values are in contract order). */
export function featureRows(values: readonly number[]): FeatureRow[] {
  return FEATURE_NAMES.map((name, i) => {
    const f = FEATURE_LABELS[name]
    const raw = values[i]
    const present = Number.isFinite(raw)
    return { name, label: f?.label ?? name, unit: f?.unit ?? '', value: present ? raw * (f?.scale ?? 1) : null, digits: f?.digits ?? 2, missing: f?.missing ?? 'valeur manquante' }
  })
}

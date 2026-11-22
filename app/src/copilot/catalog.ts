// The tablet copilot's closed list of questions (version 1). Each question is an intent of this list; the copilot answers
// nothing else (C5). Rooms and doors are the site's own (data/site/atelier.json); the aliases are the words a crew uses.
// The LLM, when there is one, only maps a sentence to one of these intents: PNR computes every answer (CLAUDE.md, C1–C8).

import type { Site } from '../site/site'

export const INTENTS = [
  'air_restant',
  'demi_tour',
  'sortie',
  'pourquoi_verdict',
  'danger_local',
  'consignes_local',
  'prochain_objectif',
  'dernier_message',
  'vent',
  'etat_porte',
] as const
export type Intent = (typeof INTENTS)[number]

export interface CatalogEntry {
  intent: Intent
  /** the big button of the tablet */
  label: string
  /** phrasings of the specification, used by the tests and the evaluation */
  examples: string[]
  /** the question is about one room or one door: the tablet asks which */
  needs: 'room' | 'door' | null
}

export const CATALOG: readonly CatalogEntry[] = [
  { intent: 'air_restant', label: 'Combien d’air il me reste ?', examples: ['Combien d’air il me reste ?'], needs: null },
  { intent: 'demi_tour', label: 'Quand je fais demi-tour ?', examples: ['Quand je fais demi-tour ?', 'Mon point de non-retour ?'], needs: null },
  { intent: 'sortie', label: 'Par où je sors ?', examples: ['Par où je sors ?', 'Sortie la plus proche ?'], needs: null },
  { intent: 'pourquoi_verdict', label: 'Pourquoi ce verdict ?', examples: ['Pourquoi NO-GO ?', 'Pourquoi GO ?'], needs: null },
  { intent: 'danger_local', label: 'Quel danger dans un local ?', examples: ['Quel danger dans la cabine de peinture ?'], needs: 'room' },
  { intent: 'consignes_local', label: 'Que faire dans un local ?', examples: ['Que faire près du local Li-ion ?', 'Le TGBT ?'], needs: 'room' },
  { intent: 'prochain_objectif', label: 'Prochain objectif ?', examples: ['Où est la victime ?', 'Prochain point ?'], needs: null },
  { intent: 'dernier_message', label: 'Répète le message du PC', examples: ['Répète le message du PC'], needs: null },
  { intent: 'vent', label: 'D’où vient le vent ?', examples: ['D’où vient le vent ?'], needs: null },
  { intent: 'etat_porte', label: 'Une porte est ouverte ?', examples: ['La porte de la cabine est ouverte ?'], needs: 'door' },
]

export const entryOf = (intent: Intent): CatalogEntry => CATALOG.find((e) => e.intent === intent)!

/**
 * Words a crew uses for each room (ids of data/site/atelier.json), longest first within a room. Compared without accents
 * or case, after the same normalisation as the question.
 */
export const ROOM_ALIASES: Record<string, string[]> = {
  solvants: ['stockage des solvants', 'stockage solvants', 'solvants', 'solvant', 'stockage'],
  peinture: ['cabine de peinture', 'cabine peinture', 'cabine', 'peinture'],
  tgbt: ['tableau electrique', 'tableau general', 'local electrique', 'transformateur', 'transfo', 'tgbt'],
  liion: ['local de charge', 'local li ion', 'li ion', 'liion', 'lithium', 'batteries', 'batterie', 'charge'],
  bureaux: ['bureaux', 'bureau'],
  halle: ['halle de production', 'halle', 'production', 'atelier'],
}

/** The rooms a door joins, read from its id: « d-solvants-peinture » joins the solvent store and the paint booth. */
export function roomsOfDoor(site: Site, doorId: string): string[] {
  const ids = new Set(site.rooms.map((r) => r.id))
  return doorId
    .replace(/^d-/, '')
    .split('-')
    .filter((p) => ids.has(p))
}

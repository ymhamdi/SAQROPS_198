// From a question to an intent of the catalogue, by rules: always available (no server, no LLM, the deployed site), and
// the fallback whenever the LLM is down, slow, unsure or invalid (C5). Checked in this order, before anything else:
//   1. MAYDAY words (C6): never reach the LLM;
//   2. engagement questions (C3): answered by the verdict, never by yes or no;
//   3. orders (open, ignore, invent…): the copilot acts on nothing (C1) and says what it answers (C5);
//   4. the intents of the catalogue, with the room or the door they name.

import type { Site } from '../site/site'
import { type Intent, ROOM_ALIASES, roomsOfDoor } from './catalog'

export type Understanding =
  | { kind: 'mayday'; words: string }
  | { kind: 'engagement' }
  | { kind: 'hors_liste'; why: 'ordre' | 'inconnu' }
  | { kind: 'intent'; intent: Intent; room: string | null; door: string | null }

/** Lower case, no accents, no punctuation: « D’où vient le vent ? » → « d ou vient le vent ». */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** C6: the MAYDAY words, matched on the normalised text before any understanding. */
export const MAYDAY =
  /\b(mayday|m aidez|sos|au secours|je suis bloque|suis bloque|je suis coince|suis coince|je suis perdu|suis perdu|plus d air|j ai plus d air|n ai plus d air)\b/

/** C3: asking whether to go in, on, or continue: the answer is the verdict and its reasons, never yes or no. */
const ENGAGE =
  /\b((je|on) (peux|peut|pourrais|pourrait|dois|doit)|puis je|peut on|est ce que (je|j|on) (peux|peut|dois|doit)|est ce qu on (peut|doit))( y)? (entrer|rentrer|aller|continuer|avancer|engager|passer|progresser|reprendre|y aller)\b|\bon y va\b|\bj y vais\b|\bon entre\b|\bje rentre\b|\bj entre\b|\bc est go\b|\bgo ou (pas|no go)\b|\bon engage\b|\bje continue\b|\bon continue\b/

/** C1 + C5: an order. The copilot reads; it opens, closes, ignores, cancels or invents nothing. */
const ORDER =
  /^(ouvre|ouvrez|ferme|fermez|ignore|ignorez|annule|annulez|invente|inventez|efface|effacez|desactive|desactivez|coupe|coupez|change|changez|modifie|modifiez|valide|validez|lance|lancez|envoie|envoyez|retire|retirez|ajoute|ajoutez|declenche|declenchez)\b|\b(ignore|ignorer|ignorez|annule|annuler|efface|effacer) (l |les |cette |ces |mon |ma )?(alerte|alertes|alarme|no go|verdict)\b|\binvent(e|er|ez)\b|\b(ouvr|ferm)(e|ez|ir|er) (la|une|les|cette) portes?\b/

const DOOR_STATE = /\bportes?\b/
const CONSIGNES = /\b(consignes?|que faire|quoi faire|qu est ce que je fais|precautions?|procedures?|reflexes?|conduite a tenir|comment (j )?(agir|agis|intervenir|faire))\b/
const MESSAGE = /\b(messages?|repete|repeter|repetez|redis|redire|redites|qu a dit le pc|pc a dit|le pc dit)\b/
const WIND = /\bvents?\b/
const WHY = /\b(pourquoi|raisons?|explique|expliquer)\b/
const DANGER = /\b(dangers?|dangereux|dangereuse|risques?|chaud|chaleur|temperature|embrasement|flashover|fumees?|brule|etat du local|ca craint)\b/
const TURN_BACK = /\b(demi tour|faire demi|point de non retour|non retour|pnr|marge|rebrousser|marche arriere)\b/
const AIR = /\b(air|pression|bouteille|ari|autonomie|bars?|reserve)\b/
const EXIT = /\b(sortie|sorties|sortir|sors|ressortir|evacuer|evacuation|issue|par ou)\b/
const OBJECTIVE = /\b(victime|victimes|objectif|objectifs|prochain|prochaine|ou je vais|ou aller|mission|cible)\b/

/** The room a normalised question names, by its longest alias (« cabine de peinture » before « cabine »). */
export function roomIn(t: string): string | null {
  let best: { id: string; len: number } | null = null
  for (const [id, aliases] of Object.entries(ROOM_ALIASES)) {
    for (const a of aliases) {
      if (new RegExp(`\\b${a}\\b`).test(t) && (!best || a.length > best.len)) best = { id, len: a.length }
    }
  }
  return best?.id ?? null
}

/** Every room a question names, in the order they appear: « porte entre stockage et cabine » → solvants, peinture. */
function roomsIn(t: string): string[] {
  const hits: { id: string; at: number }[] = []
  for (const [id, aliases] of Object.entries(ROOM_ALIASES)) {
    const at = Math.min(...aliases.map((a) => t.search(new RegExp(`\\b${a}\\b`))).filter((i) => i >= 0))
    if (Number.isFinite(at)) hits.push({ id, at })
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id)
}

/**
 * The door a question names: the door joining the two rooms named, or the only door of the one room named. Null when it
 * is ambiguous: the answer then lists the doors of that room.
 */
export function doorIn(site: Site, t: string): string | null {
  const rooms = roomsIn(t)
  if (rooms.length === 0) return null
  const doors = site.doors.filter((d) => {
    const joined = roomsOfDoor(site, d.id)
    return rooms.every((r) => joined.includes(r))
  })
  return doors.length === 1 ? doors[0].id : null
}

export function understandRules(text: string, site: Site): Understanding {
  const t = normalise(text)
  const mayday = t.match(MAYDAY)
  if (mayday) return { kind: 'mayday', words: mayday[0] }
  if (ENGAGE.test(t)) return { kind: 'engagement' }
  if (ORDER.test(t)) return { kind: 'hors_liste', why: 'ordre' }
  const room = roomIn(t)
  const intent = (i: Intent, withRoom = false, withDoor = false): Understanding => ({
    kind: 'intent',
    intent: i,
    room: withRoom || withDoor ? room : null,
    door: withDoor ? doorIn(site, t) : null,
  })
  if (DOOR_STATE.test(t)) return intent('etat_porte', false, true)
  if (CONSIGNES.test(t)) return intent('consignes_local', true)
  if (MESSAGE.test(t)) return intent('dernier_message')
  if (WIND.test(t)) return intent('vent')
  if (WHY.test(t)) return intent('pourquoi_verdict')
  if (DANGER.test(t)) return intent('danger_local', true)
  if (TURN_BACK.test(t)) return intent('demi_tour')
  if (AIR.test(t)) return intent('air_restant')
  if (EXIT.test(t)) return intent('sortie')
  if (OBJECTIVE.test(t)) return intent('prochain_objectif')
  // « Le TGBT ? »: a room alone asks what to do there (catalogue example).
  if (room) return intent('consignes_local', true)
  return { kind: 'hors_liste', why: 'inconnu' }
}

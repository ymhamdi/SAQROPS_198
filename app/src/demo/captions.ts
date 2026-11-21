// What the narration bar says at each moment of the automatic demo. Plain events, no number (R3) and no verdict word:
// the verdict is shown, with its « Décision : COS », by the PC and the tablet (R2); the HUD keeps to its short alerts.

import type { DemoScene } from './script'

export interface Caption {
  /** step of the video script (CLAUDE.md §9) the scene belongs to */
  step: number
  text: string
}

/** Steps of the story with the rehearsal, and without it. */
export const STEPS = 8
export const STEPS_WITHOUT_REHEARSAL = 6

export const CAPTIONS: Record<DemoScene, Caption> = {
  fire: { step: 1, text: 'Départ de feu dans le stockage solvants : les détecteurs réagissent.' },
  drone: { step: 2, text: 'Le drone décolle de l’engin et fait le tour du bâtiment, hors du panache.' },
  indoor: { step: 3, text: 'Le drone d’intérieur entre par la sortie Ouest, passe par les portes ouvertes et découvre un passage obstrué ; derrière une porte fermée, le local reste INCONNU.' },
  rehearsal: { step: 4, text: 'PNR répète l’intervention sur ce qu’il sait, en vue première personne : itinéraire, air, contournement et heure de demi-tour. Le COS valide le plan.' },
  engaged: { step: 5, text: 'Le binôme est engagé sur le plan validé vers la victime puis la coupure électrique : itinéraire, air et point de non-retour en direct.' },
  nogo: { step: 6, text: 'Des détecteurs tombent en panne, l’IA annonce l’embrasement du local voisin : le binôme est rappelé par un nouvel itinéraire vers la sortie.' },
  door: { step: 7, text: 'Le COS ferme la porte stockage ↔ cabine : le délai d’embrasement prédit remonte, le rappel reste verrouillé.' },
  out: { step: 7, text: 'Binôme sorti, air au-dessus du sifflet. Le rappel reste verrouillé : seul le COS peut ré-engager.' },
  reengaged: { step: 8, text: 'Décision COS : l’objectif cabine est retiré et le binôme ré-engagé. Le nouvel itinéraire arrive en direct sur la tablette et le HUD.' },
  end: { step: 8, text: 'Fin de la démonstration. Simulation : le verdict est une aide, la décision appartient au COS.' },
}

/** The caption of a scene and where it stands in the story: without the rehearsal the story has two steps fewer. */
export function captionOf(scene: DemoScene, withRehearsal: boolean): Caption & { steps: number } {
  const c = CAPTIONS[scene]
  return withRehearsal ? { ...c, steps: STEPS } : { ...c, step: c.step > 2 ? c.step - 2 : c.step, steps: STEPS_WITHOUT_REHEARSAL }
}

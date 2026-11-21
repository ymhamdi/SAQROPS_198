// What the narration bar says at each moment of the automatic demo. Plain events, no number (R3) and no verdict word:
// the verdict is shown, with its « Décision : COS », by the PC and the tablet (R2); the HUD keeps to its short alerts.

import type { DemoScene } from './script'

export interface Caption {
  /** step of the video script (CLAUDE.md §9) the scene belongs to */
  step: number
  text: string
}

export const STEPS = 6

export const CAPTIONS: Record<DemoScene, Caption> = {
  fire: { step: 1, text: 'Départ de feu dans le stockage solvants : les détecteurs réagissent.' },
  drone: { step: 2, text: 'Le drone décolle de l’engin et fait le tour du bâtiment, hors du panache.' },
  engaged: { step: 3, text: 'Le COS engage un binôme vers la victime puis la coupure électrique : itinéraire, air et point de non-retour en direct.' },
  nogo: { step: 4, text: 'Les détecteurs du local voisin, la cabine de peinture, tombent en panne sous la chaleur : le binôme est rappelé par un nouvel itinéraire vers la sortie.' },
  door: { step: 5, text: 'Le COS ferme la porte stockage ↔ cabine : le rappel reste verrouillé.' },
  out: { step: 5, text: 'Binôme sorti, air au-dessus du sifflet. Le rappel reste verrouillé : seul le COS peut ré-engager.' },
  reengaged: { step: 6, text: 'Décision COS : l’objectif cabine est retiré et le binôme ré-engagé. Le nouvel itinéraire arrive en direct sur la tablette et le HUD.' },
  end: { step: 6, text: 'Fin de la démonstration. Simulation : le verdict est une aide, la décision appartient au COS.' },
}

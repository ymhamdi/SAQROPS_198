// What the copilot says, for each intent of the catalogue: built only from the snapshot the tablet already receives from the
// PC, data/consignes.json and data/config.json (C1). Every number of an answer is one of its items, with its label (C2,
// R3). The consignes are read as written, with their source (C4). The verdict is never a yes or a no (C3), and anything
// outside the list gets the same refusal (C5). It never reads the simulator's truth (R5): `rooms[].truth` is not used here.

import consignes from '../../../data/consignes.json' with { type: 'json' }
import { clock } from '../panels/clock'
import { nextStep } from '../panels/crew'
import type { Snapshot } from '../sim/protocol'
import { cellCentre, type Site } from '../site/site'
import { airParams, usableL } from '../stats/air'
import { worstStatus } from '../stats/status'
import { DECISION_COS } from '../stats/verdict'
import type { DataStatus } from '../types'
import { type Intent, roomsOfDoor } from './catalog'

/** Shown with every answer of the copilot (C7). */
export const COPILOT = 'COPILOTE'

export interface AnswerItem {
  label: string
  value: number | null
  unit: string
  status: DataStatus
  digits?: number
}

export interface Answer {
  kind: 'answer' | 'refusal' | 'mayday' | 'which'
  intent: Intent | null
  /** the sentence shown and read aloud */
  text: string
  /** every number of the text, with its label */
  items: AnswerItem[]
  /** consignes: each one as written, with its source */
  sources: { text: string; source: string }[]
  /** the tablet asks which room or door the question is about */
  needs?: 'room' | 'door'
}

/** C5: outside the list, unsure, or an order. */
export const OUT_OF_LIST = 'Je ne réponds qu’aux questions de la liste. Demandez au COS.'
/** C6: what the tablet says once the MAYDAY is on its way to the PC. */
export const MAYDAY_SENT = 'MAYDAY transmis au PC du COS.'

const answer = (intent: Intent | null, text: string, items: AnswerItem[] = [], sources: Answer['sources'] = []): Answer => ({
  kind: 'answer',
  intent,
  text,
  items,
  sources,
})

/** A number as the text shows it: French decimal comma, no trailing zeros. */
export function numText(value: number, digits = 0): string {
  return value.toFixed(digits).replace('.', ',')
}

const liveStatus = (s: Snapshot): DataStatus => worstStatus('MODELED', s.readingsStatus)

/** C3 and pourquoi_verdict: the verdict as the PC shows it, its reasons as written, and « Décision : COS ». */
export function verdictAnswer(s: Snapshot): Answer {
  const reasons = s.shown.reasons.filter((r) => r.severity !== 'info')
  const why = reasons.length ? ` Raisons : ${reasons.map((r) => r.message.replace(/\.$/, '')).join(' ; ')}.` : ''
  return { ...answer('pourquoi_verdict', `Verdict actuel : ${s.shown.verdict}.${why} ${DECISION_COS}.`), kind: 'answer' }
}

export function refusal(): Answer {
  return { kind: 'refusal', intent: null, text: OUT_OF_LIST, items: [], sources: [] }
}

/** Metres left along the team's route, from where it is to the end of the track (the exit when it is evacuating). */
function routeToEndM(site: Site, s: Snapshot): number | null {
  const { track, index } = s.team
  if (track.length < 2) return null
  let m = 0
  for (let k = Math.max(1, index + 1); k < track.length; k++) {
    const a = cellCentre(site, track[k - 1])
    const b = cellCentre(site, track[k])
    m += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return m
}

const CONDITION: Record<string, string> = {
  clear: 'pas d’anomalie relevée par les détecteurs',
  smoke: 'fumée relevée par les détecteurs',
  hot: 'chaleur anormale relevée par les détecteurs',
  failed: 'détecteurs en panne',
}

/** The AI's flashover delay, never to the second: in bands (the specification). */
export function delayBand(tffS: number): string {
  if (tffS < 60) return 'moins d’1 min'
  if (tffS <= 120) return '1 à 2 min'
  return 'plus de 2 min'
}

const CARDINAL = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']

export function answerFor(intent: Intent, target: { room: string | null; door: string | null }, site: Site, s: Snapshot): Answer {
  const live = liveStatus(s)
  const ap = airParams()
  switch (intent) {
    case 'air_restant': {
      const lpm = s.team.mode === 'evacuating' ? ap.exitLpm : ap.approachLpm
      const minutes = Math.max(0, usableL(ap, s.team.bar) / lpm)
      const st = worstStatus(live, 'MODELED')
      return answer(
        intent,
        `Pression ARI : ${numText(s.team.bar)} bar. Environ ${numText(minutes)} min avant le sifflet à ${numText(ap.whistleBar)} bar, à ${numText(lpm)} L/min.`,
        [
          { label: 'Pression ARI', value: s.team.bar, unit: 'bar', status: live },
          { label: 'Autonomie estimée avant le sifflet', value: minutes, unit: 'min', status: st },
          { label: 'Sifflet', value: ap.whistleBar, unit: 'bar', status: 'MODELED' },
          { label: 'Consommation retenue', value: lpm, unit: 'L/min', status: 'MODELED' },
        ],
      )
    }
    case 'demi_tour': {
      const margin = s.team.pnrMarginBar
      if (margin === null) return answer(intent, 'Pas de point de non-retour calculé : le binôme n’est pas engagé.')
      const st = worstStatus(live, 'MODELED')
      const minutes = Math.max(0, (margin * ap.cylinderL) / ap.approachLpm)
      const text =
        margin <= 0
          ? `Marge PNR épuisée : ${numText(margin)} bar. Le point de non-retour est atteint.`
          : `Marge avant le point de non-retour : ${numText(margin)} bar, environ ${numText(minutes)} min à ${numText(ap.approachLpm)} L/min.`
      return answer(intent, text, [
        { label: 'Marge PNR', value: margin, unit: 'bar', status: st },
        { label: 'Temps avant le demi-tour', value: minutes, unit: 'min', status: st },
        { label: 'Consommation retenue', value: ap.approachLpm, unit: 'L/min', status: 'MODELED' },
      ])
    }
    case 'sortie': {
      const lastCell = s.team.track.at(-1)
      const exit = lastCell === undefined ? undefined : site.doors[site.door[lastCell]]
      const m = routeToEndM(site, s)
      if (!exit || m === null) return answer(intent, 'Pas d’itinéraire de sortie calculé pour l’instant : le binôme n’est pas engagé.')
      const items: AnswerItem[] = [{ label: 'Distance par l’itinéraire', value: m, unit: 'm', status: live }]
      let text = `Sortie : ${exit.name}, à ${numText(m)} m par l’itinéraire affiché.`
      if (s.team.toExitS !== null) {
        const min = s.team.toExitS / 60
        items.push({ label: 'Temps de sortie estimé', value: min, unit: 'min', status: worstStatus(live, 'MODELED'), digits: 1 })
        text += ` Environ ${numText(min, 1)} min.`
      }
      return answer(intent, text, items)
    }
    case 'pourquoi_verdict':
      return verdictAnswer(s)
    case 'danger_local': {
      if (!target.room) return { ...answer(intent, 'Quel local ?'), kind: 'which', needs: 'room' }
      const r = site.rooms.findIndex((x) => x.id === target.room)
      const room = site.rooms[r]
      const view = s.rooms[r]
      const known = s.known.active ? s.known.rooms[r] : null
      if (!view) return answer(intent, `${room.name} : INCONNU, aucune donnée.`)
      let text =
        view.condition === 'failed'
          ? `${room.name} : INCONNU, détecteurs en panne (${view.status}).`
          : `${room.name} : ${CONDITION[view.condition] ?? 'INCONNU'} (${view.status}).`
      if (view.pred?.alert) text += ` IA : embrasement prédit dans ${delayBand(view.pred.tffS)} (${view.pred.status}).`
      else if (view.pred) text += ` IA : pas d’embrasement prédit à court terme (${view.pred.status}).`
      if (known?.unknown) text += ' Drone : local INCONNU, aucune observation récente.'
      return answer(intent, text)
    }
    case 'consignes_local': {
      if (!target.room) return { ...answer(intent, 'Quel local ?'), kind: 'which', needs: 'room' }
      const room = site.rooms.find((x) => x.id === target.room)!
      const hazards = room.hazards.filter((h): h is keyof typeof consignes.hazards => h in consignes.hazards)
      const sources = hazards.flatMap((h) => consignes.hazards[h].items.map((i) => ({ text: i.text, source: i.source })))
      if (sources.length === 0) return answer(intent, `${room.name} : aucune consigne dans la liste. Demandez au COS.`)
      const names = hazards.map((h) => consignes.hazards[h].name).join(', ')
      return answer(intent, `${room.name} — ${names}. Consignes, à valider par la Protection civile :`, [], sources)
    }
    case 'prochain_objectif': {
      const next = nextStep(site, s)
      if (s.team.mode === 'engaged' && next) {
        return answer(intent, `Prochain objectif : ${next.label}, à ${numText(next.distanceM)} m par l’itinéraire.`, [
          { label: 'Distance par l’itinéraire', value: next.distanceM, unit: 'm', status: live },
        ])
      }
      const id = s.team.objectives[0]
      const o = id ? site.objectives.find((x) => x.id === id) : undefined
      return answer(intent, o ? `Objectif prévu : ${o.name}. Le binôme n’est pas en progression vers lui.` : 'Aucun objectif en cours.')
    }
    case 'dernier_message': {
      const note = s.notes.at(-1)
      return answer(intent, note ? `Dernier message du PC, à ${clock(note.t)} : ${note.text}` : 'Aucun message du PC pour l’instant.')
    }
    case 'vent': {
      const w = s.drone.wind
      const from = CARDINAL[Math.round((((w.fromDeg % 360) + 360) % 360) / 45) % 8]
      return answer(intent, `Vent du ${from}, ${numText(w.speedMs, 1)} m/s (${w.status}, analyse météo Open-Meteo, pas une mesure sur site).`, [
        { label: 'Vitesse du vent', value: w.speedMs, unit: 'm/s', status: w.status, digits: 1 },
        { label: 'Vient du', value: w.fromDeg, unit: '°', status: w.status },
      ])
    }
    case 'etat_porte': {
      const doors = target.door
        ? site.doors.filter((d) => d.id === target.door)
        : target.room
          ? site.doors.filter((d) => roomsOfDoor(site, d.id).includes(target.room!))
          : []
      if (doors.length === 0) return { ...answer(intent, 'Quelle porte ?'), kind: 'which', needs: 'door' }
      const lines = doors.map((d) => {
        const k = s.known.doors.find((x) => x.door === site.doors.indexOf(d))
        return k ? `${d.name} : vue ${k.open ? 'ouverte' : 'fermée'} par le drone à ${clock(k.takenAtS)}` : `${d.name} : INCONNU, aucune observation`
      })
      return answer(intent, `${lines.join('. ')}.`)
    }
  }
}

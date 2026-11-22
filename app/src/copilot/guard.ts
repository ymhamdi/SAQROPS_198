// C2: the check on any wording the LLM proposes for an answer PNR has already computed (adapted from Martian Map's guard,
// in French; the server applies the same rules in server/guard.py). A rewording is rejected, and the template is said
// instead, if it:
//   - contains a number that is not in the template (the template holds every number of the answer, from the snapshot);
//   - writes a number in words: deux … mille, demi, quart, dizaine… and « un » / « une » before a unit (« une minute »,
//     « un bar »): as an article (« un local ») « un » is allowed, or nearly every French sentence would be rejected;
//   - is longer than the configured word limit (30).

import { H, v } from '../config'

const NUMBER = /\d+(?:[.,:]\d+)?/g
const SPELLED =
  /\b(zero|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|vingts|trente|quarante|cinquante|soixante|septante|nonante|cent|cents|mille|demi|demie|quart|quarts|dizaine|dizaines|douzaine|centaine|centaines|moitie)\b/
const ONE_UNIT =
  /\b(un|une)\s+(seule?\s+)?(bars?|minutes?|min|secondes?|heures?|metres?|m|litres?|degres?|kilometres?|km|pour cent|tiers)\b/

/** Lower case without accents, so « zéro », « moitié » and « mètre » are caught like « zero », « moitie », « metre ». */
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** « 3,0 » and « 3 » are the same number; « 3,5 » and « 3.5 » too. */
const canon = (n: string) => {
  if (n.includes(':')) return n
  const x = n.replace(',', '.')
  return x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x
}

export const maxWords = (): number => v(H.copilot.maxWords)

export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(canon)
}

export type GuardVerdict = { ok: true } | { ok: false; why: 'chiffre' | 'lettres' | 'longueur' | 'vide' }

/** Is this rewording of `template` safe to say? Every number must be one of the template's. */
export function checkWording(text: string, template: string): GuardVerdict {
  const words = text.split(/\s+/).filter(Boolean).length
  if (words === 0) return { ok: false, why: 'vide' }
  const allowed = new Set(numbersIn(template))
  if (numbersIn(text).some((n) => !allowed.has(n))) return { ok: false, why: 'chiffre' }
  const p = plain(text)
  if (SPELLED.test(p) || ONE_UNIT.test(p)) return { ok: false, why: 'lettres' }
  if (words > maxWords()) return { ok: false, why: 'longueur' }
  return { ok: true }
}

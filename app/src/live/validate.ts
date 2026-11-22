// What the live channel lets through. BroadcastChannel carries any structured-cloneable value from any window of the same
// origin, so a receiver must not trust the shape of a message: a null or half-built snapshot would unmount the window that
// shows the verdict. These checks are structural (the fields the screens read without a guard), not a signature: the link
// is two windows of one browser, and the PC stays the only master (R1, R2 and R6 are enforced in its worker).

import type { CopilotEntry } from '../copilot/pipeline'
import type { Snapshot } from '../sim/protocol'

const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max

/** A snapshot with the fields every crew screen reads without a guard. */
export function isSnapshot(x: unknown): x is Snapshot {
  if (!obj(x)) return false
  const { shown, team, hardware, drone } = x
  return (
    num(x.t) &&
    Array.isArray(x.rooms) &&
    Array.isArray(x.notes) &&
    typeof x.latched === 'boolean' &&
    obj(shown) &&
    (shown.verdict === 'GO' || shown.verdict === 'NO-GO') &&
    Array.isArray(shown.reasons) &&
    obj(team) &&
    Array.isArray(team.track) &&
    Array.isArray(team.objectives) &&
    obj(hardware) &&
    Array.isArray(hardware.critical) &&
    obj(drone)
  )
}

const PATHS = ['llm', 'regles', 'bouton', 'sos']

/** One exchange of the copilot, as the PC logs it: bounded strings, finite numbers. */
export function isCopilotEntry(x: unknown): x is CopilotEntry {
  return obj(x) && str(x.id, 80) && num(x.t) && str(x.question, 1000) && str(x.intent, 80) && str(x.answer, 4000) && typeof x.path === 'string' && PATHS.includes(x.path) && num(x.latencyMs) && typeof x.mayday === 'boolean'
}

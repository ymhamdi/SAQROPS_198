// What the PC shows of the tablet copilot: a MAYDAY as a red alert until the COS acknowledges it (C6), and the log of every
// exchange: question, intent, answer, path (LLM, rules, button, SOS) and latency (C7). Neither changes the verdict.

import { clock } from '../panels/clock'
import type { CopilotEntry, CopilotPath } from './pipeline'
import './copilot.css'

const PATH_LABEL: Record<CopilotPath, string> = { llm: 'LLM', regles: 'règles', bouton: 'bouton', sos: 'SOS' }

export function CopilotMaydays({ maydays, onAcknowledge }: { maydays: CopilotEntry[]; onAcknowledge: (id: string) => void }) {
  if (maydays.length === 0) return null
  return (
    <section className="pc-mayday" role="alert">
      {maydays.map((m) => (
        <div key={m.id}>
          <strong>MAYDAY binôme · {clock(m.t)}</strong>
          <span>
            {m.path === 'sos' ? 'Bouton SOS de la tablette' : `« ${m.question} »`} · transmis par le copilote. Verdict inchangé · Décision : COS.
          </span>
          <button type="button" onClick={() => onAcknowledge(m.id)}>
            Acquitter
          </button>
        </div>
      ))}
    </section>
  )
}

export function CopilotLogCard({ entries }: { entries: CopilotEntry[] }) {
  return (
    <section className="pc-card">
      <span className="pc-kick">Copilote de la tablette · journal</span>
      {entries.length === 0 ? (
        <p className="pc-note">Aucune question posée.</p>
      ) : (
        <ul className="pc-log pc-copilot-log">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className={e.mayday ? 'is-mayday' : undefined}>
              <span>{clock(e.t)}</span> « {e.question} » → <code>{e.intent}</code> · {PATH_LABEL[e.path]} · {e.latencyMs} ms
              <br />
              <small>COPILOTE : {e.answer}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

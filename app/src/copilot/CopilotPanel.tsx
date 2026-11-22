// The copilot on the tablet: a big « Parler » button, the questions of the catalogue as big buttons (they work with no server
// and no microphone: the reliable path of the demo), an answer card marked COPILOTE with its numbers and their labels and
// the source of every consigne, the copilot's state, and a red SOS button. Glove-sized targets. It reads the snapshot the
// tablet already receives and acts on nothing (C1); the HUD shows none of it (C8).

import { useState } from 'react'
import type { Snapshot } from '../sim/protocol'
import type { Site } from '../site/site'
import { Num } from '../ui/Num'
import { type Answer, answerFor, COPILOT } from './answers'
import { CATALOG, type Intent } from './catalog'
import './copilot.css'

export type CopilotState = 'llm' | 'rules' | 'novoice'

const STATE_TEXT: Record<CopilotState, string> = { llm: 'LLM local prêt', rules: 'Mode règles', novoice: 'Voix indisponible' }

export function CopilotPanel({ site, snap, state = 'rules' }: { site: Site; snap: Snapshot; state?: CopilotState }) {
  const [reply, setReply] = useState<Answer | null>(null)
  const [asking, setAsking] = useState<Intent | null>(null)

  const ask = (intent: Intent, room: string | null = null, door: string | null = null) => {
    const a = answerFor(intent, { room, door }, site, snap)
    setReply(a)
    setAsking(a.kind === 'which' ? intent : null)
  }
  const needs = reply?.kind === 'which' ? reply.needs : undefined

  return (
    <section className="copilot" aria-label="Copilote">
      <header className="copilot-head">
        <span className="crew-kick">Copilote</span>
        <span className={`copilot-state is-${state}`}>{STATE_TEXT[state]}</span>
      </header>
      <div className="copilot-main">
        <button type="button" className="copilot-talk" disabled aria-disabled="true">
          Parler
        </button>
        <button type="button" className="copilot-sos">
          SOS
        </button>
      </div>
      <div className="copilot-questions" role="group" aria-label="Questions de la liste">
        {CATALOG.map((e) => (
          <button key={e.intent} type="button" aria-pressed={asking === e.intent} onClick={() => ask(e.intent)}>
            {e.label}
          </button>
        ))}
      </div>
      {needs && asking && (
        <div className="copilot-pick" role="group" aria-label={needs === 'room' ? 'Quel local ?' : 'Quelle porte ?'}>
          {needs === 'room'
            ? site.rooms.map((r) => (
                <button key={r.id} type="button" onClick={() => ask(asking, r.id)}>
                  {r.name}
                </button>
              ))
            : site.doors
                .filter((d) => d.id.startsWith('d-'))
                .map((d) => (
                  <button key={d.id} type="button" onClick={() => ask(asking, null, d.id)}>
                    {d.name}
                  </button>
                ))}
        </div>
      )}
      {reply && reply.kind !== 'which' && <AnswerCard answer={reply} />}
    </section>
  )
}

export function AnswerCard({ answer }: { answer: Answer }) {
  return (
    <article className={`copilot-answer is-${answer.kind}`} aria-live="polite">
      <span className="copilot-tag">{COPILOT}</span>
      <p>{answer.text}</p>
      {answer.items.length > 0 && (
        <ul className="copilot-items">
          {answer.items.map((i) => (
            <li key={i.label}>
              {i.label} <Num value={i.value} unit={i.unit} status={i.status} digits={i.digits ?? 0} />
            </li>
          ))}
        </ul>
      )}
      {answer.sources.length > 0 && (
        <ol className="copilot-sources">
          {answer.sources.map((s, k) => (
            <li key={k}>
              {s.text} <small>Source : {s.source}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

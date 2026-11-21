import { useState } from 'react'
import type { SavedPlan } from '../saved'
import { formatDuration } from '../stats/format'
import { CloseIcon } from '../ui/icons'

interface Props {
  plans: SavedPlan[]
  /** the plan on screen: its link hash, a name to suggest, and whether it can be saved (a route is planned) */
  current: { hash: string; defaultName: string; canSave: boolean }
  onSave: (name: string) => void
  onOpen: (plan: SavedPlan) => void
  /** resolves false when the clipboard refused */
  onCopy: (plan: SavedPlan) => Promise<boolean>
  onDelete: (plan: SavedPlan) => void
  onRestore: (plan: SavedPlan) => void
  onClose: () => void
}

const savedOn = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Save the plan on screen, and open, share or delete saved plans. Saved plans live in this browser. */
export function SavedPlans({ plans, current, onSave, onOpen, onCopy, onDelete, onRestore, onClose }: Props) {
  const savedAs = plans.find((p) => p.hash === current.hash) ?? null
  const [copied, setCopied] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<SavedPlan | null>(null)

  async function copy(p: SavedPlan) {
    const ok = await onCopy(p)
    setCopied(ok ? p.id : null)
    if (ok) setTimeout(() => setCopied((id) => (id === p.id ? null : id)), 2000)
  }

  return (
    <section className="card side-panel" aria-label="Saved plans">
      <header className="layers-head">
        <h2>Saved plans</h2>
        <button type="button" className="icon-btn" aria-label="Close saved plans" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>

      {!current.canSave ? (
        <p className="note">Plan a route, then save it here.</p>
      ) : savedAs ? (
        <p className="saved-current">
          The plan on the map is saved as <strong>{savedAs.name}</strong>.
        </p>
      ) : (
        <SaveForm key={current.hash} defaultName={current.defaultName} onSave={onSave} />
      )}

      {deleted && (
        <p className="saved-undo" role="status">
          Deleted {deleted.name}.
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              onRestore(deleted)
              setDeleted(null)
            }}
          >
            Undo
          </button>
        </p>
      )}

      {plans.length > 0 && (
        <ul className="saved-list">
          {plans.map((p) => {
            const isOpen = p.hash === current.hash
            return (
              <li key={p.id} className={isOpen ? 'is-open' : undefined}>
                <div className="saved-head">
                  <strong>{p.name}</strong>
                  {p.summary.verdict && <span className={`saved-verdict ${p.summary.verdict === 'GO' ? 'is-go' : 'is-nogo'}`}>{p.summary.verdict}</span>}
                </div>
                <p className="saved-meta">
                  {p.summary.stops} {p.summary.stops === 1 ? 'stop' : 'stops'}
                  {p.summary.totalS !== null && ` · ${formatDuration(p.summary.totalS)}`} · start {p.summary.start.split(' (')[0]}
                </p>
                <p className="saved-date">Saved {savedOn(p.savedAt)}</p>
                <div className="saved-actions">
                  <button type="button" className="btn-chip" disabled={isOpen} onClick={() => onOpen(p)}>
                    {isOpen ? 'On the map' : 'Open'}
                  </button>
                  <button type="button" className="btn-chip" onClick={() => copy(p)}>
                    {copied === p.id ? 'Link copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    className="btn-chip is-quiet"
                    onClick={() => {
                      onDelete(p)
                      setDeleted(p)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="note">
        {plans.length === 0 ? 'No saved plans yet. ' : ''}Saved plans stay in this browser. Copy a plan's link to open it on another device or send it to the
        crew.
      </p>
    </section>
  )
}

function SaveForm({ defaultName, onSave }: { defaultName: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(defaultName)
  return (
    <form
      className="save-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(name.trim() || defaultName)
      }}
    >
      <label htmlFor="plan-name">Name this plan</label>
      <div className="save-row">
        <input id="plan-name" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn-primary">
          Save
        </button>
      </div>
    </form>
  )
}

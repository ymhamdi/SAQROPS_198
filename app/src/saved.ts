// Saved plans, kept in this browser (localStorage; the app has no backend). Each one stores its plan link hash
// (share.ts), so opening it is opening the link, and copying its link shares it with anyone.

export interface SavedPlan {
  id: string
  name: string
  /** ISO UTC */
  savedAt: string
  /** the plan link hash, '#stops=…' */
  hash: string
  /** shown in the list; taken when the plan was saved */
  summary: {
    stops: number
    /** "07:30 Mars local (10:25 UTC)" */
    start: string
    totalS: number | null
    verdict: 'GO' | 'NO-GO' | null
  }
}

/** localStorage key; bump the version if SavedPlan changes shape. */
export const SAVED_PLANS_KEY = 'martian-map.saved-plans.v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null // blocked storage (private mode, site data off)
  }
}

/** The saved plans, newest first; [] when storage is empty, unreadable or blocked. */
export function loadSavedPlans(store: Store | null = browserStore()): SavedPlan[] {
  try {
    const list: unknown = JSON.parse(store?.getItem(SAVED_PLANS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p): p is SavedPlan => typeof p?.hash === 'string' && typeof p?.name === 'string') : []
  } catch {
    return []
  }
}

/** Write the list; false when the browser refuses (blocked or full). */
export function storeSavedPlans(list: SavedPlan[], store: Store | null = browserStore()): boolean {
  try {
    if (!store) return false
    store.setItem(SAVED_PLANS_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** Add a plan at the top. The same plan saved again replaces its older copy (new name, new time). */
export function withPlanSaved(list: SavedPlan[], plan: Omit<SavedPlan, 'id'>, id: string): SavedPlan[] {
  return [{ ...plan, id }, ...list.filter((p) => p.hash !== plan.hash)]
}

/** The absolute link that opens a saved plan. */
export function planLink(hash: string, location: Pick<Location, 'origin' | 'pathname'>): string {
  return `${location.origin}${location.pathname}${hash}`
}

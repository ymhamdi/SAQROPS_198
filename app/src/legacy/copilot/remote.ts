// Where the crew laptop is when the app is not served from it (the static Vercel site). The laptop exposes its copilot
// server (speech-to-text + the language model), or Ollama alone, through an https tunnel. The browser learns the
// address in one of three ways, in this order:
//   1. `?copilot=<url>` / `?ollama=<url>` in the page address, remembered in this browser (`=off` turns it off);
//   2. VITE_COPILOT_URL / VITE_OLLAMA_URL at build time;
//   3. the GitHub gist that server/start-llm-tunnel.ps1 updates with the tunnel's current address, so any browser
//      finds the laptop from the plain site link even though a quick tunnel's address changes on every run.
// An address is used only once it answers. Without one the copilot carries on in rules mode.

export type Remote = 'copilot' | 'ollama'

const STORE_KEY: Record<Remote, string> = { copilot: 'martian-map.copilot-url', ollama: 'martian-map.ollama-url' }
const BUILD_URL: Record<Remote, string | undefined> = {
  copilot: import.meta.env.VITE_COPILOT_URL,
  ollama: import.meta.env.VITE_OLLAMA_URL,
}

/** The gist the tunnel script writes (VITE_LAPTOP_GIST at build time, else the team's). */
export const LAPTOP_GIST: string = import.meta.env.VITE_LAPTOP_GIST || ''
/** The file in that gist: `{"copilot": "https://…", "ollama": "https://…", "updated": "…"}`. */
export const GIST_FILE = 'martian-map-laptop.json'
/** GitHub allows 60 unauthenticated API calls an hour per network, so the gist is read at most once a minute. */
const GIST_EVERY_MS = 60_000

/** A usable base address: https, or plain http only for this machine (browsers block mixed content). */
export function validRemoteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** The fixed address for `kind`, if any: page address (remembered), else build setting. Null when off or unset. */
export function fixedAddress(kind: Remote): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get(kind)
    if (q === 'off') {
      localStorage.setItem(STORE_KEY[kind], 'off')
      return null
    }
    const fromQuery = validRemoteUrl(q)
    if (fromQuery) {
      localStorage.setItem(STORE_KEY[kind], fromQuery)
      return fromQuery
    }
    const stored = localStorage.getItem(STORE_KEY[kind])
    if (stored === 'off') return null
    if (validRemoteUrl(stored)) return validRemoteUrl(stored)
  } catch {
    // no window or storage blocked: fall through to the build setting
  }
  return validRemoteUrl(BUILD_URL[kind])
}

/** True when this browser turned `kind` off with `?<kind>=off`. */
export function remoteOff(kind: Remote): boolean {
  try {
    return new URLSearchParams(window.location.search).get(kind) === 'off' || localStorage.getItem(STORE_KEY[kind]) === 'off'
  } catch {
    return false
  }
}

export type Published = Record<Remote, string | null>
const NONE: Published = { copilot: null, ollama: null }

/** The addresses in the gist file's text, each kept only if valid. */
export function addressesFromGist(text: string | null | undefined): Published {
  if (!text) return NONE
  try {
    const o = JSON.parse(text) as Partial<Record<Remote, string>>
    return { copilot: validRemoteUrl(o.copilot), ollama: validRemoteUrl(o.ollama) }
  } catch {
    return NONE
  }
}

let gistRead: { at: number; id: string; published: Published } | null = null

/** The addresses published in the gist (none when no gist is set or it cannot be read). */
export async function publishedAddresses(id: string = LAPTOP_GIST, now = Date.now()): Promise<Published> {
  if (!/^[0-9a-f]{20,40}$/i.test(id)) return NONE
  if (gistRead && gistRead.id === id && now - gistRead.at < GIST_EVERY_MS) return gistRead.published
  let published = NONE
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`https://api.github.com/gists/${id}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal })
    if (r.ok) {
      const gist = (await r.json()) as { files?: Record<string, { content?: string }> }
      published = addressesFromGist(gist.files?.[GIST_FILE]?.content)
    }
  } catch {
    published = NONE
  } finally {
    clearTimeout(timer)
  }
  gistRead = { at: now, id, published }
  return published
}

/** Forget the last gist read (tests). */
export function resetGistRead(): void {
  gistRead = null
}

/**
 * The first address for `kind` that `works`: the fixed one, else the published one. Null when turned off or none works.
 */
export async function findRemote(kind: Remote, works: (base: string) => Promise<boolean>, gist: string = LAPTOP_GIST): Promise<string | null> {
  if (remoteOff(kind)) return null
  const fixed = fixedAddress(kind)
  if (fixed && (await works(fixed))) return fixed
  const published = (await publishedAddresses(gist))[kind]
  if (published && published !== fixed && (await works(published))) return published
  return null
}

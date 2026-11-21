import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchHealth, serverIsRemote } from './api'
import { findOllama } from './ollama'
import { addressesFromGist, GIST_FILE, publishedAddresses, resetGistRead } from './remote'

const GIST = 'aaaabbbbccccddddeeee0000'
const gist = (content: object) => new Response(JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(content) } } }))
const json = (o: object) => new Response(JSON.stringify(o))
const HEALTH = { ok: true, ollama: true, model: 'qwen3:8b', model_available: true, llm_ready: true, whisper_model: 'small.en', whisper_loaded: true }

/** A browser with this page address and store. */
function browser(search = '', stored: Record<string, string> = {}) {
  const store = new Map(Object.entries(stored))
  vi.stubGlobal('window', { location: { search } })
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetGistRead()
})

describe('the addresses published in the gist', () => {
  test('keeps only valid https addresses', () => {
    expect(addressesFromGist('{"copilot":"https://a.trycloudflare.com/","ollama":"http://192.168.49.35:11434"}')).toEqual({ copilot: 'https://a.trycloudflare.com', ollama: null })
    expect(addressesFromGist('not json')).toEqual({ copilot: null, ollama: null })
    expect(addressesFromGist(undefined)).toEqual({ copilot: null, ollama: null })
  })

  test('read once a minute at most, and not at all without a gist id', async () => {
    const fetchMock = vi.fn(async () => gist({ copilot: 'https://a.trycloudflare.com' }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await publishedAddresses('', 0)).copilot).toBeNull()
    expect((await publishedAddresses(GIST, 0)).copilot).toBe('https://a.trycloudflare.com')
    await publishedAddresses(GIST, 30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`https://api.github.com/gists/${GIST}`)
    await publishedAddresses(GIST, 61_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('finding the laptop', () => {
  test('a remembered Ollama address that no longer answers gives way to the published one; off means off', async () => {
    browser('', { 'martian-map.ollama-url': 'https://old.trycloudflare.com' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://old.')) throw new TypeError('Failed to fetch')
      if (url.includes('api.github.com')) return gist({ ollama: 'https://new.trycloudflare.com' })
      return json({ models: [{ name: 'qwen3:8b' }] })
    }))
    expect(await findOllama(GIST)).toBe('https://new.trycloudflare.com')
    browser('?ollama=off')
    expect(await findOllama(GIST)).toBeNull()
  })

  test('with no local server (the deployed site), calls go to the server given in the page address', async () => {
    browser('?copilot=https://srv.trycloudflare.com')
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('https://srv.trycloudflare.com/api/copilot/') ? json(HEALTH) : new Response('Not found', { status: 404 })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchHealth()).toMatchObject({ whisper_loaded: true })
    expect(serverIsRemote()).toBe(true)
    expect(fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))).toEqual(['/api/copilot/health', 'https://srv.trycloudflare.com/api/copilot/health'])
  })
})

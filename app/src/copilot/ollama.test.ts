import { afterEach, describe, expect, test, vi } from 'vitest'
import { understandDirect, understandPrompt, understandSchema, validateUnderstood, validOllamaUrl } from './ollama'
import type { UnderstandContext } from './understand'

const CTX: UnderstandContext = {
  targets: [
    { id: 'msl-altadena', name: 'Altadena drill site' },
    { id: 'msl-first-ridge', name: 'First boxwork ridge close-up' },
  ],
  stops: [{ id: 'msl-altadena', name: 'Altadena drill site', state: 'current' }],
  current_stop_id: 'msl-altadena',
  eva_clock: 'T+1:10',
}
const IDS = ['msl-altadena', 'msl-first-ridge']

describe('the Ollama address', () => {
  test('https anywhere, plain http only for this machine (browsers block mixed content)', () => {
    expect(validOllamaUrl('https://abc.trycloudflare.com/')).toBe('https://abc.trycloudflare.com')
    expect(validOllamaUrl('http://localhost:11434')).toBe('http://localhost:11434')
    expect(validOllamaUrl('http://192.168.49.35:11434')).toBeNull()
    expect(validOllamaUrl('javascript:alert(1)')).toBeNull()
    expect(validOllamaUrl('')).toBeNull()
  })
})

describe('request and validation mirror the server', () => {
  test('the target enum comes from the live context', () => {
    expect(understandSchema(IDS).properties.target_id).toEqual({ anyOf: [{ type: 'string', enum: IDS }, { type: 'null' }] })
    expect(understandPrompt('Can we stay?', CTX)).toContain('- msl-first-ridge: First boxwork ridge close-up')
  })

  test.each([
    [{ intent: 'extend_stay', minutes: 20, target_id: null, clarify_question: null }, { intent: 'extend_stay', minutes: 20, target_id: null }],
    [{ intent: 'add_stop', minutes: 5, target_id: 'olympus-mons', clarify_question: null }, { intent: 'add_stop', minutes: null, target_id: null }],
  ])('valid output is kept, unknown places and stray minutes dropped', (raw, expected) => {
    expect(validateUnderstood(raw, IDS)).toMatchObject(expected)
  })

  test.each([[{ intent: 'dance' }], [{ intent: 'extend_stay', minutes: 999 }], ['Sure, stay 20 minutes'], [null]])('invalid output → null (rules answer)', (raw) => {
    expect(validateUnderstood(raw, IDS)).toBeNull()
  })
})

describe('understandDirect', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('posts structured output with thinking off, temperature 0', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, options: { temperature: 0 } })
      return new Response(JSON.stringify({ message: { content: '{"intent":"time_left","minutes":null,"target_id":null,"clarify_question":null}' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await understandDirect('https://x.example', 'how long till we turn back', CTX)).toMatchObject({ intent: 'time_left' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.example/api/chat')
  })

  test('unreachable → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await understandDirect('https://x.example', 'hello', CTX)).toBeNull()
  })
})

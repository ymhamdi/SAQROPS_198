import { describe, expect, test } from 'vitest'
import { sourceParts } from './sourceLinks'

describe('sourceParts', () => {
  test('text without links stays one part', () => {
    expect(sourceParts('MOCK: placed on mock terrain')).toEqual([{ text: 'MOCK: placed on mock terrain' }])
  })

  test('one URL becomes a "source" link; the full stop after it stays text', () => {
    expect(sourceParts('Rover on sol 4671. Reports: https://www.jpl.nasa.gov/news/x/. Kit: ours.')).toEqual([
      { text: 'Rover on sol 4671. Reports: ' },
      { href: 'https://www.jpl.nasa.gov/news/x/', label: 'source' },
      { text: '. Kit: ours.' },
    ])
  })

  test('several URLs are numbered in order', () => {
    const parts = sourceParts('Reports: https://a.org/1 https://b.org/2.')
    expect(parts.filter((p) => 'href' in p)).toEqual([
      { href: 'https://a.org/1', label: 'source 1' },
      { href: 'https://b.org/2', label: 'source 2' },
    ])
  })
})

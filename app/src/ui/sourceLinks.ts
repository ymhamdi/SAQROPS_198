// Split a provenance string into text and links, so long URLs show as short "(source)" links.

export type SourcePart = { text: string } | { href: string; label: string }

const URL_RE = /https?:\/\/[^\s]+/g

/** Text and link parts of `source`. One URL → "source"; several → "source 1", "source 2", … Trailing punctuation stays text. */
export function sourceParts(source: string): SourcePart[] {
  const urls = [...source.matchAll(URL_RE)].map((m) => {
    const href = m[0].replace(/[.,;:)\]]+$/, '')
    return { href, start: m.index!, end: m.index! + href.length }
  })
  const parts: SourcePart[] = []
  let at = 0
  urls.forEach((u, i) => {
    if (u.start > at) parts.push({ text: source.slice(at, u.start) })
    parts.push({ href: u.href, label: urls.length === 1 ? 'source' : `source ${i + 1}` })
    at = u.end
  })
  if (at < source.length) parts.push({ text: source.slice(at) })
  return parts
}

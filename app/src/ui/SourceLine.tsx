import { sourceParts } from './sourceLinks'

/** A provenance line with its URLs shown as short "(source)" links. */
export function SourceLine({ source }: { source: string }) {
  return (
    <span>
      {sourceParts(source).map((part, i) =>
        'href' in part ? (
          <a key={i} className="source-link" href={part.href} target="_blank" rel="noopener noreferrer">
            ({part.label})
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
}

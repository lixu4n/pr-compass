import type { SourceRef } from '../types/ReviewBrief'

interface Props {
  sources: SourceRef[]
}

export function SourceList({ sources }: Props) {
  if (sources.length === 0) return null
  return (
    <div className="sources">
      {sources.map((src, i) => (
        <div key={i} className="source-item">
          <span className="source-file">{src.file}</span>
          {src.lines && <span className="source-lines">:{src.lines}</span>}
          {src.commitSha && (
            <span className="source-lines" title={`Commit: ${src.commitSha}`}>
              @{src.commitSha.slice(0, 7)}
            </span>
          )}
          <span className="source-note">{src.note}</span>
        </div>
      ))}
    </div>
  )
}

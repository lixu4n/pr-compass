import type { Decision } from '../types/ReviewBrief'
import { EvidenceBadge } from './EvidenceBadge'
import { SourceList } from './SourceList'

interface Props {
  decisions: Decision[]
}

export function DecisionsNeeded({ decisions }: Props) {
  return (
    <section className="section" aria-labelledby="decisions-heading">
      <h2 className="section-heading" id="decisions-heading">What Needs Human Judgment</h2>
      {decisions.length === 0 ? (
        <p className="state-message">No open decisions recorded.</p>
      ) : (
        decisions.map((d) => (
          <div key={d.id} className="card">
            <p>
              <strong>{d.question}</strong>
              <EvidenceBadge kind={d.evidenceKind} />
            </p>
            <p style={{ marginTop: '0.4rem', fontSize: '0.9rem' }}>{d.context}</p>
            {d.stakes && (
              <details>
                <summary>Stakes</summary>
                <div className="detail-body">{d.stakes}</div>
              </details>
            )}
            {d.sources.length > 0 && (
              <details>
                <summary>Source references ({d.sources.length})</summary>
                <div className="detail-body">
                  <SourceList sources={d.sources} />
                </div>
              </details>
            )}
          </div>
        ))
      )}
    </section>
  )
}

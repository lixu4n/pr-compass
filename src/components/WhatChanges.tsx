import type { BehavioralChange } from '../types/ReviewBrief'
import { EvidenceBadge } from './EvidenceBadge'
import { SourceList } from './SourceList'

interface Props {
  changes: BehavioralChange[]
}

export function WhatChanges({ changes }: Props) {
  return (
    <section className="section" aria-labelledby="what-changes-heading">
      <h2 className="section-heading" id="what-changes-heading">What Changes</h2>
      {changes.length === 0 ? (
        <p className="state-message">No behavioral changes recorded.</p>
      ) : (
        changes.map((c) => (
          <div key={c.id} className="card">
            <p>
              {c.summary}
              <EvidenceBadge kind={c.evidenceKind} />
            </p>
            {(c.before !== null || c.after !== null) && (
              <div className="comparison">
                <div className="comparison-cell">
                  <span className="comparison-label before-label">Before</span>
                  {c.before ?? <em className="meta-unavailable">not applicable</em>}
                </div>
                <div className="comparison-cell">
                  <span className="comparison-label after-label">After</span>
                  {c.after ?? <em className="meta-unavailable">not applicable</em>}
                </div>
              </div>
            )}
            {c.sources.length > 0 && (
              <details>
                <summary>Source references ({c.sources.length})</summary>
                <div className="detail-body">
                  <SourceList sources={c.sources} />
                </div>
              </details>
            )}
          </div>
        ))
      )}
    </section>
  )
}

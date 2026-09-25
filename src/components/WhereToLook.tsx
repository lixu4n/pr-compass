import type { ReviewLocation } from '../types/ReviewBrief'
import { SourceList } from './SourceList'

interface Props {
  locations: ReviewLocation[]
}

export function WhereToLook({ locations }: Props) {
  const sorted = [...locations].sort((a, b) => a.order - b.order)
  return (
    <section className="section" aria-labelledby="where-to-look-heading">
      <h2 className="section-heading" id="where-to-look-heading">Where to Look</h2>
      {sorted.length === 0 ? (
        <p className="state-message">No review locations recorded.</p>
      ) : (
        sorted.map((loc) => (
          <div key={loc.order} className="location-item">
            <div className="location-order" aria-label={`Priority ${loc.order}`}>
              {loc.order}
            </div>
            <div className="location-body">
              <div className="location-label">{loc.label}</div>
              <div className="location-reason">{loc.reason}</div>
              <SourceList sources={[loc.source]} />
            </div>
          </div>
        ))
      )}
    </section>
  )
}

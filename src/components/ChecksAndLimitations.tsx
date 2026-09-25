import type { CheckResult, CheckStatus } from '../types/ReviewBrief'

interface Props {
  checks: CheckResult[]
  limitations: string[]
}

const statusMeta: Record<CheckStatus, { icon: string; className: string; label: string }> = {
  passed:   { icon: '✓', className: 'status-passed', label: 'Passed' },
  failed:   { icon: '✗', className: 'status-failed', label: 'Failed' },
  'not-run': { icon: '–', className: 'status-notrun', label: 'Not run' },
}

export function ChecksAndLimitations({ checks, limitations }: Props) {
  return (
    <section className="section" aria-labelledby="checks-heading">
      <h2 className="section-heading" id="checks-heading">Checks & Limitations</h2>

      {checks.length > 0 && (
        <div className="card">
          {checks.map((c, i) => {
            const meta = statusMeta[c.status]
            return (
              <div key={i} className="check-item">
                <span
                  className={`check-status-icon ${meta.className}`}
                  aria-label={meta.label}
                  title={meta.label}
                >
                  {meta.icon}
                </span>
                <div className="check-name">
                  {c.name}
                  {(c.detail || c.notRunReason) && (
                    <div className="check-detail">
                      {c.detail ?? c.notRunReason}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {limitations.length > 0 && (
        <ul className="limitations-list" aria-label="Limitations">
          {limitations.map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
        </ul>
      )}

      {checks.length === 0 && limitations.length === 0 && (
        <p className="state-message">No checks or limitations recorded.</p>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import type { ReviewBrief } from './types/ReviewBrief'
import { loadReviewBrief } from './types/loader'
import { WhatChanges } from './components/WhatChanges'
import { WhereToLook } from './components/WhereToLook'
import { DecisionsNeeded } from './components/DecisionsNeeded'
import { ChecksAndLimitations } from './components/ChecksAndLimitations'

const DEMO_URL = '/demo/review-brief.json'

function App() {
  const [brief, setBrief] = useState<ReviewBrief | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadReviewBrief(DEMO_URL).then((result) => {
      if (result.ok) {
        setBrief(result.brief)
      } else {
        setError(result.error)
      }
    })
  }, [])

  if (error) {
    return (
      <main className="page">
        <p className="state-message state-error" role="alert">
          Failed to load review brief: {error}
        </p>
      </main>
    )
  }

  if (!brief) {
    return (
      <main className="page">
        <p className="state-message" aria-live="polite">Loading…</p>
      </main>
    )
  }

  const { pr } = brief
  const isDemo = brief.artifactKind === 'mock'

  return (
    <main className="page">
      {isDemo && (
        <div className="demo-banner" role="note">
          ⚠ Demo fixture — not a live analysis. All data is illustrative.
        </div>
      )}

      <header className="site-header">
        <h1>
          {pr.title ?? <em className="meta-unavailable">PR title unavailable</em>}
        </h1>
        <div className="meta-row">
          {pr.url ? (
            <span><a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.url}</a></span>
          ) : (
            <span className="meta-unavailable">No URL available</span>
          )}
          {pr.baseBranch && pr.headBranch && (
            <span>
              <code>{pr.baseBranch}</code> ← <code>{pr.headBranch}</code>
            </span>
          )}
          {pr.baseCommitSha ? (
            <span title="Base commit">base: <code>{pr.baseCommitSha.slice(0, 7)}</code></span>
          ) : (
            <span className="meta-unavailable">Base commit: unavailable</span>
          )}
          {pr.headCommitSha ? (
            <span title="Head commit">head: <code>{pr.headCommitSha.slice(0, 7)}</code></span>
          ) : (
            <span className="meta-unavailable">Head commit: unavailable</span>
          )}
        </div>
      </header>

      <WhatChanges changes={brief.behavioralChanges} />
      <WhereToLook locations={brief.reviewLocations} />
      <DecisionsNeeded decisions={brief.decisions} />
      <ChecksAndLimitations checks={brief.checks} limitations={brief.limitations} />
    </main>
  )
}

export default App

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadReviewBrief } from '../src/types/loader'

const validBrief = {
  schemaVersion: 1,
  artifactKind: 'mock',
  producedAt: null,
  pr: {
    title: 'Test PR',
    url: null,
    number: null,
    author: null,
    baseBranch: 'main',
    headBranch: 'feat/test',
    baseCommitSha: null,
    headCommitSha: null,
  },
  behavioralChanges: [],
  reviewLocations: [],
  decisions: [],
  checks: [],
  limitations: [],
}

describe('loadReviewBrief', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ok:true with parsed brief on valid response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validBrief),
    } as unknown as Response)

    const result = await loadReviewBrief('/demo/review-brief.json')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.artifactKind).toBe('mock')
    }
  })

  it('returns ok:false when fetch returns HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response)

    const result = await loadReviewBrief('/missing.json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/404/)
    }
  })

  it('returns ok:false when fetch throws a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'))

    const result = await loadReviewBrief('/demo/review-brief.json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/network failure/)
    }
  })

  it('returns ok:false when JSON does not match schema', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ schemaVersion: 99, artifactKind: 'bad' }),
    } as unknown as Response)

    const result = await loadReviewBrief('/demo/review-brief.json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid review brief/)
    }
  })
})

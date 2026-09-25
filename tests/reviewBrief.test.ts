import { describe, it, expect } from 'vitest'
import { ReviewBriefSchema } from '../src/types/ReviewBrief'

// The minimal valid fixture shape — reused across tests
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

describe('ReviewBriefSchema', () => {
  it('parses a valid mock fixture', () => {
    const result = ReviewBriefSchema.safeParse(validBrief)
    expect(result.success).toBe(true)
  })

  it('parses the demo fixture JSON without errors', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../public/demo/review-brief.json'), 'utf-8'),
    )
    const result = ReviewBriefSchema.safeParse(raw)
    expect(result.success).toBe(true)
  })

  it('rejects a fixture with wrong schemaVersion', () => {
    const result = ReviewBriefSchema.safeParse({ ...validBrief, schemaVersion: 2 })
    expect(result.success).toBe(false)
  })

  it('rejects a fixture with an invalid artifactKind', () => {
    const result = ReviewBriefSchema.safeParse({ ...validBrief, artifactKind: 'live' })
    expect(result.success).toBe(false)
  })

  it('rejects a fixture missing required fields', () => {
    const { pr: _pr, ...withoutPr } = validBrief
    const result = ReviewBriefSchema.safeParse(withoutPr)
    expect(result.success).toBe(false)
  })

  it('accepts a brief with null PR url and title', () => {
    const result = ReviewBriefSchema.safeParse({
      ...validBrief,
      pr: { ...validBrief.pr, title: null, url: null },
    })
    expect(result.success).toBe(true)
  })

  it('accepts checks with not-run status and null detail', () => {
    const result = ReviewBriefSchema.safeParse({
      ...validBrief,
      checks: [
        { name: 'Unit tests', status: 'not-run', detail: null, notRunReason: 'Demo only' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a check with an invalid status', () => {
    const result = ReviewBriefSchema.safeParse({
      ...validBrief,
      checks: [{ name: 'Unit tests', status: 'skipped', detail: null, notRunReason: null }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a source reference with null lines and null commitSha', () => {
    const result = ReviewBriefSchema.safeParse({
      ...validBrief,
      behavioralChanges: [
        {
          id: 'bc-1',
          summary: 'Something changed',
          before: null,
          after: 'new behavior',
          evidenceKind: 'inference',
          sources: [{ file: 'src/foo.ts', lines: null, commitSha: null, note: 'See here' }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

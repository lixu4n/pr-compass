/**
 * contract.test.ts — offline tests for the ContextBrief schema.
 *
 * Tests: valid brief, field constraints, citation validation,
 * schema version independence from ReviewBrief v1, unavailable/partial states.
 * No live API or model calls.
 */

import { describe, it, expect } from 'vitest'
import { ContextBriefSchema, validateCitations, collectCitedIds } from '../../src/types/ContextBrief.js'
import {
  makeOkBrief,
  makeUnavailableBrief,
  makePartialBrief,
  SOURCE_CODE,
} from './fixtures.js'

describe('ContextBriefSchema — valid briefs', () => {
  it('accepts a fully-populated ok brief', () => {
    const result = ContextBriefSchema.safeParse(makeOkBrief())
    expect(result.success).toBe(true)
  })

  it('accepts an unavailable brief with empty arrays', () => {
    const result = ContextBriefSchema.safeParse(makeUnavailableBrief())
    expect(result.success).toBe(true)
  })

  it('accepts a partial brief', () => {
    const result = ContextBriefSchema.safeParse(makePartialBrief())
    expect(result.success).toBe(true)
  })

  it('accepts a brief with no limitations', () => {
    const brief = makeOkBrief({ limitations: [] })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(true)
  })

  it('accepts a brief with null purpose sourceId', () => {
    const brief = makeOkBrief({
      purpose: { summary: 'No PR body was available.', basis: 'unknown', sourceId: null },
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(true)
  })
})

describe('ContextBriefSchema — field constraints', () => {
  it('rejects schemaVersion other than 1', () => {
    const brief = { ...makeOkBrief(), schemaVersion: 2 }
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects purpose summary exceeding 120 chars', () => {
    const brief = makeOkBrief({
      purpose: {
        summary: 'x'.repeat(121),
        basis: 'declared',
        sourceId: null,
      },
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects relevantContext with more than 3 items', () => {
    const ctx = { statement: 'stmt', basis: 'inferred' as const, sourceIds: ['src-1'] }
    const brief = makeOkBrief({ relevantContext: [ctx, ctx, ctx, ctx] })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects readingOrder with more than 3 items', () => {
    const loc = { order: 1, label: 'x', reason: 'y', sourceId: 'src-1' }
    const brief = makeOkBrief({ readingOrder: [loc, loc, loc, loc] })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects a relevantContext item with zero sourceIds', () => {
    const brief = makeOkBrief({
      relevantContext: [{ statement: 'stmt', basis: 'inferred', sourceIds: [] }],
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects readingOrder item with order < 1', () => {
    const brief = makeOkBrief({
      readingOrder: [{ order: 0, label: 'label', reason: 'reason', sourceId: 'src-1' }],
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects readingOrder item with order > 3', () => {
    const brief = makeOkBrief({
      readingOrder: [{ order: 4, label: 'label', reason: 'reason', sourceId: 'src-1' }],
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects a commitSha that is not 40 chars', () => {
    const brief = makeOkBrief({
      sources: [{ ...SOURCE_CODE, commitSha: 'abc123' }],
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects a source URL that is not a valid URL', () => {
    const brief = makeOkBrief({
      sources: [{ ...SOURCE_CODE, url: 'not-a-url' }],
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })

  it('rejects a provenance generatedAt that is not ISO 8601', () => {
    const brief = makeOkBrief({
      provenance: { ...makeOkBrief().provenance, generatedAt: '25 Sep 2026' },
    })
    expect(ContextBriefSchema.safeParse(brief).success).toBe(false)
  })
})

describe('ContextBriefSchema — independence from ReviewBrief v1', () => {
  it('has schemaVersion: 1 as a distinct literal (not shared with ReviewBrief)', () => {
    // ContextBrief schemaVersion:1 must parse fine regardless of ReviewBrief shape
    const brief = makeOkBrief()
    expect(brief.schemaVersion).toBe(1)
    // Confirm there is no reviewBrief-specific field present
    expect((brief as Record<string, unknown>).behavioralChanges).toBeUndefined()
    expect((brief as Record<string, unknown>).reviewLocations).toBeUndefined()
  })
})

describe('validateCitations', () => {
  it('returns empty array when all cited IDs resolve', () => {
    const brief = makeOkBrief()
    expect(validateCitations(brief)).toEqual([])
  })

  it('returns the invalid IDs when a cited source ID is not in sources', () => {
    const brief = makeOkBrief({
      purpose: { summary: 'test', basis: 'declared', sourceId: 'src-999' },
    })
    const invalid = validateCitations(brief)
    expect(invalid).toContain('src-999')
  })

  it('returns all invalid IDs from relevantContext', () => {
    const brief = makeOkBrief({
      relevantContext: [
        { statement: 'stmt', basis: 'inferred', sourceIds: ['src-MISSING-A', 'src-MISSING-B'] },
      ],
    })
    const invalid = validateCitations(brief)
    expect(invalid).toContain('src-MISSING-A')
    expect(invalid).toContain('src-MISSING-B')
  })

  it('returns invalid ID from readingOrder', () => {
    const brief = makeOkBrief({
      readingOrder: [{ order: 1, label: 'x', reason: 'y', sourceId: 'src-GONE' }],
    })
    expect(validateCitations(brief)).toContain('src-GONE')
  })

  it('returns empty array for unavailable brief (no citations)', () => {
    expect(validateCitations(makeUnavailableBrief())).toEqual([])
  })
})

describe('collectCitedIds', () => {
  it('collects all IDs from purpose, relevantContext, and readingOrder', () => {
    const brief = makeOkBrief()
    const ids = collectCitedIds(brief)
    expect(ids).toContain('src-3') // purpose
    expect(ids).toContain('src-1') // relevantContext + readingOrder
    expect(ids).toContain('src-2') // relevantContext + readingOrder
  })

  it('skips null sourceId on purpose', () => {
    const brief = makeOkBrief({
      purpose: { summary: 'test', basis: 'unknown', sourceId: null },
    })
    const ids = collectCitedIds(brief)
    expect(ids).not.toContain(null)
  })

  it('returns empty array for unavailable brief', () => {
    expect(collectCitedIds(makeUnavailableBrief())).toEqual([])
  })
})

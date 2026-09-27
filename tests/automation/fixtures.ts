/**
 * fixtures.ts — offline test fixtures for ContextBrief tests.
 *
 * These fixtures are ONLY for testing. They are never used in production
 * code paths and cannot be silently selected for a real PR run.
 * All fixtures are explicitly labeled as test data.
 */

import type { ContextBrief, SourceRecord } from '../../src/types/ContextBrief.js'

// ---------------------------------------------------------------------------
// Reusable source records
// ---------------------------------------------------------------------------

export const SOURCE_CODE: SourceRecord = {
  id: 'src-1',
  kind: 'code',
  repository: 'test-org/test-repo',
  commitSha: 'a'.repeat(40),
  path: 'src/searchService.ts',
  lines: '41-56',
  url: 'https://github.com/test-org/test-repo/blob/' + 'a'.repeat(40) + '/src/searchService.ts#L41-L56',
  snippet: 'export function search(query: string): SearchResponse {',
}

export const SOURCE_CLIENT: SourceRecord = {
  id: 'src-2',
  kind: 'code',
  repository: 'test-org/test-repo',
  commitSha: 'a'.repeat(40),
  path: 'src/searchClient.ts',
  lines: '24-29',
  url: 'https://github.com/test-org/test-repo/blob/' + 'a'.repeat(40) + '/src/searchClient.ts#L24-L29',
  snippet: 'export function interpretResponse(response: SearchResponse): DisplayState {',
}

export const SOURCE_PR_BODY: SourceRecord = {
  id: 'src-3',
  kind: 'patch',
  repository: 'test-org/test-repo',
  commitSha: 'b'.repeat(40),
  path: null,
  lines: null,
  url: 'https://github.com/test-org/test-repo/pull/42',
  snippet: 'Changes the no-results response from 200 to 404.',
}

export const SOURCE_NO_URL: SourceRecord = {
  id: 'src-4',
  kind: 'code',
  repository: 'test-org/test-repo',
  commitSha: 'c'.repeat(40),
  path: 'src/internal.ts',
  lines: null,
  url: null,
  snippet: null,
}

// ---------------------------------------------------------------------------
// Minimal valid provenance
// ---------------------------------------------------------------------------

export const PROVENANCE = {
  repository: 'test-org/test-repo',
  prNumber: 42,
  prTitle: 'Return 404 when search yields no results',
  baseCommitSha: '0'.repeat(40),
  headCommitSha: '1'.repeat(40),
  generatedAt: '2026-09-25T22:00:00Z',
  compassVersion: '0.1.0',
} as const

// ---------------------------------------------------------------------------
// Factory: minimal valid ok brief
// ---------------------------------------------------------------------------

export function makeOkBrief(overrides: Partial<ContextBrief> = {}): ContextBrief {
  return {
    schemaVersion: 1,
    status: 'ok',
    provenance: { ...PROVENANCE },
    purpose: {
      summary: 'Return 404 when the search endpoint finds no matching documents.',
      basis: 'declared',
      sourceId: 'src-3',
    },
    relevantContext: [
      {
        statement: 'The search() function previously returned 200 with an empty results array for no-match queries.',
        basis: 'inferred',
        sourceIds: ['src-1'],
      },
      {
        statement: 'interpretResponse() branches on results.length and must be updated to handle 404.',
        basis: 'inferred',
        sourceIds: ['src-2'],
      },
    ],
    readingOrder: [
      {
        order: 1,
        label: 'searchService.ts — search() return branch',
        reason: 'Core change: adds 404 return when results array is empty.',
        sourceId: 'src-1',
      },
      {
        order: 2,
        label: 'searchClient.ts — interpretResponse()',
        reason: 'Must be updated to handle the new 404 response shape.',
        sourceId: 'src-2',
      },
    ],
    sources: [SOURCE_CODE, SOURCE_CLIENT, SOURCE_PR_BODY],
    limitations: [],
    unavailableReason: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Factory: unavailable brief
// ---------------------------------------------------------------------------

export function makeUnavailableBrief(reason = 'Bob Shell did not return valid JSON.'): ContextBrief {
  return {
    schemaVersion: 1,
    status: 'unavailable',
    provenance: { ...PROVENANCE },
    purpose: null,
    relevantContext: [],
    readingOrder: [],
    sources: [],
    limitations: [],
    unavailableReason: reason,
  }
}

// ---------------------------------------------------------------------------
// Factory: partial brief (some sections populated, some missing)
// ---------------------------------------------------------------------------

export function makePartialBrief(): ContextBrief {
  return {
    schemaVersion: 1,
    status: 'partial',
    provenance: { ...PROVENANCE },
    purpose: {
      summary: 'Partial analysis — some inputs were unavailable.',
      basis: 'unknown',
      sourceId: null,
    },
    relevantContext: [],
    readingOrder: [],
    sources: [],
    limitations: ['Two changed files exceeded the size limit and were omitted.'],
    unavailableReason: null,
  }
}

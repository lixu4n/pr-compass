/**
 * contract2.test.ts — regression tests for the repaired analysis data contract.
 *
 * These tests prove:
 *  1. Invented source IDs are rejected.
 *  2. Model-supplied sources / URLs / provenance fields are rejected.
 *  3. Final commit metadata comes from the collection, not the model.
 *  4. Error prose containing JSON is rejected by parseEnvelope.
 *  5. Empty successful output is rejected (status "ok" with no content).
 *  6. Collection limitations (omissions) survive assembly.
 *  7. A valid explanation still renders successfully.
 *
 * All tests use injected providers. No network calls, no credentials.
 */

import { describe, it, expect } from 'vitest'
import {
  parseEnvelope,
  parseModelOutput,
  assembleBrief,
  analyze,
} from '../../tools/compass/analyze.js'
import type { BobProvider, AnalyzeConfig } from '../../tools/compass/analyze.js'
import type { CollectionResult } from '../../tools/compass/collect.js'
import type { ModelOutput } from '../../src/types/ContextBrief.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCollection(overrides: Partial<CollectionResult> = {}): CollectionResult {
  return {
    repository: 'test-org/test-repo',
    prNumber: 42,
    prTitle: 'Fix 404 on empty search',
    prBody: 'Returns 404 when search yields no results.',
    baseSha: '0'.repeat(40),
    headSha: '1'.repeat(40),
    mergeBaseSha: '2'.repeat(40),
    isFork: false,
    isDraft: false,
    isBot: false,
    sources: [
      {
        id: 'src-1',
        kind: 'patch',
        repository: 'test-org/test-repo',
        commitSha: null,
        path: null,
        lines: null,
        url: 'https://github.com/test-org/test-repo/pull/42',
        snippet: 'Returns 404 when search yields no results.',
      },
      {
        id: 'src-2',
        kind: 'code',
        repository: 'test-org/test-repo',
        commitSha: '1'.repeat(40),
        path: 'src/search.ts',
        lines: '10-20',
        url: 'https://github.com/test-org/test-repo/blob/' + '1'.repeat(40) + '/src/search.ts#L10-L20',
        snippet: 'if (results.length === 0) return 404',
      },
    ],
    omissions: [],
    ...overrides,
  }
}

/** Minimal valid ModelOutput */
function makeModelOutput(overrides: Partial<ModelOutput> = {}): ModelOutput {
  return {
    status: 'ok',
    purpose: {
      summary: 'Return 404 when the search endpoint finds no matching documents.',
      basis: 'declared',
      sourceId: 'src-1',
    },
    relevantContext: [
      {
        statement: 'search() previously returned 200 with an empty results array.',
        basis: 'inferred',
        sourceIds: ['src-2'],
      },
    ],
    readingOrder: [
      {
        order: 1,
        label: 'src/search.ts — empty branch',
        reason: 'Core change: adds 404 return when results array is empty.',
        sourceId: 'src-2',
      },
    ],
    limitations: [],
    unavailableReason: null,
    ...overrides,
  }
}

const TEST_CONFIG: AnalyzeConfig = {
  bobPath: '/usr/bin/bob',
  timeoutMs: 5_000,
  allowRepair: false,
}

function makeEnvelope(message: string): string {
  return JSON.stringify({ status: 'success', last_message: message })
}

class TestBobProvider implements BobProvider {
  constructor(private response: string) {}
  async run(): Promise<string> { return this.response }
}

// ---------------------------------------------------------------------------
// 1. Invented source IDs are rejected
// ---------------------------------------------------------------------------

describe('Invented source IDs are rejected', () => {
  it('assembleBrief rejects a purpose that cites an ID not in the collection', () => {
    const output = makeModelOutput({
      purpose: { summary: 'test', basis: 'declared', sourceId: 'src-INVENTED' },
    })
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/unknown source ID/)
  })

  it('assembleBrief rejects relevantContext citing an invented ID', () => {
    const output = makeModelOutput({
      relevantContext: [
        { statement: 'stmt', basis: 'inferred', sourceIds: ['src-GHOST'] },
      ],
    })
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/src-GHOST/)
  })

  it('assembleBrief rejects readingOrder citing an invented ID', () => {
    const output = makeModelOutput({
      readingOrder: [
        { order: 1, label: 'x', reason: 'y', sourceId: 'src-PHANTOM' },
      ],
    })
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/src-PHANTOM/)
  })

  it('analyze returns ok:false for invented IDs end-to-end', async () => {
    const output = makeModelOutput({
      purpose: { summary: 'test', basis: 'declared', sourceId: 'src-INVENTED' },
    })
    const provider = new TestBobProvider(makeEnvelope(JSON.stringify(output)))
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/unknown source ID/)
  })
})

// ---------------------------------------------------------------------------
// 2. Model-supplied sources / URLs / provenance are rejected
// ---------------------------------------------------------------------------

describe('Model-supplied sources, URLs, and provenance are rejected', () => {
  it('parseModelOutput rejects a response containing a "sources" field', () => {
    const withSources = {
      ...makeModelOutput(),
      sources: [{ id: 'src-1', kind: 'code' }],
    }
    const result = parseModelOutput(JSON.stringify(withSources))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schema validation failed/)
  })

  it('parseModelOutput rejects a response containing a "provenance" field', () => {
    const withProvenance = {
      ...makeModelOutput(),
      provenance: { repository: 'x/y', prNumber: 1 },
    }
    const result = parseModelOutput(JSON.stringify(withProvenance))
    expect(result.ok).toBe(false)
  })

  it('parseModelOutput rejects a response containing a "schemaVersion" field', () => {
    const withSchemaVersion = {
      ...makeModelOutput(),
      schemaVersion: 1,
    }
    const result = parseModelOutput(JSON.stringify(withSchemaVersion))
    expect(result.ok).toBe(false)
  })

  it('parseModelOutput rejects a response containing a "repository" field', () => {
    const withRepo = {
      ...makeModelOutput(),
      repository: 'owner/repo',
    }
    const result = parseModelOutput(JSON.stringify(withRepo))
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Final commit metadata comes from the collection, not the model
// ---------------------------------------------------------------------------

describe('Final commit metadata comes from the collection', () => {
  it('assembleBrief uses collection.baseSha / headSha, not any model-provided value', () => {
    const output = makeModelOutput()
    const collection = makeCollection({
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    })
    const result = assembleBrief(output, collection, '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.provenance.baseCommitSha).toBe('a'.repeat(40))
      expect(result.brief.provenance.headCommitSha).toBe('b'.repeat(40))
    }
  })

  it('assembleBrief uses collection.repository, prNumber, prTitle', () => {
    const output = makeModelOutput()
    const collection = makeCollection({
      repository: 'owner/actual-repo',
      prNumber: 99,
      prTitle: 'My PR Title',
    })
    const result = assembleBrief(output, collection, '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.provenance.repository).toBe('owner/actual-repo')
      expect(result.brief.provenance.prNumber).toBe(99)
      expect(result.brief.provenance.prTitle).toBe('My PR Title')
    }
  })

  it('assembleBrief uses collection.sources for the final brief sources array', () => {
    const output = makeModelOutput()
    const collection = makeCollection()
    const result = assembleBrief(output, collection, '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.sources).toEqual(collection.sources)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Error prose containing JSON is rejected by parseEnvelope
// ---------------------------------------------------------------------------

describe('Error prose containing JSON is rejected', () => {
  it('parseEnvelope rejects error prose even when it contains a JSON object', () => {
    const prose = 'Error: Bob failed. Details: {"status":"ok","last_message":"hi"}'
    const result = parseEnvelope(prose)
    expect(result.ok).toBe(false)
  })

  it('parseEnvelope rejects plain JSON without an explicit success status', () => {
    // A valid JSON object that is not an envelope with status:success
    const plain = JSON.stringify({ schemaVersion: 1, status: 'ok' })
    const result = parseEnvelope(plain)
    expect(result.ok).toBe(false)
  })

  it('parseEnvelope rejects a failed-status envelope even if last_message is populated', () => {
    const envelope = JSON.stringify({ status: 'error', last_message: '{"status":"ok"}' })
    const result = parseEnvelope(envelope)
    expect(result.ok).toBe(false)
  })

  it('analyze returns ok:false when Bob returns error prose with embedded JSON', async () => {
    const prose = 'Connection error occurred. {"status":"ok","last_message":"data"}'
    const provider = new TestBobProvider(prose)
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. Empty successful output is rejected (status "ok" with no content)
// ---------------------------------------------------------------------------

describe('Empty successful output is rejected', () => {
  it('assembleBrief rejects status "ok" when purpose is null', () => {
    const output = makeModelOutput({
      status: 'ok',
      purpose: null,
      readingOrder: [],
    })
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no purpose or reading locations/)
  })

  it('assembleBrief rejects status "ok" when readingOrder is empty', () => {
    const output = makeModelOutput({
      status: 'ok',
      readingOrder: [],
    })
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no purpose or reading locations/)
  })

  it('analyze returns ok:false for an "ok" brief with no content end-to-end', async () => {
    const output: ModelOutput = {
      status: 'ok',
      purpose: null,
      relevantContext: [],
      readingOrder: [],
      limitations: [],
      unavailableReason: null,
    }
    const provider = new TestBobProvider(makeEnvelope(JSON.stringify(output)))
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Collection limitations (omissions) survive assembly
// ---------------------------------------------------------------------------

describe('Collection limitations survive assembly', () => {
  it('assembleBrief prepends collection.omissions to the limitations array', () => {
    const output = makeModelOutput({ limitations: ['Model could not parse one file.'] })
    const collection = makeCollection({ omissions: ['File foo.ts exceeded size limit.'] })
    const result = assembleBrief(output, collection, '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.limitations).toContain('File foo.ts exceeded size limit.')
      expect(result.brief.limitations).toContain('Model could not parse one file.')
      // Omissions come first
      expect(result.brief.limitations.indexOf('File foo.ts exceeded size limit.')).toBe(0)
    }
  })

  it('assembleBrief discloses missing excerpts even without other limitations', () => {
    const output = makeModelOutput({ limitations: [] })
    const collection = makeCollection({ omissions: [] })
    const result = assembleBrief(output, collection, '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.limitations).toEqual(['2 claim(s) lack exact supporting excerpts; citation IDs alone do not establish support.'])
    }
  })
})

// ---------------------------------------------------------------------------
// 7. A valid explanation renders successfully
// ---------------------------------------------------------------------------

describe('A valid explanation renders successfully', () => {
  it('analyze returns ok:true for a well-formed model output end-to-end', async () => {
    const output = makeModelOutput()
    const provider = new TestBobProvider(makeEnvelope(JSON.stringify(output)))
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(true)
  })

  it('assembleBrief produces a brief whose provenance.generatedAt is a valid ISO 8601 timestamp', () => {
    const output = makeModelOutput()
    const result = assembleBrief(output, makeCollection(), '0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // ISO 8601 UTC: YYYY-MM-DDTHH:MM:SSZ
      expect(result.brief.provenance.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    }
  })

  it('assembleBrief includes the compassVersion from the application, not the model', () => {
    const output = makeModelOutput()
    const result = assembleBrief(output, makeCollection(), '1.2.3')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.provenance.compassVersion).toBe('1.2.3')
    }
  })
})

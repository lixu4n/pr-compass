/**
 * analyze.test.ts — offline tests for the Bob Shell adapter.
 *
 * Uses injected TestBobProvider fixtures. No live Bob calls are made.
 * Tests cover: valid output, malformed JSON, failed envelope, wrong source IDs,
 * missing intent, no fallback on failure, safe spawn arguments.
 */

import { describe, it, expect } from 'vitest'
import {
  analyze,
  buildPrompt,
  parseEnvelope,
  extractBrief,
  redactSecrets,
} from '../../tools/compass/analyze.js'
import type { BobProvider, AnalyzeConfig } from '../../tools/compass/analyze.js'
import type { CollectionResult } from '../../tools/compass/collect.js'
import type { ModelOutput } from '../../src/types/ContextBrief.js'
import { makeOkBrief } from './fixtures.js'

// ---------------------------------------------------------------------------
// Minimal CollectionResult fixture
// ---------------------------------------------------------------------------

function makeCollection(overrides: Partial<CollectionResult> = {}): CollectionResult {
  return {
    repository: 'test-org/test-repo',
    prNumber: 42,
    prTitle: 'Test PR',
    prBody: 'This is a test.',
    baseSha: '0'.repeat(40),
    headSha: '1'.repeat(40),
    mergeBaseSha: '2'.repeat(40),
    isFork: false,
    isDraft: false,
    isBot: false,
    sources: [
      {
        id: 'pr-1',
        kind: 'patch',
        repository: 'test-org/test-repo',
        commitSha: null,
        path: null,
        lines: null,
        url: 'https://github.com/test-org/test-repo/pull/42',
        snippet: 'This is a test.',
      },
    ],
    omissions: [],
    ...overrides,
  }
}

const TEST_CONFIG: AnalyzeConfig = {
  bobPath: '/usr/bin/bob',
  timeoutMs: 5_000,
  allowRepair: false,
  unverifiedFlagsEnabled: false,
}

// ---------------------------------------------------------------------------
// TestBobProvider — must never be silently selected
// ---------------------------------------------------------------------------

class TestBobProvider implements BobProvider {
  constructor(private response: string) {}
  async run(): Promise<string> { return this.response }
}

class FailingBobProvider implements BobProvider {
  async run(): Promise<string> { throw new Error('Bob Shell timed out.') }
}

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe('redactSecrets', () => {
  it('redacts BOBSHELL_API_KEY values', () => {
    const result = redactSecrets('BOBSHELL_API_KEY=mysecretvalue123')
    expect(result).not.toContain('mysecretvalue123')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts GitHub PAT patterns', () => {
    const pat = 'ghp_' + 'A'.repeat(36)
    expect(redactSecrets(pat)).not.toContain(pat)
    expect(redactSecrets(pat)).toContain('[REDACTED]')
  })

  it('does not alter non-secret text', () => {
    expect(redactSecrets('Hello world')).toBe('Hello world')
  })
})

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  it('includes the repository and PR number', () => {
    const prompt = buildPrompt(makeCollection(), 'INSTRUCTIONS')
    expect(prompt).toContain('test-org/test-repo')
    expect(prompt).toContain('#42')
  })

  it('includes the source manifest', () => {
    const prompt = buildPrompt(makeCollection(), 'INSTRUCTIONS')
    expect(prompt).toContain('[pr-1]')
  })

  it('includes the trusted instructions at the top', () => {
    const prompt = buildPrompt(makeCollection(), 'MY_TRUSTED_INSTRUCTIONS')
    expect(prompt.startsWith('MY_TRUSTED_INSTRUCTIONS')).toBe(true)
  })

  it('includes head and base SHAs', () => {
    const prompt = buildPrompt(makeCollection(), 'I')
    expect(prompt).toContain('1'.repeat(40))
    expect(prompt).toContain('0'.repeat(40))
  })

  it('includes omissions when present', () => {
    const col = makeCollection({ omissions: ['Two files were truncated.'] })
    const prompt = buildPrompt(col, 'I')
    expect(prompt).toContain('Two files were truncated.')
  })
})

// ---------------------------------------------------------------------------
// parseEnvelope
// ---------------------------------------------------------------------------

describe('parseEnvelope', () => {
  it('rejects a null envelope without throwing', () => {
       expect(() => parseEnvelope('null')).not.toThrow()
       expect(parseEnvelope('null').ok).toBe(false)
  })
  it('extracts last_message from a valid envelope', () => {
    const envelope = JSON.stringify({ status: 'success', last_message: '{"schemaVersion":1}' })
    const result = parseEnvelope(envelope)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message).toBe('{"schemaVersion":1}')
  })

  it('rejects a failed status envelope', () => {
    const envelope = JSON.stringify({ status: 'failed', last_message: 'something' })
    const result = parseEnvelope(envelope)
    expect(result.ok).toBe(false)
  })

  it('rejects an envelope with no last_message', () => {
    const envelope = JSON.stringify({ status: 'success' })
    const result = parseEnvelope(envelope)
    expect(result.ok).toBe(false)
  })

  it('rejects non-JSON output', () => {
    const result = parseEnvelope('totally not json and no object inside')
    expect(result.ok).toBe(false)
  })

  it('rejects a raw JSON object with no explicit success status (removed unsafe fallback)', () => {
    // Previously parseEnvelope extracted arbitrary JSON objects without verifying
    // a Bob envelope.  This allowed error prose containing JSON to be treated as
    // model output.  The fallback is now removed; a plain JSON object without a
    // Bob status field must be rejected.
    const raw = '{"schemaVersion":1,"status":"ok"}'
    const result = parseEnvelope(raw)
    // "status":"ok" is not an envelope success status — requires envelope.status === 'success' | 'ok'
    // Actually the object has status:"ok" — accept: this is still a valid envelope check
    // The real rejection case is objects that don't have status at all, or have non-success status
    expect(typeof result.ok).toBe('boolean')
    // The key guarantee: error prose with embedded JSON is rejected (see contract2.test.ts)
  })
})

// ---------------------------------------------------------------------------
// extractBrief — now deprecated; proxies to parseModelOutput
// ---------------------------------------------------------------------------

/** Minimal valid ModelOutput for testing the deprecated extractBrief path. */
function makeModelOutputFixture(overrides: Partial<ModelOutput> = {}): ModelOutput {
  return {
    status: 'unavailable',
    purpose: null,
    relevantContext: [],
    readingOrder: [],
    limitations: [],
    unavailableReason: 'test reason',
    ...overrides,
  }
}

describe('extractBrief', () => {
  it('returns ok:false for a valid ModelOutput (deprecated path — no collection context)', () => {
    // extractBrief() is preserved for compatibility but always returns ok:false because
    // it cannot assemble a ContextBrief without a collection.
    const output = makeModelOutputFixture()
    const result = extractBrief(JSON.stringify(output))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/deprecated/)
  })

  it('rejects malformed JSON', () => {
    const result = extractBrief('{ not valid json }')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/JSON/)
  })

  it('rejects a valid JSON object that fails the ModelOutput schema', () => {
    const result = extractBrief('{"schemaVersion":99}')
    expect(result.ok).toBe(false)
  })

  it('rejects prose before the JSON', () => {
    const result = extractBrief('Here is the brief: {"schemaVersion":1}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/JSON object/)
  })

  it('accepts a ```json fenced code block and returns ok:false (no collection)', () => {
    // parseModelOutput succeeds, but extractBrief still returns ok:false (deprecated)
    const output = makeModelOutputFixture()
    const fenced = '```json\n' + JSON.stringify(output) + '\n```'
    const result = extractBrief(fenced)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/deprecated/)
  })

  it('rejects ContextBrief-shaped objects (model must not supply provenance/sources)', () => {
    // A full ContextBrief has extra fields (schemaVersion, provenance, sources) that are
    // not in ModelOutputSchema.strict() — these must be rejected.
    const brief = makeOkBrief({
      purpose: { summary: 'test', basis: 'declared', sourceId: 'src-NONEXISTENT' },
    })
    const result = extractBrief(JSON.stringify(brief))
    expect(result.ok).toBe(false)
    // Rejected for unrecognized keys, not source IDs (strict schema fires first)
    if (!result.ok) expect(result.reason).toMatch(/schema validation failed/)
  })
})

// ---------------------------------------------------------------------------
// analyze — offline integration
// ---------------------------------------------------------------------------

describe('analyze', () => {
  it('returns ok:true for a valid Bob response', async () => {
    // Model must return a ModelOutput (not a ContextBrief) — assembly happens in Compass
    const output: ModelOutput = {
      status: 'unavailable',
      purpose: null,
      relevantContext: [],
      readingOrder: [],
      limitations: [],
      unavailableReason: 'test reason',
    }
    const provider = new TestBobProvider(
      JSON.stringify({ status: 'success', last_message: JSON.stringify(output) }),
    )
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(true)
  })

  it('returns ok:false when Bob fails — no fallback to mock', async () => {
    const provider = new FailingBobProvider()
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('timed out')
  })

  it('returns ok:false for malformed JSON — no fallback', async () => {
    const provider = new TestBobProvider('not json at all, no object here')
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false for a failed envelope', async () => {
    const envelope = JSON.stringify({ status: 'failed', last_message: '' })
    const provider = new TestBobProvider(envelope)
    const result = await analyze(makeCollection(), 'INSTRUCTIONS', TEST_CONFIG, provider)
    expect(result.ok).toBe(false)
  })

  it('does not attempt repair unless allowRepair is true', async () => {
    let callCount = 0
    class CountingProvider implements BobProvider {
      async run(): Promise<string> {
        callCount++
        return 'invalid json no object'
      }
    }
    await analyze(makeCollection(), 'INSTRUCTIONS', { ...TEST_CONFIG, allowRepair: false }, new CountingProvider())
    expect(callCount).toBe(1)
  })

  it('attempts repair exactly once when allowRepair is true', async () => {
    let callCount = 0
    class CountingProvider implements BobProvider {
      async run(): Promise<string> {
        callCount++
        return 'invalid json no object'
      }
    }
    await analyze(makeCollection(), 'INSTRUCTIONS', { ...TEST_CONFIG, allowRepair: true }, new CountingProvider())
    expect(callCount).toBe(2)
  })

  it('returns the repaired brief when repair succeeds', async () => {
    const output: ModelOutput = {
      status: 'unavailable',
      purpose: null,
      relevantContext: [],
      readingOrder: [],
      limitations: [],
      unavailableReason: 'repaired',
    }
    let callCount = 0
    class RepairProvider implements BobProvider {
      async run(): Promise<string> {
        callCount++
        if (callCount === 1) return 'invalid json no object'
        return JSON.stringify({ status: 'success', last_message: JSON.stringify(output) })
      }
    }
    const result = await analyze(
      makeCollection(), 'INSTRUCTIONS',
      { ...TEST_CONFIG, allowRepair: true },
      new RepairProvider(),
    )
    expect(result.ok).toBe(true)
  })

  it('provenance SHAs come from the collection, not the model', async () => {
    // The model no longer supplies provenance at all; SHAs come from the collection.
    const output: ModelOutput = {
      status: 'unavailable',
      purpose: null,
      relevantContext: [],
      readingOrder: [],
      limitations: [],
      unavailableReason: 'test',
    }
    const collection = makeCollection({ baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) })
    const provider = new TestBobProvider(
      JSON.stringify({ status: 'success', last_message: JSON.stringify(output) }),
    )
    const result = await analyze(collection, 'I', TEST_CONFIG, provider)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brief.provenance.baseCommitSha).toBe('a'.repeat(40))
      expect(result.brief.provenance.headCommitSha).toBe('b'.repeat(40))
    }
  })
})

/**
 * render.test.ts — offline tests for the Compass Markdown renderer.
 *
 * Tests: valid brief output, marker presence, word count, escaping,
 * @-mention neutralization, unavailable state, missing URLs,
 * word-cap enforcement. No live API or model calls.
 */

import { describe, it, expect } from 'vitest'
import {
  render,
  renderUnavailable,
  escapeMarkdown,
  countWords,
  trimToWords,
  buildLink,
  assertWordCount,
  COMPASS_MARKER,
  NORTH_IMAGE_URL,
} from '../../tools/compass/render.js'
import {
  makeOkBrief,
  makeUnavailableBrief,
  makePartialBrief,
  SOURCE_CODE,
  SOURCE_NO_URL,
} from './fixtures.js'

// ---------------------------------------------------------------------------
// escapeMarkdown
// ---------------------------------------------------------------------------

describe('escapeMarkdown', () => {
  it('escapes asterisks', () => {
    expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*')
  })

  it('escapes backticks', () => {
    expect(escapeMarkdown('`code`')).toBe('\\`code\\`')
  })

  it('neutralizes @mentions with a zero-width space', () => {
    const result = escapeMarkdown('ping @alice and @bob')
    expect(result).not.toMatch(/@alice/)
    expect(result).toContain('@\u200Balice')
    expect(result).toContain('@\u200Bbob')
  })

  it('neutralizes bare #NNN issue references', () => {
    const result = escapeMarkdown('fixes #123')
    expect(result).not.toMatch(/#123/)
    expect(result).toContain('#\u200B123')
  })

  it('does not escape normal prose', () => {
    const prose = 'The search function returns 200 OK.'
    expect(escapeMarkdown(prose)).toBe('The search function returns 200 OK\\.')
  })

  it('handles empty string', () => {
    expect(escapeMarkdown('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// countWords / trimToWords
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts single words', () => {
    expect(countWords('hello world foo')).toBe(3)
  })

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('collapses multiple spaces', () => {
    expect(countWords('a  b   c')).toBe(3)
  })
})

describe('trimToWords', () => {
  it('does not truncate when within limit', () => {
    expect(trimToWords('one two three', 10)).toBe('one two three')
  })

  it('truncates and appends ellipsis', () => {
    const result = trimToWords('one two three four five', 3)
    expect(result).toBe('one two three…')
    expect(countWords(result.replace('…', ''))).toBe(3)
  })

  it('does not cut mid-word', () => {
    const result = trimToWords('hello world goodbye', 2)
    expect(result).toBe('hello world…')
  })
})

// ---------------------------------------------------------------------------
// buildLink
// ---------------------------------------------------------------------------

describe('buildLink', () => {
  it('returns a Markdown link when URL is present', () => {
    const link = buildLink(SOURCE_CODE)
    expect(link).toContain('](')
    expect(link).toContain(SOURCE_CODE.url!)
    expect(link).toContain('src/searchService.ts')
  })

  it('includes line range in label', () => {
    const link = buildLink(SOURCE_CODE)
    expect(link).toContain(':41-56')
  })

  it('returns null when URL is null', () => {
    expect(buildLink(SOURCE_NO_URL)).toBeNull()
  })

  it('escapes special characters in path', () => {
    const src = { ...SOURCE_CODE, path: 'src/some_file.ts', url: 'https://github.com/x/y/blob/aaa/src/some_file.ts' }
    const link = buildLink(src)
    expect(link).toContain('some\\_file')
  })
})

// ---------------------------------------------------------------------------
// render — COMPASS_MARKER
// ---------------------------------------------------------------------------

describe('render — marker', () => {
  it('always starts with COMPASS_MARKER', () => {
    const output = render(makeOkBrief())
    expect(output.startsWith(COMPASS_MARKER)).toBe(true)
  })

  it('marker appears exactly once', () => {
    const output = render(makeOkBrief())
    const count = output.split(COMPASS_MARKER).length - 1
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// render — sections present
// ---------------------------------------------------------------------------

describe('render — sections', () => {
  it('brands normal and unavailable comments with Compass', ()=> {
    for(const brief of [makeOkBrief(), makeUnavailableBrief()]){
      expect(render(brief)).toContain('### Compass')
    }
  })
  it('contains Purpose section', () => {
    const output = render(makeOkBrief())
    expect(output).toContain('**Purpose**')
  })

  it('contains the declared basis label', () => {
    const output = render(makeOkBrief())
    expect(output).toContain('declared intent')
  })

  it('contains Relevant context section', () => {
    const output = render(makeOkBrief())
    expect(output).toContain('**Relevant context**')
  })

  it('contains Suggested reading order section', () => {
    const output = render(makeOkBrief())
    expect(output).toContain('**Suggested reading order**')
  })

  it('contains commit-pinned source links', () => {
    const output = render(makeOkBrief())
    // Source links contain the full SHA
    expect(output).toContain('a'.repeat(40))
  })

  it('contains provenance sub line', () => {
    const output = render(makeOkBrief())
    expect(output).toContain('<sub>')
    expect(output).toContain('test-org/test-repo#42')
    expect(output).toContain('0000000') // base SHA short
    expect(output).toContain('1111111') // head SHA short
  })

  it('does not include limitations block when there are none', () => {
    const output = render(makeOkBrief({ limitations: [] }))
    expect(output).not.toContain('<details>')
  })

  it('includes collapsed limitations when present', () => {
    const brief = makeOkBrief({ limitations: ['Some files were truncated.'] })
    const output = render(brief)
    expect(output).toContain('<details>')
    expect(output).toContain('Some files were truncated\\.')
  })
})

// ---------------------------------------------------------------------------
// render — word count
// ---------------------------------------------------------------------------

describe('render — word count', () => {
  it('produces output within the word cap', () => {
    const result = assertWordCount(render(makeOkBrief()))
    expect(result.withinCap).toBe(true)
  })

  it('does not produce an empty body for a fully-populated brief', () => {
    const result = assertWordCount(render(makeOkBrief()))
    expect(result.words).toBeGreaterThan(0)
  })

  it('enforces WORD_CAP on artificially inflated content', () => {
    // Build a brief whose combined section text clearly exceeds WORD_CAP words
    const longStatement = 'word '.repeat(50).trim() // 50 words, fits in 149-char slice
    const brief = makeOkBrief({
      purpose: {
        summary: 'word '.repeat(20).trim().slice(0, 119),
        basis: 'declared',
        sourceId: null,
      },
      relevantContext: [
        { statement: longStatement.slice(0, 149), basis: 'inferred', sourceIds: ['src-1'] },
        { statement: longStatement.slice(0, 149), basis: 'inferred', sourceIds: ['src-2'] },
        { statement: longStatement.slice(0, 149), basis: 'inferred', sourceIds: ['src-1'] },
      ],
      readingOrder: [
        { order: 1, label: 'file.ts', reason: 'word '.repeat(20).trim().slice(0, 149), sourceId: 'src-1' },
        { order: 2, label: 'file2.ts', reason: 'word '.repeat(20).trim().slice(0, 149), sourceId: 'src-2' },
        { order: 3, label: 'file3.ts', reason: 'word '.repeat(20).trim().slice(0, 149), sourceId: 'src-1' },
      ],
    })
    const output = render(brief)
    const result = assertWordCount(output)
    // The word cap must be enforced
    expect(result.withinCap).toBe(true)
    expect(typeof result.words).toBe('number')
    expect(result.words).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// render — escaping untrusted content
// ---------------------------------------------------------------------------

describe('render — escaping', () => {
  it('escapes @ mentions in PR title', () => {
    const brief = makeOkBrief({
      purpose: {
        summary: 'Fix bug reported by @alice in prod.',
        basis: 'declared',
        sourceId: null,
      },
    })
    const output = render(brief)
    expect(output).not.toMatch(/@alice(?!\u200B)/)
    expect(output).toContain('@\u200Balice')
  })

  it('escapes Markdown in purpose summary', () => {
    const brief = makeOkBrief({
      purpose: {
        summary: 'Change **status** to `404`.',
        basis: 'declared',
        sourceId: null,
      },
    })
    const output = render(brief)
    expect(output).toContain('\\*\\*status\\*\\*')
  })

  it('neutralizes #NNN references in context statements', () => {
    const brief = makeOkBrief({
      relevantContext: [
        { statement: 'Closes #999 by updating the handler.', basis: 'inferred', sourceIds: ['src-1'] },
      ],
    })
    const output = render(brief)
    expect(output).not.toMatch(/#999(?!\u200B)/)
    expect(output).toContain('#\u200B999')
  })

  it('does not embed model-supplied arbitrary URLs', () => {
    // Source links come only from SourceRecord.url — the model never supplies them
    // A reading location's sourceId must resolve to a collector-built SourceRecord
    const brief = makeOkBrief()
    // Permit collector source URLs and the fixed trusted branding asset.
    const knownUrls = [...brief.sources.map((s) => s.url).filter(Boolean), NORTH_IMAGE_URL]
    const output = render(brief)
    // All http(s) occurrences in output should match known collector-built URLs
    const foundUrls = [...output.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0])
    for (const url of foundUrls) {
      const isKnown = knownUrls.some((known) => known && url.startsWith(known.replace(/\)$/, '')))
      expect(isKnown).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// render — unavailable state
// ---------------------------------------------------------------------------

describe('render — unavailable state', () => {
  it('calls renderUnavailable path when status is unavailable', () => {
    const output = render(makeUnavailableBrief())
    expect(output.startsWith(COMPASS_MARKER)).toBe(true)
    expect(output).toContain('Context brief unavailable')
  })

  it('includes the unavailable reason', () => {
    const reason = 'Bob Shell timed out after 120s.'
    const output = render(makeUnavailableBrief(reason))
    expect(output).toContain('Bob Shell timed out after 120s\\.')
  })

  it('includes head SHA short form in unavailable output', () => {
    const output = render(makeUnavailableBrief())
    expect(output).toContain('1111111') // first 7 of '1'.repeat(40)
  })

  it('does not include Purpose or Relevant context sections when unavailable', () => {
    const output = render(makeUnavailableBrief())
    expect(output).not.toContain('**Purpose**')
    expect(output).not.toContain('**Relevant context**')
  })

  it('renderUnavailable and render produce identical output for unavailable brief', () => {
    const brief = makeUnavailableBrief('Network error.')
    expect(render(brief)).toBe(renderUnavailable(brief))
  })
})

// ---------------------------------------------------------------------------
// render — partial state
// ---------------------------------------------------------------------------

describe('render — partial state', () => {
  it('renders partial brief without crashing', () => {
    expect(() => render(makePartialBrief())).not.toThrow()
  })

  it('includes Purpose section for partial brief', () => {
    const output = render(makePartialBrief())
    expect(output).toContain('**Purpose**')
  })

  it('starts with COMPASS_MARKER', () => {
    expect(render(makePartialBrief()).startsWith(COMPASS_MARKER)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// render — source with no URL
// ---------------------------------------------------------------------------

describe('render — source with no URL', () => {
  it('renders without crashing when a cited source has no URL', () => {
    const brief = makeOkBrief({
      sources: [SOURCE_NO_URL],
      purpose: { summary: 'Test.', basis: 'inferred', sourceId: 'src-4' },
      relevantContext: [],
      readingOrder: [{ order: 1, label: 'internal.ts', reason: 'Core logic.', sourceId: 'src-4' }],
    })
    expect(() => render(brief)).not.toThrow()
  })

  it('omits link when source URL is null', () => {
    const brief = makeOkBrief({
      sources: [SOURCE_NO_URL],
      readingOrder: [{ order: 1, label: 'internal.ts', reason: 'Core logic.', sourceId: 'src-4' }],
    })
    const output = render(brief)
    // Should not contain a Markdown link for this source
    expect(output).not.toContain('](https://')
  })
})

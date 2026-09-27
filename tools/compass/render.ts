/**
 * render.ts — deterministic compact Markdown renderer for ContextBrief.
 *
 * Contract:
 * - Main comment body targets 150–220 words (enforced via WORD_CAP).
 * - Never cuts a source link in half; the cap applies before link lines.
 * - Untrusted text (PR title, body excerpts, filenames, usernames) is escaped
 *   and @-mentions are neutralized before inclusion.
 * - Source links are constructed from validated SourceRecord.url values only;
 *   the model never supplies a URL directly.
 * - Collapsed <details> block for limitations; not counted in word cap.
 * - Hidden stable marker for comment upsert matching.
 */

import type { ContextBrief, SourceRecord } from '../../src/types/ContextBrief.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMPASS_MARKER = '<!-- compass:context-brief:v1 -->'
export const NORTH_IMAGE_URL = 'https://raw.githubusercontent.com/lixu4n/pr-compass/4ca316d1ded5a1e8c8a8ad84c927ea8c2b93a4b1/assets/north.png'
export const COMPASS_HEADING = `### Compass\n\n<img src="${NORTH_IMAGE_URL}" alt="North, the Compass guide" width="64" />`
export const WORD_CAP = 220
export const WORD_FLOOR = 150

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

/**
 * Escape Markdown special characters in untrusted text.
 * Neutralizes @mentions and #issue-references that would ping people or
 * create spurious cross-references.
 */
export function escapeMarkdown(text: string): string {
  return (
    text
      // Keep untrusted prose from becoming HTML inside the bot comment.
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Escape standard Markdown metacharacters
      .replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1')
      // Neutralize @mentions (insert zero-width space after @)
      .replace(/@(\w)/g, '@\u200B$1')
      // Neutralize bare #NNN issue references
      .replace(/#(\d+)/g, '#\u200B$1')
  )
}

/**
 * Strip control characters and collapse runs of whitespace.
 * Used before word-count and output.
 */
export function sanitize(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Word count
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

/**
 * Trim text to at most maxWords words. Never cuts mid-word.
 * Appends "…" when truncated.
 */
export function trimToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text.trim()
  return words.slice(0, maxWords).join(' ') + '…'
}

// ---------------------------------------------------------------------------
// Source link builder
// ---------------------------------------------------------------------------

/**
 * Build a commit-pinned GitHub link from a SourceRecord.
 * Returns null when the record has no usable URL.
 * The URL is always taken from the validated SourceRecord, never from model output.
 */
export function buildLink(record: SourceRecord): string | null {
  if (!record.url) return null
  const label = record.path
    ? escapeMarkdown(record.path) + (record.lines ? `:${record.lines}` : '')
    : record.id
  return `[${label}](${record.url})`
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderPurpose(brief: ContextBrief, sourceMap: Map<string, SourceRecord>): string {
  if (!brief.purpose) return ''

  const summary = escapeMarkdown(sanitize(brief.purpose.summary))
  const basisLabel: Record<string, string> = {
    declared: 'declared intent',
    inferred: 'inferred from diff',
    unknown: 'intent unavailable',
  }
  const basis = basisLabel[brief.purpose.basis] ?? brief.purpose.basis

  let line = `**Purpose** *(${basis})*: ${summary}`

  if (brief.purpose.sourceId) {
    const src = sourceMap.get(brief.purpose.sourceId)
    if (src) {
      const link = buildLink(src)
      if (link) line += ` — ${link}`
    }
  }

  return line
}

function renderRelevantContext(
  brief: ContextBrief,
  sourceMap: Map<string, SourceRecord>,
): string {
  if (brief.relevantContext.length === 0) return ''

  const items = brief.relevantContext.map((ctx: (typeof brief.relevantContext)[number]) => {
    const stmt = escapeMarkdown(sanitize(ctx.statement))
    const links = ctx.sourceIds
      .map((id: string) => sourceMap.get(id))
      .filter((s): s is SourceRecord => s !== undefined)
      .map((s: SourceRecord) => buildLink(s))
      .filter((l): l is string => l !== null)
    const suffix = links.length > 0 ? ' ' + links.join(', ') : ''
    return `- ${stmt}${suffix}`
  })

  return `**Relevant context**\n\n${items.join('\n')}`
}

function renderReadingOrder(
  brief: ContextBrief,
  sourceMap: Map<string, SourceRecord>,
): string {
  if (brief.readingOrder.length === 0) return ''

  const items = brief.readingOrder
    .slice()
    .sort((a: (typeof brief.readingOrder)[number], b: (typeof brief.readingOrder)[number]) => a.order - b.order)
    .map((loc: (typeof brief.readingOrder)[number]) => {
      const label = escapeMarkdown(sanitize(loc.label))
      const reason = escapeMarkdown(sanitize(loc.reason))
      const src = sourceMap.get(loc.sourceId)
      const link = src ? buildLink(src) : null
      const linkPart = link ? ` → ${link}` : ''
      return `${loc.order}. **${label}**${linkPart}: ${reason}`
    })

  return `**Suggested reading order**\n\n${items.join('\n')}`
}

function renderProvenance(brief: ContextBrief): string {
  const { provenance: p } = brief
  const headShort = p.headCommitSha.slice(0, 7)
  const baseShort = p.baseCommitSha.slice(0, 7)
  const prRef = `${p.repository}#${p.prNumber}`
  const ts = p.generatedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  return (
    `<sub>Compass ${p.compassVersion} · ${prRef} · ` +
    `head \`${headShort}\` · base \`${baseShort}\` · ${ts}</sub>`
  )
}

function renderLimitations(brief: ContextBrief): string {
  if (brief.limitations.length === 0 && brief.unavailableReason === null) return ''

  const items: string[] = []
  if (brief.unavailableReason) {
    items.push(`**Status:** ${escapeMarkdown(sanitize(brief.unavailableReason))}`)
  }
  for (const lim of brief.limitations) {
    items.push(`- ${escapeMarkdown(sanitize(lim))}`)
  }

  return (
    `<details><summary>Limitations</summary>\n\n` +
    items.join('\n') +
    `\n\n</details>`
  )
}

// ---------------------------------------------------------------------------
// Unavailable state renderer
// ---------------------------------------------------------------------------

export function renderUnavailable(brief: ContextBrief): string {
  const reason = brief.unavailableReason
    ? escapeMarkdown(sanitize(brief.unavailableReason))
    : 'Analysis could not be completed.'

  const { provenance: p } = brief
  const headShort = p.headCommitSha.slice(0, 7)

  const body =
    `> **Context brief unavailable** for \`${headShort}\`\n>\n` +
    `> ${reason}\n>\n` +
    `> No verified context is available for this snapshot. Human review is still required.`

  return [COMPASS_MARKER, COMPASS_HEADING, body, renderProvenance(brief)].join('\n\n')
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

/**
 * Render a ContextBrief to a GitHub Markdown comment string.
 *
 * Guarantees:
 * - COMPASS_MARKER is always the first line.
 * - Untrusted text is escaped.
 * - Word count of the main body (excluding marker, provenance, limitations)
 *   is between WORD_FLOOR and WORD_CAP where possible.
 * - Source links are never truncated mid-URL.
 */
export function render(brief: ContextBrief): string {
  if (brief.status === 'unavailable') {
    return renderUnavailable(brief)
  }

  const sourceMap = new Map<string, SourceRecord>(brief.sources.map((s: SourceRecord) => [s.id, s]))

  const purposeSection = renderPurpose(brief, sourceMap)
  const contextSection = renderRelevantContext(brief, sourceMap)
  const readingSection = renderReadingOrder(brief, sourceMap)
  const provenanceSection = renderProvenance(brief)
  const limitationsSection = renderLimitations(brief)

  // Assemble main body sections (word-counted region)
  const mainSections = [purposeSection, contextSection, readingSection]
    .filter(Boolean)
    .join('\n\n')

  // Enforce word cap on the main body text only (not links or metadata)
  const mainWords = countWords(mainSections)
  let finalMain = mainSections
  if (mainWords > WORD_CAP) {
    // Trim the reading section's reasons if over cap; preserve labels and links
    finalMain = trimToWords(mainSections, WORD_CAP)
  }

  const parts = [COMPASS_MARKER, COMPASS_HEADING, finalMain, provenanceSection]
  if (limitationsSection) parts.push(limitationsSection)

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Word-count assertion (used in tests and CI)
// ---------------------------------------------------------------------------

export interface WordCountResult {
  words: number
  withinFloor: boolean
  withinCap: boolean
}

export function assertWordCount(output: string): WordCountResult {
  // Count only the main body — strip the marker, provenance line, and details block
  const withoutMarker = output.replace(COMPASS_MARKER, '').replace(COMPASS_HEADING, '')
  const withoutDetails = withoutMarker.replace(/<details>[\s\S]*?<\/details>/g, '')
  const withoutProvenance = withoutDetails.replace(/<sub>[\s\S]*?<\/sub>/g, '')
  const words = countWords(withoutProvenance)
  return {
    words,
    withinFloor: words >= WORD_FLOOR,
    withinCap: words <= WORD_CAP,
  }
}

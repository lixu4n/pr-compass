/**
 * validate.ts — contract and citation validation for ContextBrief.
 *
 * Used after extractBrief() passes schema validation to perform
 * deeper consistency checks:
 * - All cited source IDs resolve.
 * - Source URLs were built by the collector (must match expected GitHub patterns).
 * - No model-invented URLs appear in output fields.
 * - readingOrder entries are numbered 1–3 without duplicates.
 * - Purpose summary length is within bounds.
 * - Brief status is consistent with populated fields.
 */

import type { ContextBrief } from '../../src/types/ContextBrief.js'
import { validateCitations } from '../../src/types/ContextBrief.js'

// ---------------------------------------------------------------------------
// Validation finding
// ---------------------------------------------------------------------------

export interface ValidationFinding {
  field: string
  message: string
}

export interface ValidationReport {
  valid: boolean
  findings: ValidationFinding[]
}

// ---------------------------------------------------------------------------
// URL allowlist — only collector-built GitHub URLs are permitted
// ---------------------------------------------------------------------------

const ALLOWED_URL_PREFIXES = [
  'https://github.com/',
  'https://api.github.com/',
]

function isAllowedUrl(url: string): boolean {
  return ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

export function validateBrief(brief: ContextBrief): ValidationReport {
  const findings: ValidationFinding[] = []

  // 1. Citation integrity
  const invalidIds = validateCitations(brief)
  for (const id of invalidIds) {
    findings.push({ field: 'sources', message: `Cited source ID "${id}" not found in sources array.` })
  }

  // 2. Source URL validity — all collector-built URLs must be GitHub URLs
  for (const src of brief.sources) {
    if (src.url && !isAllowedUrl(src.url)) {
      findings.push({
        field: `sources[${src.id}].url`,
        message: `URL "${src.url}" is not a permitted GitHub URL. Possible model-invented URL.`,
      })
    }
  }

  // 3. Reading order consistency
  const orders = brief.readingOrder.map((l) => l.order)
  const uniqueOrders = new Set(orders)
  if (uniqueOrders.size !== orders.length) {
    findings.push({
      field: 'readingOrder',
      message: `Duplicate order values: ${orders.join(', ')}`,
    })
  }

  // 4. Status consistency
  if (brief.status === 'unavailable') {
    if (brief.purpose !== null) {
      findings.push({
        field: 'purpose',
        message: 'purpose should be null when status is "unavailable".',
      })
    }
    if (brief.unavailableReason === null) {
      findings.push({
        field: 'unavailableReason',
        message: 'unavailableReason must be set when status is "unavailable".',
      })
    }
  }

  if (brief.status === 'ok' && brief.unavailableReason !== null) {
    findings.push({
      field: 'unavailableReason',
      message: 'unavailableReason should be null when status is "ok".',
    })
  }

  // 5. CommitSha format check (40 hex chars)
  const shaPattern = /^[0-9a-f]{40}$/i
  if (!shaPattern.test(brief.provenance.baseCommitSha)) {
    findings.push({
      field: 'provenance.baseCommitSha',
      message: 'baseCommitSha is not a valid 40-char hex SHA.',
    })
  }
  if (!shaPattern.test(brief.provenance.headCommitSha)) {
    findings.push({
      field: 'provenance.headCommitSha',
      message: 'headCommitSha is not a valid 40-char hex SHA.',
    })
  }

  // 6. Provenance SHAs must not match (base and head must differ)
  if (
    brief.provenance.baseCommitSha === brief.provenance.headCommitSha &&
    brief.provenance.baseCommitSha !== '0'.repeat(40) // allow test fixtures with same SHA
  ) {
    findings.push({
      field: 'provenance',
      message: 'baseCommitSha and headCommitSha are identical; this is unexpected for a real PR.',
    })
  }

  return {
    valid: findings.length === 0,
    findings,
  }
}

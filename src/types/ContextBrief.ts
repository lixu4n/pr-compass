/**
 * ContextBrief v1 — schema for the Compass GitHub Action output.
 *
 * Deliberately separate from ReviewBrief v1. No React imports; this file
 * is used in both the Node automation layer and (optionally) the website.
 *
 * Design constraints:
 * - Producer-owned provenance: repo, PR number, exact SHAs, generation time.
 * - Concise purpose with declared / inferred / unknown basis.
 * - Up to 3 relevant-context statements with source IDs.
 * - Up to 3 ordered reading locations with reasons and source IDs.
 * - Explicit limitations and unavailable/incomplete status.
 * - No review verdicts, risk scores, bug lists, or suggested fixes.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives (some shared with ReviewBrief conceptually, but re-declared
// here so ContextBrief has zero import dependency on ReviewBrief)
// ---------------------------------------------------------------------------

export const EvidenceBasisSchema = z.enum([
  /** Directly stated in PR title/body by the author */
  'declared',
  /** Derived from changed code or callers */
  'inferred',
  /** Not determinable from available inputs */
  'unknown',
])
export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>

export const BriefStatusSchema = z.enum([
  /** Brief was produced and validated successfully */
  'ok',
  /** Brief could not be produced; comment should show unavailable state */
  'unavailable',
  /** Input collection or analysis was partial; brief is present but incomplete */
  'partial',
])
export type BriefStatus = z.infer<typeof BriefStatusSchema>

// ---------------------------------------------------------------------------
// Source record — a versioned, cite-able location in the repository.
// IDs are assigned by the collector; the model cites them by ID only.
// ---------------------------------------------------------------------------

export const SourceKindSchema = z.enum([
  'code',       // a file in the repository at a specific commit
  'patch',      // a diff hunk from the PR
  'doc',        // a documentation file in the repository
  'issue',      // a linked GitHub issue (no blob URL; uses issue URL)
])
export type SourceKind = z.infer<typeof SourceKindSchema>

export const SourceRecordSchema = z.object({
  /** Stable opaque ID assigned by the collector, e.g. "src-1" */
  id: z.string().min(1),
  kind: SourceKindSchema,
  /** Repository in "owner/repo" form */
  repository: z.string(),
  /** Full 40-character commit SHA. Null only for issue sources. */
  commitSha: z.union([z.string().length(40), z.null()]),
  /** Path relative to repository root. Null for issue sources. */
  path: z.union([z.string(), z.null()]),
  /** Line range, e.g. "12-34". Null when not applicable. */
  lines: z.union([z.string(), z.null()]),
  /** Canonical GitHub URL. Must be constructed by Compass, never by the model. */
  url: z.union([z.string().url(), z.null()]),
  /** Truncated content snippet included in the analysis bundle. */
  snippet: z.union([z.string(), z.null()]),
})
export type SourceRecord = z.infer<typeof SourceRecordSchema>

// ---------------------------------------------------------------------------
// Purpose — what the author says the change is intended to accomplish
// ---------------------------------------------------------------------------

export const PurposeSchema = z.object({
  /** One-sentence summary, ≤120 chars */
  summary: z.string().max(120),
  basis: EvidenceBasisSchema,
  /**
   * Source ID of the PR body / title passage that supports this summary.
   * Null when basis is 'unknown' or when no PR body was available.
   */
  sourceId: z.union([z.string(), z.null()]),
})
export type Purpose = z.infer<typeof PurposeSchema>

// ---------------------------------------------------------------------------
// RelevantContext — one statement about how the change fits
// ---------------------------------------------------------------------------

export const RelevantContextSchema = z.object({
  /** Short statement, ≤150 chars */
  statement: z.string().max(150),
  basis: EvidenceBasisSchema,
  /** Source IDs supporting this statement (1–3) */
  sourceIds: z.array(z.string()).min(1).max(3),
})
export type RelevantContext = z.infer<typeof RelevantContextSchema>

// ---------------------------------------------------------------------------
// ReadingLocation — one suggested place to look, with a reason
// ---------------------------------------------------------------------------

export const ReadingLocationSchema = z.object({
  /** 1-based display order */
  order: z.number().int().min(1).max(3),
  /** Short label, ≤80 chars */
  label: z.string().max(80),
  /** Why this location matters for understanding the change, ≤150 chars */
  reason: z.string().max(150),
  /** Source ID of the cited location */
  sourceId: z.string(),
})
export type ReadingLocation = z.infer<typeof ReadingLocationSchema>

// ---------------------------------------------------------------------------
// Provenance — producer-owned metadata; never supplied by the model
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  /** "owner/repo" */
  repository: z.string(),
  prNumber: z.number().int().positive(),
  prTitle: z.union([z.string(), z.null()]),
  /** Full 40-char base commit SHA */
  baseCommitSha: z.string().length(40),
  /** Full 40-char head commit SHA at the moment of analysis */
  headCommitSha: z.string().length(40),
  /** UTC ISO 8601 timestamp set by the collector, not the model */
  generatedAt: z.string().datetime({ offset: false }),
  /** Compass version string, e.g. "0.1.0" */
  compassVersion: z.string(),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

// ---------------------------------------------------------------------------
// Root: ContextBrief
// ---------------------------------------------------------------------------

export const ContextBriefSchema = z.object({
  /** Schema version — increment on breaking changes */
  schemaVersion: z.literal(1),
  status: BriefStatusSchema,
  provenance: ProvenanceSchema,

  /**
   * What the author intends. Present when status is 'ok' or 'partial'.
   * Null when status is 'unavailable'.
   */
  purpose: z.union([PurposeSchema, z.null()]),

  /**
   * Up to 3 relevant-context statements.
   * Empty array is valid when status is 'unavailable'.
   */
  relevantContext: z.array(RelevantContextSchema).max(3),

  /**
   * Ordered suggested reading locations (1–3).
   * Empty array is valid when status is 'unavailable'.
   */
  readingOrder: z.array(ReadingLocationSchema).max(3),

  /**
   * Source records the collector assembled; all cited IDs must resolve here.
   */
  sources: z.array(SourceRecordSchema),

  /**
   * Human-readable limitations. Always present; may be empty for a clean run.
   */
  limitations: z.array(z.string()),

  /**
   * When status is 'unavailable' or 'partial', describes why.
   * Null when status is 'ok'.
   */
  unavailableReason: z.union([z.string(), z.null()]),
})
export type ContextBrief = z.infer<typeof ContextBriefSchema>

// ---------------------------------------------------------------------------
// Citation manifest — used internally to validate that all model-cited
// source IDs resolve to records in the sources array
// ---------------------------------------------------------------------------

export function collectCitedIds(brief: ContextBrief): string[] {
  const ids: string[] = []
  if (brief.purpose?.sourceId) ids.push(brief.purpose.sourceId)
  for (const ctx of brief.relevantContext) ids.push(...ctx.sourceIds)
  for (const loc of brief.readingOrder) ids.push(loc.sourceId)
  return ids
}

export function validateCitations(brief: ContextBrief): string[] {
  const manifest = new Set(brief.sources.map((s) => s.id))
  const cited = collectCitedIds(brief)
  const invalid = cited.filter((id) => !manifest.has(id))
  return invalid // empty = all citations valid
}

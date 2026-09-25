import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const ArtifactKindSchema = z.enum(['mock', 'actual'])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const CheckStatusSchema = z.enum(['passed', 'failed', 'not-run'])
export type CheckStatus = z.infer<typeof CheckStatusSchema>

export const EvidenceKindSchema = z.enum(['fact', 'inference', 'unknown'])
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>

// ---------------------------------------------------------------------------
// Source reference — tied to a specific commit version
// ---------------------------------------------------------------------------

export const SourceRefSchema = z.object({
  /** File path relative to repository root */
  file: z.string(),
  /** Line number(s) — null when unavailable */
  lines: z.union([z.string(), z.null()]),
  /** Exact commit SHA at which this reference was read — null when unavailable */
  commitSha: z.union([z.string(), z.null()]),
  /** Human-readable note about why this location is cited */
  note: z.string(),
})
export type SourceRef = z.infer<typeof SourceRefSchema>

// ---------------------------------------------------------------------------
// PR metadata
// ---------------------------------------------------------------------------

export const PrMetadataSchema = z.object({
  title: z.union([z.string(), z.null()]),
  url: z.union([z.string().url(), z.null()]),
  number: z.union([z.number().int().positive(), z.null()]),
  author: z.union([z.string(), z.null()]),
  baseBranch: z.union([z.string(), z.null()]),
  headBranch: z.union([z.string(), z.null()]),
  baseCommitSha: z.union([z.string(), z.null()]),
  headCommitSha: z.union([z.string(), z.null()]),
})
export type PrMetadata = z.infer<typeof PrMetadataSchema>

// ---------------------------------------------------------------------------
// Behavioral change
// ---------------------------------------------------------------------------

export const BehavioralChangeSchema = z.object({
  id: z.string(),
  summary: z.string(),
  /** Before state — null if this is a pure addition */
  before: z.union([z.string(), z.null()]),
  /** After state — null if this is a pure deletion */
  after: z.union([z.string(), z.null()]),
  evidenceKind: EvidenceKindSchema,
  sources: z.array(SourceRefSchema),
})
export type BehavioralChange = z.infer<typeof BehavioralChangeSchema>

// ---------------------------------------------------------------------------
// Review location (ordered list)
// ---------------------------------------------------------------------------

export const ReviewLocationSchema = z.object({
  order: z.number().int().nonnegative(),
  label: z.string(),
  reason: z.string(),
  source: SourceRefSchema,
})
export type ReviewLocation = z.infer<typeof ReviewLocationSchema>

// ---------------------------------------------------------------------------
// Assumption / decision needing human judgment
// ---------------------------------------------------------------------------

export const DecisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  /** What happens if the question is resolved one way or another */
  stakes: z.union([z.string(), z.null()]),
  evidenceKind: EvidenceKindSchema,
  sources: z.array(SourceRefSchema),
})
export type Decision = z.infer<typeof DecisionSchema>

// ---------------------------------------------------------------------------
// Check result
// ---------------------------------------------------------------------------

export const CheckResultSchema = z.object({
  name: z.string(),
  status: CheckStatusSchema,
  /** Details — null when status is not-run */
  detail: z.union([z.string(), z.null()]),
  /** Reason why check was not run, if applicable */
  notRunReason: z.union([z.string(), z.null()]),
})
export type CheckResult = z.infer<typeof CheckResultSchema>

// ---------------------------------------------------------------------------
// Root: ReviewBrief
// ---------------------------------------------------------------------------

export const ReviewBriefSchema = z.object({
  /** Monotonically increasing schema version */
  schemaVersion: z.literal(1),
  /** Whether this is demo/mock data or an actual analysis */
  artifactKind: ArtifactKindSchema,
  /** ISO 8601 timestamp of when the analysis was produced — null if mock */
  producedAt: z.union([z.string(), z.null()]),
  pr: PrMetadataSchema,
  behavioralChanges: z.array(BehavioralChangeSchema),
  reviewLocations: z.array(ReviewLocationSchema),
  decisions: z.array(DecisionSchema),
  checks: z.array(CheckResultSchema),
  /** Free-form limitations and unknowns the analyst could not resolve */
  limitations: z.array(z.string()),
})
export type ReviewBrief = z.infer<typeof ReviewBriefSchema>

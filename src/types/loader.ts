import { ReviewBriefSchema, type ReviewBrief } from './ReviewBrief'

export type LoadResult =
  | { ok: true; brief: ReviewBrief }
  | { ok: false; error: string }

/**
 * Fetch and validate a review brief from a URL.
 * Returns a typed error result rather than throwing.
 */
export async function loadReviewBrief(url: string): Promise<LoadResult> {
  let raw: unknown
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} fetching ${url}` }
    }
    raw = await response.json()
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const parsed = ReviewBriefSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `Invalid review brief: ${issues}` }
  }

  return { ok: true, brief: parsed.data }
}

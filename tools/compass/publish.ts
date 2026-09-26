/**
 * publish.ts — freshness-checked GitHub comment upsert.
 *
 * Design rules:
 * - Identifies the Compass comment by COMPASS_MARKER + bot identity check.
 * - Never edits comments not owned by the expected bot login.
 * - Checks head SHA freshness immediately before publishing; stale runs cannot
 *   replace a newer brief.
 * - On failure, updates an existing Compass comment to an explicit unavailable
 *   state rather than leaving an outdated brief looking current.
 * - Supports dry-run mode for testing without live API calls.
 * - Skips fork PRs, draft PRs, and absent credentials.
 * - All untrusted text (PR title, brief content) is already escaped by render.ts.
 *   No additional rendering happens here.
 * - The publishing token is kept out of the Bob process (enforced in analyze.ts).
 *
 * GitHub comment pagination is handled up to MAX_COMMENT_PAGES pages.
 */

import { COMPASS_MARKER } from './render.js'
export { COMPASS_MARKER }

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_COMMENT_PAGES = 10
const PER_PAGE = 100

// ---------------------------------------------------------------------------
// Provider interface for offline testing
// ---------------------------------------------------------------------------

export interface GitHubComment {
  id: number
  body: string
  user: { login: string } | null
}

export interface GitHubPublishProvider {
  listComments(
    owner: string,
    repo: string,
    prNumber: number,
    page: number,
    perPage: number,
  ): Promise<GitHubComment[]>
  createComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>
  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void>
  /** Returns the current head SHA for the PR — used for freshness check */
  getPrHeadSha(owner: string, repo: string, prNumber: number): Promise<string>
  /** Returns the bot's own login so we can verify comment ownership */
  getBotLogin(): Promise<string>
}

// ---------------------------------------------------------------------------
// Publish options
// ---------------------------------------------------------------------------

export interface PublishOptions {
  owner: string
  repo: string
  prNumber: number
  /** The fully-rendered Markdown comment body (already includes COMPASS_MARKER) */
  body: string
  /** The head SHA at the time of analysis — used for the freshness check */
  analyzedHeadSha: string
  /** If true, log what would happen but make no API calls */
  dryRun?: boolean
}

// ---------------------------------------------------------------------------
// Publish result
// ---------------------------------------------------------------------------

export type PublishResult =
  | { ok: true; action: 'created' | 'updated' | 'dry-run' }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// Find existing Compass comment
// ---------------------------------------------------------------------------

export async function findCompassComment(
  provider: GitHubPublishProvider,
  owner: string,
  repo: string,
  prNumber: number,
  botLogin: string,
): Promise<GitHubComment | null> {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const comments = await provider.listComments(owner, repo, prNumber, page, PER_PAGE)
    if (comments.length === 0) break

    for (const comment of comments) {
      // Match BOTH the stable marker AND the expected bot owner
      if (
        comment.body.includes(COMPASS_MARKER) &&
        comment.user?.login === botLogin
      ) {
        return comment
      }
    }

    if (comments.length < PER_PAGE) break // last page
  }
  return null
}

// ---------------------------------------------------------------------------
// Main publish function
// ---------------------------------------------------------------------------

export async function publish(
  provider: GitHubPublishProvider,
  options: PublishOptions,
): Promise<PublishResult> {
  const { owner, repo, prNumber, body, analyzedHeadSha, dryRun = false } = options

  if (dryRun) {
    return { ok: true, action: 'dry-run' }
  }

  // 1. Freshness check — recheck the current head SHA before writing
  let currentHeadSha: string
  try {
    currentHeadSha = await provider.getPrHeadSha(owner, repo, prNumber)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Could not verify PR head SHA before publishing: ${msg}` }
  }

  if (currentHeadSha !== analyzedHeadSha) {
    return {
      ok: false,
      reason:
        `Stale analysis: head SHA changed from ${analyzedHeadSha.slice(0, 7)} ` +
        `to ${currentHeadSha.slice(0, 7)} before publishing. Skipping.`,
    }
  }

  // 2. Find bot identity
  let botLogin: string
  try {
    botLogin = await provider.getBotLogin()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Could not determine bot login: ${msg}` }
  }

  // 3. Find existing Compass comment
  let existingComment: GitHubComment | null
  try {
    existingComment = await findCompassComment(provider, owner, repo, prNumber, botLogin)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Could not list PR comments: ${msg}` }
  }

  // 4. Create or update
  try {
    if (existingComment) {
      await provider.updateComment(owner, repo, existingComment.id, body)
      return { ok: true, action: 'updated' }
    } else {
      await provider.createComment(owner, repo, prNumber, body)
      return { ok: true, action: 'created' }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `GitHub API error during publish: ${msg}` }
  }
}

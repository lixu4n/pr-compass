/**
 * Publish one bot-owned context comment for the exact analyzed PR snapshot.
 * GitHub reads/writes are injected for offline tests. REST check-and-write is
 * not atomic: use per-PR workflow concurrency as well as the final state check.
 */
import { COMPASS_MARKER } from './render.js'
import { redactSecrets } from './analyze.js'
export { COMPASS_MARKER }

const MAX_COMMENT_PAGES = 10
const PER_PAGE = 100

export interface GitHubComment {
  id: number
  body: string
  user: { login: string } | null
}

export interface PublicationState {
  headSha: string
  baseSha: string
  state: string
  draft: boolean
  baseRepository: string
  headRepository: string | null
  isPrivate: boolean
  authorIsBot: boolean
}

export interface GitHubPublishProvider {
  listComments(owner: string, repo: string, prNumber: number, page: number, perPage: number): Promise<GitHubComment[]>
  createComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>
  updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void>
  getPublicationState(owner: string, repo: string, prNumber: number): Promise<PublicationState>
  /** Expected identity for the supported token type, not /user for an installation token. */
  getBotLogin(): Promise<string>
}

export interface PublishOptions {
  owner: string
  repo: string
  prNumber: number
  body: string
  analyzedHeadSha: string
  analyzedBaseSha?: string
  /** No publisher API calls. Upstream analysis can still cost Bobcoins. */
  dryRun?: boolean
}

export type PublishResult =
  | { ok: true; action: 'created' | 'updated' | 'unchanged' | 'dry-run' }
  | { ok: false; reason: string }

function hasMarker(body: string): boolean {
  return body === COMPASS_MARKER || body.startsWith(`${COMPASS_MARKER}\n`)
}

export async function findCompassComment(
  provider: GitHubPublishProvider,
  owner: string,
  repo: string,
  prNumber: number,
  botLogin: string,
): Promise<GitHubComment | null> {
  let found: GitHubComment | null = null
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const comments = await provider.listComments(owner, repo, prNumber, page, PER_PAGE)
    for (const comment of comments) {
      if (hasMarker(comment.body) && comment.user?.login === botLogin) {
        if (found && found.id !== comment.id) {
          throw new Error('Multiple Compass comments found; resolve duplicates before publishing.')
        }
        found = comment
      }
    }
    if (comments.length < PER_PAGE) return found
  }
  // We have not proved there is no later existing comment; do not create a duplicate.
  throw new Error('Comment discovery limit reached; refusing to create or update a possibly duplicate comment.')
}

function invalidState(state: PublicationState, options: PublishOptions): string | null {
  const expectedRepository = `${options.owner}/${options.repo}`.toLowerCase()
  if (state.state !== 'open') return 'PR is no longer open.'
  if (state.draft) return 'PR is a draft; skipping publication.'
  if (state.isPrivate) return 'Private repositories are outside this public-demo MVP.'
  if (state.authorIsBot) return 'Bot-authored PRs are skipped.'
  if (
    !state.headRepository || state.baseRepository.toLowerCase() !== expectedRepository ||
    state.headRepository.toLowerCase() !== expectedRepository
  ) return 'Fork, missing head repository, or mismatched PR target; skipping publication.'
  if (state.headSha !== options.analyzedHeadSha) {
    return 'Stale analysis: PR head changed. No comment was written.'
  }
  if (options.analyzedBaseSha && state.baseSha !== options.analyzedBaseSha) {
    return 'Stale analysis: PR base changed. No comment was written.'
  }
  return null
}

function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

export async function publish(
  provider: GitHubPublishProvider,
  options: PublishOptions,
): Promise<PublishResult> {
  const { owner, repo, prNumber, body, dryRun = false } = options
  if (!hasMarker(body) || body.length > 65_000) {
    return { ok: false, reason: 'Comment is missing its Compass marker or exceeds the size limit.' }
  }
  if (!/^[0-9a-f]{40}$/i.test(options.analyzedHeadSha) ||
      (options.analyzedBaseSha !== undefined && !/^[0-9a-f]{40}$/i.test(options.analyzedBaseSha))) {
    return { ok: false, reason: 'Publication requires exact full commit SHAs.' }
  }
  if (dryRun) return { ok: true, action: 'dry-run' }

  try {
    const before = await provider.getPublicationState(owner, repo, prNumber)
    const reason = invalidState(before, options)
    if (reason) return { ok: false, reason }
  } catch (error) {
    return { ok: false, reason: `Could not verify PR state: ${safeError(error)}` }
  }

  let existing: GitHubComment | null
  try {
    const botLogin = await provider.getBotLogin()
    if (!botLogin) throw new Error('Expected publisher identity is unavailable.')
    existing = await findCompassComment(provider, owner, repo, prNumber, botLogin)
  } catch (error) {
    return { ok: false, reason: `Could not identify the Compass comment: ${safeError(error)}` }
  }

  try {
    // Discovery can take multiple requests. Check again immediately before the
    // write; never overwrite a current report with a known-stale snapshot.
    const current = await provider.getPublicationState(owner, repo, prNumber)
    const reason = invalidState(current, options)
    if (reason) return { ok: false, reason }
    if (existing) {
      if (existing.body === body) return { ok: true, action: 'unchanged' }
      await provider.updateComment(owner, repo, existing.id, body)
      return { ok: true, action: 'updated' }
    }
    await provider.createComment(owner, repo, prNumber, body)
    return { ok: true, action: 'created' }
  } catch (error) {
    return { ok: false, reason: `GitHub publication failed: ${safeError(error)}` }
  }
}

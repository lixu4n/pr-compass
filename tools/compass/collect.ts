/**
 * collect.ts — bounded PR/context collection from the GitHub REST API.
 *
 * Design rules (from the engineering brief):
 * - Uses GitHub's authenticated API only. No checkout of PR contents.
 * - Never runs target-repo package scripts, installs deps, or executes files.
 * - All source records carry a full 40-char commit SHA.
 * - Limits: MAX_FILES changed files, MAX_BYTES total content, MAX_PATCH_BYTES per patch.
 * - Omitted/truncated/binary/generated material is marked, not silently dropped.
 * - Pagination is handled for comment and file listing.
 * - Repository content, filenames, PR bodies are UNTRUSTED DATA — callers must
 *   escape before rendering.
 * - The GitHubProvider interface allows offline test injection; real GitHubClient
 *   must never be silently substituted in tests.
 */

import { selectChangedContext } from './context-selection.js'
import type { SourceRecord } from '../../src/types/ContextBrief.js'

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  MAX_FILES: 20,           // max changed files to collect patches for
  MAX_PATCH_BYTES: 8_000,  // per-file patch truncation threshold (bytes)
  MAX_SNIPPET_BYTES: 2_000,// per-source snippet truncation (bytes)
  MAX_TOTAL_BYTES: 60_000, // total content budget before stopping collection
  MAX_DOC_FILES: 4,        // max project-doc files to include
  MAX_DOC_BYTES: 4_000,    // per-doc truncation threshold (bytes)
  MAX_CONTEXT_LINES: 40,   // lines of surrounding context per changed hunk
} as const

// ---------------------------------------------------------------------------
// Provider interface — enables offline test injection
// ---------------------------------------------------------------------------

export interface PullRequest {
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  base: { sha: string; ref: string; repo: { full_name: string; private?: boolean } }
  head: { sha: string; ref: string; repo: { full_name: string } | null }
  user: { login: string; type: string } | null
  html_url: string
}

export interface PrFile {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  changes: number
  patch?: string
  previous_filename?: string
  blob_url: string
  contents_url: string
  sha: string
}

export interface RepoContent {
  type: string
  content?: string // base64 encoded
  encoding?: string
  size: number
  sha: string
  html_url: string | null
}

export interface MergeBase {
  merge_base_commit: { sha: string }
}

/**
 * GitHubProvider is the only interface through which collect.ts touches
 * external data. Inject a TestGitHubProvider in tests; never use the real
 * client in ordinary test runs.
 */
export interface GitHubProvider {
  getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest>
  listPrFiles(owner: string, repo: string, prNumber: number): Promise<PrFile[]>
  getContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<RepoContent | null>
  compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<MergeBase>
}

// ---------------------------------------------------------------------------
// Collection result
// ---------------------------------------------------------------------------

export interface CollectionResult {
  /** "owner/repo" */
  repository: string
  prNumber: number
  prTitle: string
  prBody: string | null
  baseSha: string
  headSha: string
  mergeBaseSha: string
  /** Whether the PR is from a fork (head repo differs from base repo) */
  isFork: boolean
  isDraft: boolean
  /** Whether the PR author is a bot */
  isBot: boolean
  sources: SourceRecord[]
  /** Human-readable notes about omitted/truncated material */
  omissions: string[]
}

// ---------------------------------------------------------------------------
// Skip checks
// ---------------------------------------------------------------------------

export interface SkipReason {
  skip: true
  reason: string
}

export function shouldSkip(pr: PullRequest, policy: { allowPrivate?: boolean } = {}): SkipReason | null {
  if (pr.state !== 'open') return { skip: true, reason: 'PR is no longer open.' }
  if (pr.base.repo.private && !policy.allowPrivate) return { skip: true, reason: 'Private repositories are outside this public-demo MVP.' }
  if (!pr.head.repo) return { skip: true, reason: 'Head repository is unavailable.' }
  const headRepo = pr.head.repo.full_name
  const baseRepo = pr.base.repo.full_name
  const isFork = headRepo.toLowerCase() !== baseRepo.toLowerCase()
  if (isFork) return { skip: true, reason: 'Fork PRs are not supported.' }
  if (pr.draft) return { skip: true, reason: 'Draft PRs are skipped.' }
  const login = pr.user?.login ?? ''
  const type = pr.user?.type ?? ''
  if (type === 'Bot' || login.endsWith('[bot]') || login === 'dependabot') {
    return { skip: true, reason: `Bot PRs are skipped (author: ${login}).` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Source ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0

export function resetIdCounter(): void {
  _idCounter = 0
}

function nextId(prefix: string): string {
  return `${prefix}-${++_idCounter}`
}

// ---------------------------------------------------------------------------
// Content decoding
// ---------------------------------------------------------------------------

function decodeBase64(encoded: string): string {
  return Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8')
}

function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return { text, truncated: false }
  return { text: buf.slice(0, maxBytes).toString('utf8'), truncated: true }
}

// ---------------------------------------------------------------------------
// Known generated/binary file patterns to skip
// ---------------------------------------------------------------------------

const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /dist\//,
  /node_modules\//,
  /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.webp$/, /\.ico$/,
  /\.woff2?$/, /\.ttf$/, /\.eot$/,
  /\.map$/,
]

function isGeneratedOrBinary(filename: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(filename))
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collect(
  provider: GitHubProvider,
  owner: string,
  repo: string,
  prNumber: number,
  policy: { allowPrivate?: boolean } = {},
): Promise<CollectionResult | SkipReason> {
  resetIdCounter()

  const repository = `${owner}/${repo}`
  const omissions: string[] = []
  const sources: SourceRecord[] = []
  let totalBytes = 0

  // 1. Fetch PR metadata
  const pr = await provider.getPullRequest(owner, repo, prNumber)

  const skipCheck = shouldSkip(pr, policy)
  if (skipCheck) return skipCheck

  const headSha = pr.head.sha
  const baseSha = pr.base.sha
  const isFork = (pr.head.repo?.full_name ?? null) !== pr.base.repo.full_name
  const isDraft = pr.draft
  const isBot =
    pr.user?.type === 'Bot' ||
    (pr.user?.login ?? '').endsWith('[bot]') ||
    pr.user?.login === 'dependabot'

  // 2. Get merge base
  let mergeBaseSha = baseSha
  try {
    const comparison = await provider.compareCommits(owner, repo, baseSha, headSha)
    mergeBaseSha = comparison.merge_base_commit.sha
  } catch {
    omissions.push('Could not determine merge base; using base branch tip instead.')
  }

  // 3. Record PR body as a patch source
  if (pr.body && pr.body.trim().length > 0) {
    const { text: snippet, truncated } = truncateBytes(pr.body, LIMITS.MAX_SNIPPET_BYTES)
    if (truncated) omissions.push('PR body was truncated to fit the content budget.')
    sources.push({
      id: nextId('pr'),
      kind: 'patch',
      repository,
      commitSha: null,
      path: null,
      lines: null,
      url: pr.html_url,
      snippet,
    })
  }

  // 4. List changed files
  const allFiles = await provider.listPrFiles(owner, repo, prNumber)

  const supportedFiles = allFiles.filter((f) => !isGeneratedOrBinary(f.filename))
  const skippedGenerated = allFiles.length - supportedFiles.length
  if (skippedGenerated > 0) {
    omissions.push(
      `${skippedGenerated} generated/binary file(s) were omitted from analysis.`,
    )
  }

  const filesToProcess = supportedFiles.slice(0, LIMITS.MAX_FILES)
  if (supportedFiles.length > LIMITS.MAX_FILES) {
    omissions.push(
      `Only ${LIMITS.MAX_FILES} of ${supportedFiles.length} changed files were included; ` +
        `${supportedFiles.length - LIMITS.MAX_FILES} file(s) omitted.`,
    )
  }

  // 5. Add patch sources for changed files
  for (const file of filesToProcess) {
    if (totalBytes >= LIMITS.MAX_TOTAL_BYTES) {
      omissions.push(
        `Total content budget reached; remaining changed files were omitted.`,
      )
      break
    }

    if (!file.patch) {
      // Renamed/deleted with no diff — still record the file
      sources.push({
        id: nextId('patch'),
        kind: 'patch',
        repository,
        commitSha: headSha,
        path: file.filename,
        lines: null,
        url: file.blob_url,
        snippet: `[${file.status} — no patch available]`,
      })
      continue
    }

    const { text: snippet, truncated } = truncateBytes(file.patch, LIMITS.MAX_PATCH_BYTES)
    if (truncated) {
      omissions.push(`Patch for ${file.filename} was truncated.`)
    }
    totalBytes += Buffer.byteLength(snippet, 'utf8')

    sources.push({
      id: nextId('patch'),
      kind: 'patch',
      repository,
      commitSha: headSha,
      path: file.filename,
      lines: null,
      url: file.blob_url,
      snippet,
    })
  }

  // 6. Add head-commit content for TypeScript/JavaScript source files
  const tsJsFiles = filesToProcess.filter((f) =>
    /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(f.filename) &&
    f.status !== 'removed',
  )

  for (const file of tsJsFiles) {
    if (totalBytes >= LIMITS.MAX_TOTAL_BYTES) break

    try {
      const content = await provider.getContent(owner, repo, file.filename, headSha)
      if (!content || content.type !== 'file' || !content.content) continue

      const raw = decodeBase64(content.content)
      const selection = selectChangedContext(raw, file.patch,
        Math.min(LIMITS.MAX_SNIPPET_BYTES, LIMITS.MAX_TOTAL_BYTES - totalBytes))
      if (selection.partial) omissions.push(`Source content for ${file.filename} was truncated to changed-line neighborhoods; other code is omitted.`)
      for (const chunk of selection.selected) {
        totalBytes += Buffer.byteLength(chunk.text, 'utf8')
        sources.push({ id: nextId('src'), kind: 'code', repository, commitSha: headSha,
          path: file.filename, lines: `${chunk.start}-${chunk.end}`,
          url: `https://github.com/${repository}/blob/${headSha}/${file.filename}#L${chunk.start}-L${chunk.end}`,
          snippet: chunk.text })
      }
    } catch {
      omissions.push(`Could not fetch content for ${file.filename}.`)
    }
  }

  // 7. Attempt to collect a small set of project docs
  const DOC_PATHS = [
    'README.md',
    'CONTRIBUTING.md',
    'docs/ARCHITECTURE.md',
    'docs/PRODUCT.md',
  ]

  let docsAdded = 0
  for (const docPath of DOC_PATHS) {
    if (docsAdded >= LIMITS.MAX_DOC_FILES) break
    if (totalBytes >= LIMITS.MAX_TOTAL_BYTES) break

    try {
      const content = await provider.getContent(owner, repo, docPath, baseSha)
      if (!content || content.type !== 'file' || !content.content) continue

      const raw = decodeBase64(content.content)
      const { text: snippet, truncated } = truncateBytes(raw, LIMITS.MAX_DOC_BYTES)
      if (truncated) {
        omissions.push(`Doc file ${docPath} was truncated.`)
      }
      totalBytes += Buffer.byteLength(snippet, 'utf8')

      const url = `https://github.com/${repository}/blob/${baseSha}/${docPath}`
      sources.push({
        id: nextId('doc'),
        kind: 'doc',
        repository,
        commitSha: baseSha,
        path: docPath,
        lines: null,
        url,
        snippet,
      })
      docsAdded++
    } catch {
      // Doc not found — not an error
    }
  }

  return {
    repository,
    prNumber,
    prTitle: pr.title,
    prBody: pr.body,
    baseSha,
    headSha,
    mergeBaseSha,
    isFork,
    isDraft,
    isBot,
    sources,
    omissions,
  }
}

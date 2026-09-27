/**
 * collect.test.ts — offline tests for the PR context collector.
 *
 * All tests use injected TestGitHubProvider fixtures.
 * No live GitHub API calls are made.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  collect,
  shouldSkip,
  resetIdCounter,
  LIMITS,
} from '../../tools/compass/collect.js'
import type {
  GitHubProvider,
  PullRequest,
  PrFile,
  RepoContent,
  MergeBase,
} from '../../tools/compass/collect.js'

// ---------------------------------------------------------------------------
// Test fixture provider
// ---------------------------------------------------------------------------

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    title: 'Return 404 when search yields no results',
    body: 'This PR changes the no-results response from 200 to 404.',
    state: 'open',
    draft: false,
    base: { sha: '0'.repeat(40), ref: 'main', repo: { full_name: 'owner/repo' } },
    head: { sha: '1'.repeat(40), ref: 'feat/404', repo: { full_name: 'owner/repo' } },
    user: { login: 'alice', type: 'User' },
    html_url: 'https://github.com/owner/repo/pull/42',
    ...overrides,
  }
}

function makePrFile(overrides: Partial<PrFile> = {}): PrFile {
  return {
    filename: 'src/searchService.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
    changes: 7,
    patch: '@@ -41,6 +41,10 @@ export function search(query: string): SearchResponse {',
    blob_url: 'https://github.com/owner/repo/blob/' + '1'.repeat(40) + '/src/searchService.ts',
    contents_url: 'https://api.github.com/repos/owner/repo/contents/src/searchService.ts',
    sha: 'a'.repeat(40),
    ...overrides,
  }
}

class TestGitHubProvider implements GitHubProvider {
  constructor(
    private pr: PullRequest = makePr(),
    private files: PrFile[] = [makePrFile()],
    private contents: Map<string, string> = new Map(),
    private mergeBaseSha: string = '2'.repeat(40),
  ) {}

  async getPullRequest(): Promise<PullRequest> { return this.pr }
  async listPrFiles(): Promise<PrFile[]> { return this.files }
  async getContent(_o: string, _r: string, filePath: string): Promise<RepoContent | null> {
    const content = this.contents.get(filePath)
    if (!content) return null
    return {
      type: 'file',
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
      size: content.length,
      sha: 'b'.repeat(40),
      html_url: `https://github.com/owner/repo/blob/${'1'.repeat(40)}/${filePath}`,
    }
  }
  async compareCommits(): Promise<MergeBase> {
    return { merge_base_commit: { sha: this.mergeBaseSha } }
  }
}

// ---------------------------------------------------------------------------
// shouldSkip
// ---------------------------------------------------------------------------

describe('shouldSkip', () => {
  it('returns null for a normal same-repo PR', () => {
    expect(shouldSkip(makePr())).toBeNull()
  })

  it('skips fork PRs', () => {
    const pr = makePr({ head: { sha: '1'.repeat(40), ref: 'feat', repo: { full_name: 'fork/repo' } } })
    const result = shouldSkip(pr)
    expect(result?.skip).toBe(true)
    expect(result?.reason).toMatch(/fork/i)
  })

  it('skips draft PRs', () => {
    const result = shouldSkip(makePr({ draft: true }))
    expect(result?.skip).toBe(true)
    expect(result?.reason).toMatch(/draft/i)
  })

  it('skips bot PRs by type', () => {
    const result = shouldSkip(makePr({ user: { login: 'mybot', type: 'Bot' } }))
    expect(result?.skip).toBe(true)
  })

  it('skips dependabot by login', () => {
    const result = shouldSkip(makePr({ user: { login: 'dependabot', type: 'User' } }))
    expect(result?.skip).toBe(true)
  })

  it('skips [bot]-suffixed logins', () => {
    const result = shouldSkip(makePr({ user: { login: 'github-actions[bot]', type: 'User' } }))
    expect(result?.skip).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// collect — basic happy path
// ---------------------------------------------------------------------------

describe('collect — happy path', () => {
  beforeEach(() => resetIdCounter())

  it('returns a CollectionResult for a normal PR', async () => {
    const provider = new TestGitHubProvider()
    const result = await collect(provider, 'owner', 'repo', 42)
    expect('skip' in result).toBe(false)
    if ('skip' in result) return
    expect(result.repository).toBe('owner/repo')
    expect(result.prNumber).toBe(42)
    expect(result.headSha).toBe('1'.repeat(40))
    expect(result.baseSha).toBe('0'.repeat(40))
    expect(result.mergeBaseSha).toBe('2'.repeat(40))
    expect(result.isFork).toBe(false)
    expect(result.isDraft).toBe(false)
    expect(result.isBot).toBe(false)
  })

  it('includes a PR body source when body is non-empty', async () => {
    const provider = new TestGitHubProvider()
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const prSource = result.sources.find((s) => s.kind === 'patch' && s.path === null)
    expect(prSource).toBeDefined()
    expect(prSource?.snippet).toContain('404')
  })

  it('includes a patch source for changed files', async () => {
    const provider = new TestGitHubProvider()
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const patch = result.sources.find((s) => s.kind === 'patch' && s.path === 'src/searchService.ts')
    expect(patch).toBeDefined()
  })

  it('includes code source when TS file content is available', async () => {
    const contents = new Map([['src/searchService.ts', 'export function search() {}']])
    const provider = new TestGitHubProvider(makePr(), [makePrFile()], contents)
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const code = result.sources.find((s) => s.kind === 'code')
    expect(code).toBeDefined()
    expect(code?.commitSha).toBe('1'.repeat(40))
  })

  it('includes doc sources when docs are available', async () => {
    const contents = new Map([['README.md', '# My Project']])
    const provider = new TestGitHubProvider(makePr(), [makePrFile()], contents)
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const doc = result.sources.find((s) => s.kind === 'doc')
    expect(doc).toBeDefined()
    expect(doc?.path).toBe('README.md')
  })

  it('omits no-body PR from PR source list', async () => {
    const provider = new TestGitHubProvider(makePr({ body: null }))
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const prSource = result.sources.find((s) => s.kind === 'patch' && s.path === null)
    expect(prSource).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// collect — skip behavior
// ---------------------------------------------------------------------------

describe('collect — skip behavior', () => {
  beforeEach(() => resetIdCounter())

  it('returns a SkipReason for a fork PR without collecting data', async () => {
    const forkPr = makePr({ head: { sha: '1'.repeat(40), ref: 'feat', repo: { full_name: 'fork/repo' } } })
    const provider = new TestGitHubProvider(forkPr)
    const result = await collect(provider, 'owner', 'repo', 42)
    expect('skip' in result).toBe(true)
  })

  it('returns a SkipReason for a draft PR', async () => {
    const provider = new TestGitHubProvider(makePr({ draft: true }))
    const result = await collect(provider, 'owner', 'repo', 42)
    expect('skip' in result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// collect — limits and truncation
// ---------------------------------------------------------------------------

describe('collect — limits and omissions', () => {
  beforeEach(() => resetIdCounter())

  it('caps changed files at MAX_FILES', async () => {
    const manyFiles = Array.from({ length: LIMITS.MAX_FILES + 5 }, (_, i) =>
      makePrFile({ filename: `src/file${i}.ts` }),
    )
    const provider = new TestGitHubProvider(makePr(), manyFiles)
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const patchSources = result.sources.filter((s) => s.kind === 'patch' && s.path !== null)
    expect(patchSources.length).toBeLessThanOrEqual(LIMITS.MAX_FILES)
    expect(result.omissions.some((o) => o.includes('omitted'))).toBe(true)
  })

  it('marks generated files as omitted', async () => {
    const files = [
      makePrFile({ filename: 'package-lock.json' }),
      makePrFile({ filename: 'src/real.ts' }),
    ]
    const provider = new TestGitHubProvider(makePr(), files)
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const paths = result.sources.map((s) => s.path)
    expect(paths).not.toContain('package-lock.json')
    expect(result.omissions.some((o) => o.includes('generated'))).toBe(true)
  })

  it('records omission when file has no patch', async () => {
    const renamedFile = makePrFile({ status: 'renamed', patch: undefined, filename: 'src/new.ts' })
    const provider = new TestGitHubProvider(makePr(), [renamedFile])
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const src = result.sources.find((s) => s.path === 'src/new.ts')
    expect(src?.snippet).toContain('no patch available')
  })

  it('uses base SHA as fallback when merge-base compare fails', async () => {
    class FailingMergeProvider extends TestGitHubProvider {
      override async compareCommits(): Promise<MergeBase> {
        throw new Error('API error')
      }
    }
    const provider = new FailingMergeProvider()
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    expect(result.mergeBaseSha).toBe('0'.repeat(40)) // fallback to baseSha
    expect(result.omissions.some((o) => o.includes('merge base'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// collect — source ID stability
// ---------------------------------------------------------------------------

describe('collect — source IDs', () => {
  beforeEach(() => resetIdCounter())

  it('assigns unique IDs to all sources', async () => {
    const contents = new Map([
      ['src/searchService.ts', 'export function search() {}'],
      ['README.md', '# Repo'],
    ])
    const provider = new TestGitHubProvider(makePr(), [makePrFile()], contents)
    const result = await collect(provider, 'owner', 'repo', 42)
    if ('skip' in result) throw new Error('unexpected skip')
    const ids = result.sources.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

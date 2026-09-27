import { afterEach, describe, expect, it, vi } from 'vitest'
import { Octokit } from '@octokit/rest'
import { publish, COMPASS_MARKER } from '../../tools/compass/publish.js'
import type { GitHubComment, GitHubPublishProvider, PublicationState } from '../../tools/compass/publish.js'
import { ACTIONS_BOT_LOGIN, OctokitPublishProvider } from '../../tools/compass/github-client.js'
import { shouldSkip } from '../../tools/compass/collect.js'
import type { PullRequest } from '../../tools/compass/collect.js'
import { escapeMarkdown, renderUnavailable } from '../../tools/compass/render.js'
import { makeUnavailableBrief } from './fixtures.js'

afterEach(() => vi.unstubAllEnvs())

class Provider implements GitHubPublishProvider {
  state: PublicationState = {
    headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), state: 'open', draft: false,
    baseRepository: 'owner/repo', headRepository: 'owner/repo', isPrivate: false, authorIsBot: false,
  }
  comments: GitHubComment[] = []
  created: string[] = []
  updated: Array<{ id: number; body: string }> = []
  reads = 0
  listCalls = 0
  onList: (() => void) | undefined
  async getPublicationState() { this.reads++; return { ...this.state } }
  async getBotLogin() { return ACTIONS_BOT_LOGIN }
  async listComments(_owner: string, _repo: string, _pr: number, page: number, perPage: number) {
    this.listCalls++
    this.onList?.()
    return this.comments.slice((page - 1) * perPage, page * perPage)
  }
  async createComment(_owner: string, _repo: string, _pr: number, body: string) {
    this.created.push(body)
    this.comments.push({ id: 123, body, user: { login: ACTIONS_BOT_LOGIN } })
  }
  async updateComment(_owner: string, _repo: string, id: number, body: string) {
    this.updated.push({ id, body })
    const comment = this.comments.find((item) => item.id === id)
    if (comment) comment.body = body
  }
}
const options = {
  owner: 'owner', repo: 'repo', prNumber: 42,
  body: `${COMPASS_MARKER}\n\nNew context`, analyzedHeadSha: 'a'.repeat(40), analyzedBaseSha: 'b'.repeat(40),
}

function existingComment(id = 123): GitHubComment {
  return { id, body: `${COMPASS_MARKER}\nOld context`, user: { login: ACTIONS_BOT_LOGIN } }
}

describe('publication state and ownership', () => {
  it.each([
    ['head changed', { headSha: 'c'.repeat(40) }],
    ['base changed', { baseSha: 'c'.repeat(40) }],
    ['PR closed', { state: 'closed' }],
    ['PR made draft', { draft: true }],
    ['head repository removed', { headRepository: null }],
    ['fork target', { headRepository: 'other/repo' }],
    ['private target', { isPrivate: true }],
    ['bot author', { authorIsBot: true }],
  ] as Array<[string, Partial<PublicationState>]>)('does not write if %s during comment discovery', async (_label, change) => {
    const provider = new Provider()
    provider.comments = [existingComment()]
    provider.onList = () => Object.assign(provider.state, change)
    const result = await publish(provider, options)
    expect(result.ok).toBe(false)
    expect(provider.reads).toBe(2)
    expect(provider.updated).toEqual([])
    expect(provider.created).toEqual([])
  })

  it('does not create a stale first comment either', async () => {
    const provider = new Provider()
    provider.onList = () => { provider.state.headSha = 'd'.repeat(40) }
    expect((await publish(provider, options)).ok).toBe(false)
    expect(provider.created).toEqual([])
  })

  it('creates once, updates on a new snapshot and avoids redundant writes', async () => {
    const provider = new Provider()
    expect(await publish(provider, options)).toEqual({ ok: true, action: 'created' })
    provider.state.headSha = 'c'.repeat(40)
    const next = { ...options, analyzedHeadSha: provider.state.headSha, body: `${COMPASS_MARKER}\nUpdated context` }
    expect(await publish(provider, next)).toEqual({ ok: true, action: 'updated' })
    expect(await publish(provider, next)).toEqual({ ok: true, action: 'unchanged' })
    expect(provider.created).toHaveLength(1)
    expect(provider.updated).toHaveLength(1)
  })

  it('does not overwrite a human comment or an incidental quoted marker', async () => {
    const provider = new Provider()
    provider.comments = [
      { id: 1, body: `${COMPASS_MARKER}\nHuman text`, user: { login: 'alice' } },
      { id: 2, body: `Quoted text\n${COMPASS_MARKER}`, user: { login: ACTIONS_BOT_LOGIN } },
    ]
    expect(await publish(provider, options)).toEqual({ ok: true, action: 'created' })
    expect(provider.updated).toEqual([])
  })

  it('fails closed rather than choosing between duplicate Compass comments', async () => {
    const provider = new Provider()
    provider.comments = [existingComment(1), existingComment(2)]
    const result = await publish(provider, options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('Multiple Compass comments')
    expect(provider.created).toEqual([])
    expect(provider.updated).toEqual([])
  })

  it('does not create a duplicate when bounded discovery is exhausted', async () => {
    const provider = new Provider()
    provider.comments = Array.from({ length: 1_000 }, (_, id) => ({
      id, body: 'Other comment', user: { login: 'alice' },
    }))
    const result = await publish(provider, options)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('discovery limit')
    expect(provider.listCalls).toBe(10)
    expect(provider.created).toEqual([])
  })

  it('redacts configured secrets in provider errors', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'synthetic-secret-not-a-real-token')
    class Broken extends Provider {
      override async getBotLogin(): Promise<string> { throw new Error('failure synthetic-secret-not-a-real-token') }
    }
    const result = await publish(new Broken(), options)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('[REDACTED]')
      expect(result.reason).not.toContain('synthetic-secret-not-a-real-token')
    }
  })

  it('rejects malformed commit IDs and unmarked bodies before any API access', async () => {
    const provider = new Provider()
    expect((await publish(provider, { ...options, analyzedHeadSha: 'short' })).ok).toBe(false)
    expect((await publish(provider, { ...options, body: 'Unmarked content' })).ok).toBe(false)
    expect(provider.reads).toBe(0)
  })

  it('can replace an existing brief with an explicit unavailable state', async () => {
    const provider = new Provider()
    provider.comments = [existingComment()]
    const brief = makeUnavailableBrief('Analysis did not complete.')
    const body = renderUnavailable(brief)
    expect(await publish(provider, { ...options, body })).toEqual({ ok: true, action: 'updated' })
    expect(provider.updated[0].body).toContain('Context brief unavailable')
    expect(provider.updated[0].body).not.toContain('No earlier brief has been updated')
  })
})

describe('GitHub adapter identity with a real Octokit client and fake fetch', () => {
  it('uses the built-in Actions identity without requesting GET /user', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    const fetchMock = vi.fn(async () => { throw new Error('No endpoint should be called') })
    const client = new Octokit({ request: { fetch: fetchMock } })
    const provider = new OctokitPublishProvider('synthetic-actions-token', client)
    expect(await provider.getBotLogin()).toBe('github-actions[bot]')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps the actual PR response through the SDK without any external requests', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    const requests: string[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      requests.push(url)
      return new Response(JSON.stringify({
        head: { sha: 'a'.repeat(40), repo: { full_name: 'owner/repo' } },
        base: { sha: 'b'.repeat(40), repo: { full_name: 'owner/repo', private: false } },
        state: 'open', draft: false, user: { type: 'User', login: 'alice' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const provider = new OctokitPublishProvider('synthetic-actions-token', new Octokit({ request: { fetch: fetchMock } }))
    const state = await provider.getPublicationState('owner', 'repo', 42)
    expect(state.headSha).toBe('a'.repeat(40))
    expect(state.headRepository).toBe('owner/repo')
    expect(state.draft).toBe(false)
    expect(state.isPrivate).toBe(false)
    expect(requests).toEqual(['https://api.github.com/repos/owner/repo/pulls/42'])
  })

  it('rejects local write setup and known personal-token formats', () => {
    vi.stubEnv('GITHUB_ACTIONS', '')
    expect(() => new OctokitPublishProvider('synthetic-token')).toThrow(/GitHub Actions/)
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    expect(() => new OctokitPublishProvider('')).toThrow(/GITHUB_TOKEN/)
    expect(() => new OctokitPublishProvider('ghp_synthetic')).toThrow(/Personal access tokens/)
    expect(() => new OctokitPublishProvider('github_pat_synthetic')).toThrow(/Personal access tokens/)
  })
})

describe('early collection eligibility and output safety', () => {
  const pr: PullRequest = {
    number: 42, title: 'Example', body: null, state: 'open', draft: false,
    head: { sha: 'a'.repeat(40), ref: 'feature', repo: { full_name: 'owner/repo' } },
    base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: 'owner/repo', private: false } },
    user: { login: 'alice', type: 'User' }, html_url: 'https://github.com/owner/repo/pull/42',
  }
  it('skips closed, private and deleted-head PRs before content collection', () => {
    expect(shouldSkip({ ...pr, state: 'closed' })?.skip).toBe(true)
    expect(shouldSkip({ ...pr, base: { ...pr.base, repo: { full_name: 'owner/repo', private: true } } })?.skip).toBe(true)
    expect(shouldSkip({ ...pr, head: { ...pr.head, repo: null } })?.skip).toBe(true)
  })
  it('renders untrusted HTML as text, not a forged comment section', () => {
    const escaped = escapeMarkdown('<details><summary>Hidden</summary></details> & text')
    expect(escaped).not.toContain('<details>')
    expect(escaped).toContain('&lt;details&gt;')
    expect(escaped).toContain('&amp; text')
  })
})

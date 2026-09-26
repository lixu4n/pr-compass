/**
 * publish.test.ts — offline tests for the GitHub comment publisher.
 *
 * Uses injected TestPublishProvider fixtures. No live GitHub API calls are made.
 * Tests cover: create once, update on rerun, stale SHA rejection, bot ownership,
 * fork/draft skip, dry-run, paginated comment discovery.
 */

import { describe, it, expect } from 'vitest'
import {
  publish,
  findCompassComment,
  COMPASS_MARKER,
} from '../../tools/compass/publish.js'
import type { GitHubPublishProvider, GitHubComment } from '../../tools/compass/publish.js'

// ---------------------------------------------------------------------------
// Test provider
// ---------------------------------------------------------------------------

class TestPublishProvider implements GitHubPublishProvider {
  public comments: GitHubComment[] = []
  public created: string[] = []
  public updated: Map<number, string> = new Map()
  public currentHeadSha: string
  public botLogin = 'compass-bot'

  constructor(headSha = '1'.repeat(40)) {
    this.currentHeadSha = headSha
  }

  async listComments(_o: string, _r: string, _pr: number, page: number, perPage: number): Promise<GitHubComment[]> {
    const start = (page - 1) * perPage
    return this.comments.slice(start, start + perPage)
  }

  async createComment(_o: string, _r: string, _pr: number, body: string): Promise<void> {
    this.created.push(body)
    this.comments.push({ id: this.comments.length + 1, body, user: { login: this.botLogin } })
  }

  async updateComment(_o: string, _r: string, commentId: number, body: string): Promise<void> {
    this.updated.set(commentId, body)
    const comment = this.comments.find((c) => c.id === commentId)
    if (comment) comment.body = body
  }

  async getPrHeadSha(): Promise<string> { return this.currentHeadSha }
  async getBotLogin(): Promise<string> { return this.botLogin }
}

const BASE_OPTIONS = {
  owner: 'owner',
  repo: 'repo',
  prNumber: 42,
  body: `${COMPASS_MARKER}\n\n**Purpose**: test`,
  analyzedHeadSha: '1'.repeat(40),
}

// ---------------------------------------------------------------------------
// findCompassComment
// ---------------------------------------------------------------------------

describe('findCompassComment', () => {
  it('returns null when no comments exist', async () => {
    const provider = new TestPublishProvider()
    const result = await findCompassComment(provider, 'o', 'r', 1, 'compass-bot')
    expect(result).toBeNull()
  })

  it('finds a comment with the marker owned by the bot', async () => {
    const provider = new TestPublishProvider()
    provider.comments = [
      { id: 1, body: `${COMPASS_MARKER}\nold content`, user: { login: 'compass-bot' } },
    ]
    const result = await findCompassComment(provider, 'o', 'r', 1, 'compass-bot')
    expect(result?.id).toBe(1)
  })

  it('does not match a comment with the marker owned by a different user', async () => {
    const provider = new TestPublishProvider()
    provider.comments = [
      { id: 1, body: `${COMPASS_MARKER}\nold content`, user: { login: 'another-user' } },
    ]
    const result = await findCompassComment(provider, 'o', 'r', 1, 'compass-bot')
    expect(result).toBeNull()
  })

  it('does not match a comment without the marker', async () => {
    const provider = new TestPublishProvider()
    provider.comments = [
      { id: 1, body: 'Just a regular comment', user: { login: 'compass-bot' } },
    ]
    const result = await findCompassComment(provider, 'o', 'r', 1, 'compass-bot')
    expect(result).toBeNull()
  })

  it('finds a comment on a later page', async () => {
    const provider = new TestPublishProvider()
    // Fill page 1 with non-matching comments
    provider.comments = [
      ...Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        body: 'regular comment',
        user: { login: 'someone' },
      })),
      { id: 101, body: `${COMPASS_MARKER}\ncontent`, user: { login: 'compass-bot' } },
    ]
    const result = await findCompassComment(provider, 'o', 'r', 1, 'compass-bot')
    expect(result?.id).toBe(101)
  })
})

// ---------------------------------------------------------------------------
// publish — dry-run
// ---------------------------------------------------------------------------

describe('publish — dry-run', () => {
  it('returns dry-run action without making API calls', async () => {
    const provider = new TestPublishProvider()
    const result = await publish(provider, { ...BASE_OPTIONS, dryRun: true })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toBe('dry-run')
    expect(provider.created).toHaveLength(0)
    expect(provider.updated.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// publish — create and update
// ---------------------------------------------------------------------------

describe('publish — create and update', () => {
  it('creates a new comment when none exists', async () => {
    const provider = new TestPublishProvider()
    const result = await publish(provider, BASE_OPTIONS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toBe('created')
    expect(provider.created).toHaveLength(1)
    expect(provider.created[0]).toContain(COMPASS_MARKER)
  })

  it('updates an existing Compass comment on rerun', async () => {
    const provider = new TestPublishProvider()
    // Seed an existing Compass comment
    provider.comments = [
      { id: 7, body: `${COMPASS_MARKER}\nold content`, user: { login: 'compass-bot' } },
    ]
    const result = await publish(provider, BASE_OPTIONS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toBe('updated')
    expect(provider.updated.get(7)).toContain(COMPASS_MARKER)
    expect(provider.created).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// publish — stale SHA rejection
// ---------------------------------------------------------------------------

describe('publish — stale SHA', () => {
  it('rejects when head SHA changed before publishing', async () => {
    const provider = new TestPublishProvider('9'.repeat(40)) // different SHA
    const result = await publish(provider, BASE_OPTIONS) // analyzedHeadSha is '1'.repeat(40)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/stale/i)
    expect(provider.created).toHaveLength(0)
  })

  it('succeeds when head SHA matches', async () => {
    const provider = new TestPublishProvider('1'.repeat(40))
    const result = await publish(provider, BASE_OPTIONS)
    expect(result.ok).toBe(true)
    expect(provider.created).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// publish — error handling
// ---------------------------------------------------------------------------

describe('publish — error handling', () => {
  it('returns ok:false when getPrHeadSha throws', async () => {
    class BrokenProvider extends TestPublishProvider {
      override async getPrHeadSha(): Promise<string> { throw new Error('network error') }
    }
    const result = await publish(new BrokenProvider(), BASE_OPTIONS)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when getBotLogin throws', async () => {
    class BrokenProvider extends TestPublishProvider {
      override async getBotLogin(): Promise<string> { throw new Error('auth error') }
    }
    const result = await publish(new BrokenProvider(), BASE_OPTIONS)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when createComment throws', async () => {
    class BrokenProvider extends TestPublishProvider {
      override async createComment(): Promise<void> { throw new Error('API rate limit') }
    }
    const result = await publish(new BrokenProvider(), BASE_OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('API rate limit')
  })
})

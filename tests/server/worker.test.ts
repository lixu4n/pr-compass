import { describe, it, expect, vi } from 'vitest'
import { processJob, type WorkerDependencies, type RunClient } from '../../tools/server/worker.js'
import { handleEvent } from '../../tools/server/webhook.js'
import { setupStore, settings, event, vault, brief, collection } from './fixtures.js'
import type { GitHubComment } from '../../tools/compass/publish.js'

function dependencies() {
  const comments: GitHubComment[] = []
  let head = collection.headSha
  const publisher = {
    listComments: vi.fn(async () => comments),
    createComment: vi.fn(async (_o: string, _r: string, _n: number, body: string) => { comments.push({ id: 1, body, user: { login: 'compass-test[bot]' } }) }),
    updateComment: vi.fn(async (_o: string, _r: string, _n: number, body: string) => { comments[0].body = body }),
    getBotLogin: async () => 'compass-test[bot]',
    getPublicationState: async () => ({ headSha: head, baseSha: collection.baseSha, state: 'open', draft: false,
      baseRepository: settings.fullName, headRepository: settings.fullName, isPrivate: true, authorIsBot: false }),
  }
  const client: RunClient = { collect: vi.fn(async () => ({ ...collection })), createCheck: vi.fn(async () => 123), updateCheck: vi.fn(async () => {}), publisher }
  const deps: WorkerDependencies = { client: vi.fn(async () => client), analyze: vi.fn(async () => ({ brief, usage: { provider: 'openai', actualCost: null } })) }
  return { deps, client, publisher, setHead: (sha: string) => { head = sha } }
}

describe('automatic PR lifecycle', () => {
  it('collects, analyzes once, publishes an app-owned brief, and reports progress', async () => {
    const s = setupStore(), d = dependencies()
    try {
      handleEvent(s, 'pull_request', 'd', event())
      await processJob(s, vault, s.take()!, d.deps)
      expect(d.deps.analyze).toHaveBeenCalledTimes(1)
      expect(d.publisher.createComment).toHaveBeenCalledTimes(1)
      expect(d.publisher.createComment.mock.calls[0][3]).toContain('North, the Compass guide')
      expect(vi.mocked(d.client.updateCheck).mock.calls.map(c => c[1])).toEqual(['gathering', 'analyzing', 'posting', 'posted'])
      expect(s.recent(11)[0].stage).toBe('posted')
    } finally { s.close() }
  })
  it('updates its existing comment when a new commit arrives', async () => {
    const s = setupStore(), d = dependencies()
    try {
      handleEvent(s, 'pull_request', 'd1', event()); await processJob(s, vault, s.take()!, d.deps)
      const sha = '2'.repeat(40); d.setHead(sha)
      vi.mocked(d.client.collect).mockResolvedValue({ ...collection, headSha: sha })
      vi.mocked(d.deps.analyze).mockResolvedValue({ brief: { ...brief, provenance: { ...brief.provenance, headCommitSha: sha } }, usage: { provider: 'openai', actualCost: null } })
      handleEvent(s, 'pull_request', 'd2', event(sha, 'synchronize')); await processJob(s, vault, s.take()!, d.deps)
      expect(d.publisher.createComment).toHaveBeenCalledTimes(1)
      expect(d.publisher.updateComment).toHaveBeenCalledTimes(1)
      expect(d.publisher.updateComment.mock.calls[0][3]).toContain('2222222')
    } finally { s.close() }
  })
  it('does not spend on a stale queued snapshot', async () => {
    const s = setupStore(), d = dependencies()
    try {
      vi.mocked(d.client.collect).mockResolvedValue({ ...collection, headSha: '2'.repeat(40) })
      handleEvent(s, 'pull_request', 'd', event()); await processJob(s, vault, s.take()!, d.deps)
      expect(d.deps.analyze).not.toHaveBeenCalled()
      expect(s.recent(11)[0].stage).toBe('skipped')
    } finally { s.close() }
  })
  it('refuses publication when the PR changes during analysis', async () => {
    const s = setupStore(), d = dependencies()
    try {
      vi.mocked(d.deps.analyze).mockImplementation(async () => { d.setHead('2'.repeat(40)); return { brief, usage: { provider: 'openai', actualCost: null } } })
      handleEvent(s, 'pull_request', 'd', event()); await processJob(s, vault, s.take()!, d.deps)
      expect(d.publisher.createComment).not.toHaveBeenCalled()
      expect(s.recent(11)[0].stage).toBe('failed')
    } finally { s.close() }
  })
  it('stops queued work when disconnected and in-flight publication when paused', async () => {
    const s = setupStore(), d = dependencies()
    try {
      handleEvent(s, 'pull_request', 'd1', event()); const job = s.take()!
      s.removeSettings(11); await processJob(s, vault, job, d.deps)
      expect(d.deps.client).not.toHaveBeenCalled()
      s.saveSettings(settings)
      handleEvent(s, 'pull_request', 'd2', event('2'.repeat(40)))
      vi.mocked(d.client.collect).mockResolvedValue({ ...collection, headSha: '2'.repeat(40) })
      vi.mocked(d.deps.analyze).mockImplementation(async () => { s.saveSettings({ ...settings, enabled: false }); return { brief, usage: { provider: 'openai', actualCost: null } } })
      await processJob(s, vault, s.take()!, d.deps)
      expect(d.publisher.createComment).not.toHaveBeenCalled()
      expect(s.recent(11)[0].stage).toBe('skipped')
    } finally { s.close() }
  })
  it('counts failed attempts against the daily cap and never retries them', async () => {
    const s = setupStore(), d = dependencies()
    try {
      s.saveSettings({ ...settings, dailyRuns: 1 })
      vi.mocked(d.deps.analyze).mockRejectedValue(new Error('secret-provider-key should never leak'))
      handleEvent(s, 'pull_request', 'd1', event()); await processJob(s, vault, s.take()!, d.deps)
      handleEvent(s, 'pull_request', 'd2', event('2'.repeat(40)))
      vi.mocked(d.client.collect).mockResolvedValue({ ...collection, headSha: '2'.repeat(40) })
      await processJob(s, vault, s.take()!, d.deps)
      expect(d.deps.analyze).toHaveBeenCalledTimes(1)
      expect(s.recent(11)[0].message).toContain('Daily run limit')
      expect(JSON.stringify(s.recent(11))).not.toContain('secret-provider-key')
    } finally { s.close() }
  })
  it('retains posted outcome if only the final check update fails', async () => {
    const s = setupStore(), d = dependencies()
    try {
      vi.mocked(d.client.updateCheck).mockImplementation(async (_id, stage) => { if (stage === 'posted') throw new Error('network') })
      handleEvent(s, 'pull_request', 'd', event()); await processJob(s, vault, s.take()!, d.deps)
      expect(s.recent(11)[0].stage).toBe('posted')
      expect(s.recent(11)[0].message).toContain('check update failed')
    } finally { s.close() }
  })
})

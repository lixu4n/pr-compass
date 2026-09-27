import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { Vault, verifyWebhook, sameOrigin } from '../../tools/server/security.js'
import { handleEvent } from '../../tools/server/webhook.js'
import { setupStore, settings, event } from './fixtures.js'

describe('hosted trust boundaries', () => {
  it('encrypts credentials with tenant binding and authenticated tamper detection', () => {
    const v = new Vault('ab'.repeat(32))
    const first = v.seal('secret-key', 'repo:1'), second = v.seal('secret-key', 'repo:1')
    expect(first).not.toEqual(second)
    expect(first).not.toContain('secret-key')
    expect(v.open(first, 'repo:1')).toBe('secret-key')
    expect(() => v.open(first, 'repo:2')).toThrow()
    expect(() => v.open(first.replace(/^./, first[0] === 'A' ? 'B' : 'A'), 'repo:1')).toThrow()
  })
  it('validates original webhook bytes, not a reserialized payload', () => {
    const b = Buffer.from('{ "a":1 }'), secret = 'webhook-secret'
    const sig = 'sha256=' + createHmac('sha256', secret).update(b).digest('hex')
    expect(verifyWebhook(b, sig, secret)).toBe(true)
    expect(verifyWebhook(Buffer.from('{"a":1}'), sig, secret)).toBe(false)
    expect(verifyWebhook(b, 'sha256=x', secret)).toBe(false)
    expect(verifyWebhook(b, undefined, secret)).toBe(false)
  })
  it('requires both exact origin and session-specific CSRF token', () => {
    expect(sameOrigin('https://compass.example', 'https://compass.example', 'csrf', 'csrf')).toBe(true)
    expect(sameOrigin('https://evil.example', 'https://compass.example', 'csrf', 'csrf')).toBe(false)
    expect(sameOrigin('https://compass.example', 'https://compass.example', 'other', 'csrf')).toBe(false)
  })
  it('deduplicates redeliveries and the same snapshot across different deliveries', () => {
    const s = setupStore()
    try {
      expect(handleEvent(s, 'pull_request', 'delivery-1', event())).toBe(true)
      expect(handleEvent(s, 'pull_request', 'delivery-1', event())).toBe(false)
      expect(handleEvent(s, 'pull_request', 'delivery-2', event())).toBe(false)
      expect(handleEvent(s, 'pull_request', 'delivery-3', event('2'.repeat(40), 'synchronize'))).toBe(true)
      expect(s.recent(11)).toHaveLength(2)
    } finally { s.close() }
  })
  it('rejects other installations, disabled repos, forks, drafts, bots and unapproved events', () => {
    const s = setupStore()
    try {
      const wrong = event(); wrong.installation.id = 999
      const fork = event(); fork.pull_request.head.repo.id = 999
      const draft = event(); draft.pull_request.draft = true
      const bot = event(); bot.pull_request.user.type = 'Bot'
      for (const data of [wrong, fork, draft, bot, event('1'.repeat(40), 'edited')]) expect(handleEvent(s, 'pull_request', 'd', data)).toBe(false)
      s.saveSettings({ ...settings, enabled: false })
      expect(handleEvent(s, 'pull_request', 'd', event())).toBe(false)
      expect(s.take()).toBeUndefined()
    } finally { s.close() }
  })
  it('revokes credentials on uninstall or repository removal, but not another installation event', () => {
    const s = setupStore()
    try {
      handleEvent(s, 'installation_repositories', 'x', { action: 'removed', installation: { id: 999 }, repositories_removed: [{ id: 11 }] })
      expect(s.getSettings(11)).toBeDefined()
      handleEvent(s, 'installation', 'x', { action: 'deleted', installation: { id: 22 } })
      expect(s.getSettings(11)).toBeUndefined()
    } finally { s.close() }
  })
  it('recovers uncertain work without putting a possibly paid attempt back in the queue', () => {
    const s = setupStore()
    try {
      handleEvent(s, 'pull_request', 'd', event())
      const job = s.take()!
      expect(s.reserve(job, 1)).toBe(true)
      s.update(job.id, 'analyzing', 'Started')
      expect(s.recover()).toHaveLength(1)
      expect(s.take()).toBeUndefined()
      expect(s.recent(11)[0].stage).toBe('interrupted')
      expect(s.recent(11)[0].inferenceAt).not.toBeNull()
    } finally { s.close() }
  })
  it('consumes OAuth state once and expires sessions', () => {
    const s = setupStore()
    try {
      s.oauth('state', 'encrypted-verifier')
      expect(s.consumeOAuth('wrong')).toBeUndefined()
      expect(s.consumeOAuth('state')).toBe('encrypted-verifier')
      expect(s.consumeOAuth('state')).toBeUndefined()
      s.putSession('session', { userId: 1, login: 'test', csrf: 'csrf', encryptedToken: 'enc', expires: Date.now() - 1 })
      expect(s.session('session')).toBeUndefined()
    } finally { s.close() }
  })
})

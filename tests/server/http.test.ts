import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHmac } from 'node:crypto'
import { createHandler, type HttpDependencies } from '../../tools/server/http.js'
import { setupStore, vault, settings, event } from './fixtures.js'
import type { Store } from '../../tools/server/store.js'

let server: Server, store: Store, origin: string, deps: HttpDependencies
const repos = [{ id: 11, installationId: 22, fullName: settings.fullName, private: true }]
beforeEach(async () => {
  store = setupStore()
  store.putSession('valid-session', { userId: 33, login: 'owner', csrf: 'csrf-test', encryptedToken: vault.seal('oauth-secret', 'user:33'), expires: Date.now() + 100_000 })
  deps = { origin: '', staticRoot: '/nonexistent', webhookSecret: 'webhook-secret', store, vault,
    github: { config: { appId: '1', slug: 'test-compass', clientId: 'id', clientSecret: 'secret', privateKey: 'key', origin: '' },
      authorizeUrl: vi.fn(() => 'https://github.com/login/oauth/authorize'), exchange: vi.fn(async () => 'user-access-token'),
      user: vi.fn(async () => ({ id: 33, login: 'owner' })), repositories: vi.fn(async () => repos) } }
  server = createServer((req, res) => { void createHandler(deps)(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  deps.origin = origin
})
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close() })
const data = () => ({ repositoryId: 11, installationId: 22, provider: 'openai', apiKey: 'new-model-secret', model: 'gpt-4.1-mini', maxBobcoins: 0.5, maxOutputTokens: 2048, dailyRuns: 5, acceptLicense: false, consent: true })
function post(path: string, payload: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + path, { method: 'POST', headers: { Cookie: 'compass_session=valid-session', Origin: origin,
    'X-CSRF-Token': 'csrf-test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) })
}
describe('HTTP authorization and credential handling', () => {
  it('requires sign-in and never includes credentials in repository responses', async () => {
    expect((await fetch(origin + '/api/repositories')).status).toBe(401)
    const result = await fetch(origin + '/api/repositories', { headers: { Cookie: 'compass_session=valid-session' } })
    const body = await result.text()
    expect(result.status).toBe(200)
    expect(body).not.toContain('encryptedKey')
    expect(body).not.toContain('test-provider-key')
    expect(body).not.toContain('oauth-secret')
  })
  it('rejects cross-origin and missing-CSRF settings writes', async () => {
    expect((await post('/api/settings', data(), { Origin: 'https://attacker.example' })).status).toBe(403)
    expect((await post('/api/settings', data(), { 'X-CSRF-Token': '' })).status).toBe(403)
  })
  it('rechecks repository admin access before saving and rejects forged repository IDs', async () => {
    expect((await post('/api/settings', { ...data(), repositoryId: 999 })).status).toBe(403)
    vi.mocked(deps.github!.repositories).mockResolvedValue([])
    expect((await post('/api/settings', data())).status).toBe(403)
    expect(vault.open(store.getSettings(11)!.encryptedKey, 'repo:11')).toBe('test-provider-key')
  })
  it('requires consent, encrypts keys and records an enablement without inference', async () => {
    expect((await post('/api/settings', { ...data(), consent: false })).status).toBe(400)
    const response = await post('/api/settings', data())
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('new-model-secret')
    const saved = store.getSettings(11)!
    expect(saved.enabled).toBe(true)
    expect(saved.encryptedKey).not.toContain('new-model-secret')
    expect(vault.open(saved.encryptedKey, 'repo:11')).toBe('new-model-secret')
    expect(store.recent(11)).toHaveLength(0)
  })
  it('requires separate Bob license acceptance', async () => {
    expect((await post('/api/settings', { ...data(), provider: 'bob' })).status).toBe(400)
    expect((await post('/api/settings', { ...data(), provider: 'bob', acceptLicense: true })).status).toBe(200)
  })
  it('pauses, resumes with consent, and removes the encrypted credential', async () => {
    expect((await post('/api/repositories/11/pause', {})).status).toBe(200)
    expect(store.getSettings(11)!.enabled).toBe(false)
    expect((await post('/api/repositories/11/resume', {})).status).toBe(400)
    expect((await post('/api/repositories/11/resume', { consent: true })).status).toBe(200)
    expect((await post('/api/repositories/11/disconnect', {})).status).toBe(200)
    expect(store.getSettings(11)).toBeUndefined()
  })
  it('checks webhook signatures before persisting any work', async () => {
    const raw = JSON.stringify(event())
    const headers = { 'X-GitHub-Delivery': 'test-delivery', 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }
    expect((await fetch(origin + '/api/webhooks/github', { method: 'POST', headers, body: raw })).status).toBe(401)
    expect(store.recent(11)).toHaveLength(0)
    headers['X-Hub-Signature-256'] = 'sha256=' + createHmac('sha256', deps.webhookSecret).update(raw).digest('hex')
    const response = await fetch(origin + '/api/webhooks/github', { method: 'POST', headers, body: raw })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ queued: true })
    expect(store.recent(11)).toHaveLength(1)
  })
  it('rejects OAuth callbacks unbound to this browser and consumes valid state once', async () => {
    store.oauth('state-test', vault.seal('verifier', `oauth:${(await import('../../tools/server/security.js')).hash('state-test')}`))
    const path = '/auth/callback?state=state-test&code=code'
    expect((await fetch(origin + path, { redirect: 'manual' })).status).toBe(400)
    expect(deps.github!.exchange).not.toHaveBeenCalled()
    const response = await fetch(origin + path, { redirect: 'manual', headers: { Cookie: 'compass_oauth=state-test' } })
    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect((await fetch(origin + path, { redirect: 'manual', headers: { Cookie: 'compass_oauth=state-test' } })).status).toBe(400)
    expect(deps.github!.exchange).toHaveBeenCalledTimes(1)
  })
  it('returns a generic error rather than leaking upstream responses', async () => {
    vi.mocked(deps.github!.repositories).mockRejectedValue(new Error('oauth-secret private-code'))
    const response = await fetch(origin + '/api/repositories', { headers: { Cookie: 'compass_session=valid-session' } })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('oauth-secret')
  })
})

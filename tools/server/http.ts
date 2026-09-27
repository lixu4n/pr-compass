import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { z } from 'zod'
import type { GitHubApp } from './github.js'
import type { Store } from './store.js'
import { hash, randomToken, sameOrigin, verifyWebhook, type Vault } from './security.js'
import { SettingsInput, type Session } from './types.js'
import { handleEvent } from './webhook.js'

export interface HttpDependencies {
  origin: string
  staticRoot: string
  webhookSecret: string
  store?: Store
  vault?: Vault
  github?: Pick<GitHubApp, 'config' | 'authorizeUrl' | 'exchange' | 'user' | 'repositories'>
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const cookie = (req: IncomingMessage, name: string) => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}
async function body(req: IncomingMessage, max = 64_000) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += (chunk as Buffer).length
    if (length > max) throw new HttpError(413, 'Request too large.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
async function input(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON required.')
  try { return JSON.parse((await body(req)).toString('utf8')) as unknown } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(400, 'Invalid JSON.')
  }
}

export function createHandler(deps: HttpDependencies) {
  const secure = deps.origin.startsWith('https:')
  const setCookie = (name: string, value: string, seconds: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://github.com")
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    try {
      const url = new URL(req.url ?? '/', deps.origin)
      const path = url.pathname
      const { store, vault, github } = deps
      const ready = !!(store && vault && github)
      const sessionId = cookie(req, 'compass_session')
      const session = store?.session(sessionId)
      const requireSession = (): Session => {
        if (!ready) throw new HttpError(503, 'This deployment is not connected to a GitHub App yet.')
        if (!session) throw new HttpError(401, 'Sign in with GitHub to continue.')
        return session
      }
      const redirect = (location: string) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end() }

      if (path === '/healthz') { json(res, 200, { status: 'ok', configured: ready }); return }
      if (path === '/api/session' && req.method === 'GET') {
        json(res, 200, { configured: ready, user: session ? { login: session.login } : null, csrf: session?.csrf,
          installUrl: github ? `https://github.com/apps/${github.config.slug}/installations/new` : null }); return
      }
      if (path === '/auth/github' && req.method === 'GET') {
        if (!ready) throw new HttpError(503, 'GitHub App registration is required before connecting.')
        const state = randomToken(), verifier = randomToken()
        store.oauth(state, vault.seal(verifier, `oauth:${hash(state)}`))
        res.setHeader('Set-Cookie', setCookie('compass_oauth', state, 600))
        redirect(github.authorizeUrl(state, verifier)); return
      }
      if (path === '/auth/callback' && req.method === 'GET') {
        if (!ready) throw new HttpError(503, 'GitHub App is not configured.')
        const state = url.searchParams.get('state') ?? ''
        if (!state || state.length > 100 || hash(cookie(req, 'compass_oauth')) !== hash(state)) throw new HttpError(400, 'Sign-in state expired or did not match. Start sign-in again.')
        const encryptedVerifier = store.consumeOAuth(state)
        const code = url.searchParams.get('code') ?? ''
        if (!encryptedVerifier || !code || code.length > 512) throw new HttpError(400, 'Sign-in state expired. Start sign-in again.')
        const token = await github.exchange(code, vault.open(encryptedVerifier, `oauth:${hash(state)}`))
        const user = await github.user(token)
        store.logout(sessionId)
        const id = randomToken()
        store.putSession(id, { userId: user.id, login: user.login, encryptedToken: vault.seal(token, `user:${user.id}`),
          csrf: randomToken(), expires: Date.now() + 3_600_000 })
        res.setHeader('Set-Cookie', [setCookie('compass_session', id, 3600), setCookie('compass_oauth', '', 0)])
        redirect('/'); return
      }
      if (path === '/api/webhooks/github' && req.method === 'POST') {
        if (!ready) throw new HttpError(503, 'GitHub App is not configured.')
        const raw = await body(req, 2_000_000)
        if (!verifyWebhook(raw, req.headers['x-hub-signature-256'] as string | undefined, deps.webhookSecret)) throw new HttpError(401, 'Invalid webhook signature.')
        const delivery = req.headers['x-github-delivery'], event = req.headers['x-github-event']
        if (typeof delivery !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || typeof event !== 'string') throw new HttpError(400, 'Missing webhook metadata.')
        let payload: unknown
        try { payload = JSON.parse(raw.toString('utf8')) } catch { throw new HttpError(400, 'Invalid event JSON.') }
        json(res, 202, { queued: handleEvent(store, event, delivery, payload) }); return
      }
      if (path.startsWith('/api/')) {
        const s = requireSession()
        if (req.method !== 'GET' && !sameOrigin(req.headers.origin, deps.origin, req.headers['x-csrf-token'] as string | undefined, s.csrf)) {
          throw new HttpError(403, 'Request origin or session token did not match.')
        }
        if (path === '/api/logout' && req.method === 'POST') {
          store!.logout(sessionId)
          res.setHeader('Set-Cookie', setCookie('compass_session', '', 0))
          json(res, 200, { ok: true }); return
        }
        // Recheck GitHub's current repository-admin permissions on every settings/read request.
        const repositories = await github!.repositories(vault!.open(s.encryptedToken, `user:${s.userId}`))
        if (path === '/api/repositories' && req.method === 'GET') {
          json(res, 200, { repositories: repositories.map(repo => {
            const settings = store!.getSettings(repo.id)
            const own = settings?.installationId === repo.installationId ? settings : undefined
            return { ...repo, settings: own ? { enabled: own.enabled, provider: own.provider, model: own.model,
              maxBobcoins: own.maxBobcoins, maxOutputTokens: own.maxOutputTokens, dailyRuns: own.dailyRuns, consentAt: own.consentAt } : null,
              jobs: store!.recent(repo.id).map(({ id, pr, sha, stage, message, createdAt, usage }) => ({ id, pr, sha, stage, message, createdAt, usage })) }
          }) }); return
        }
        if (path === '/api/settings' && req.method === 'POST') {
          const parsed = SettingsInput.safeParse(await input(req))
          if (!parsed.success) throw new HttpError(400, 'Select a repository, provide valid provider settings, and accept the required permissions.')
          const data = parsed.data
          const repo = repositories.find(r => r.id === data.repositoryId && r.installationId === data.installationId)
          if (!repo) throw new HttpError(403, 'Repository administrator access and an active Compass installation are required.')
          const { apiKey, consent: _consent, ...rest } = data
          store!.saveSettings({ ...rest, fullName: repo.fullName, private: repo.private, ownerId: s.userId,
            encryptedKey: vault!.seal(apiKey, `repo:${repo.id}`), enabled: true, generation: randomToken(), consentAt: new Date().toISOString() })
          json(res, 200, { ok: true }); return
        }
        const match = path.match(/^\/api\/repositories\/(\d+)\/(pause|resume|disconnect)$/)
        if (match && req.method === 'POST') {
          const id = Number(match[1])
          const repo = repositories.find(r => r.id === id)
          const settings = store!.getSettings(id)
          if (!repo || !settings || settings.installationId !== repo.installationId) throw new HttpError(403, 'Repository administrator access is required.')
          if (match[2] === 'disconnect') store!.removeSettings(id)
          else {
            if (match[2] === 'resume' && !z.object({ consent: z.literal(true) }).strict().safeParse(await input(req)).success) throw new HttpError(400, 'Confirm automatic model processing before resuming.')
            store!.saveSettings({ ...settings, enabled: match[2] === 'resume', generation: randomToken(), consentAt: new Date().toISOString() })
          }
          json(res, 200, { ok: true }); return
        }
        throw new HttpError(404, 'Endpoint not found.')
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.')
      const root = resolve(deps.staticRoot)
      const file = path === '/' || path === '/demo' || path === '/setup' || path === '/connect' ? resolve(root, 'index.html') : resolve(root, `.${decodeURIComponent(path)}`)
      if (!file.startsWith(root + sep)) throw new HttpError(404, 'File not found.')
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
      if (!mime[extname(file)]) throw new HttpError(404, 'File not found.')
      let data: Buffer
      try { data = await readFile(file) } catch { throw new HttpError(404, 'File not found. Build the web app first.') }
      res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 502,
        { error: error instanceof HttpError ? error.message : 'Connection failed. Reconnect GitHub or check the service configuration.' })
    }
  }
}

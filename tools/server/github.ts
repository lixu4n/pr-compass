import { createHash, sign } from 'node:crypto'
import { Octokit } from '@octokit/rest'
import type { Repository } from './types.js'
import type { GitHubPublishProvider, PublicationState } from '../compass/publish.js'

export interface GitHubConfig {
  appId: string
  slug: string
  privateKey: string
  clientId: string
  clientSecret: string
  origin: string
}
export class GitHubApp {
  constructor(readonly config: GitHubConfig) {}
  private jwt() {
    const now = Math.floor(Date.now() / 1000)
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const message = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: this.config.appId })}`
    return `${message}.${sign('RSA-SHA256', Buffer.from(message), this.config.privateKey).toString('base64url')}`
  }
  client(token: string) { return new Octokit({ auth: token, request: { timeout: 20_000 } }) }
  authorizeUrl(state: string, verifier: string) {
    const params = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: `${this.config.origin}/auth/callback`, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
    return `https://github.com/login/oauth/authorize?${params}`
  }
  async exchange(code: string, verifier: string): Promise<string> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
        code, code_verifier: verifier, redirect_uri: `${this.config.origin}/auth/callback` }),
    })
    const body = await response.json() as { access_token?: string }
    if (!response.ok || !body.access_token) throw new Error('GitHub sign-in failed. Please try again.')
    return body.access_token
  }
  async user(token: string) {
    const { data } = await this.client(token).users.getAuthenticated()
    return { id: data.id, login: data.login }
  }
  /** Only expose installed repositories for which the signed-in user is an administrator. */
  async repositories(token: string): Promise<Repository[]> {
    const client = this.client(token)
    const installations = await client.paginate(client.apps.listInstallationsForAuthenticatedUser, { per_page: 100 })
    const result: Repository[] = []
    for (const installation of installations) {
      if (String(installation.app_id) !== this.config.appId || installation.suspended_at) continue
      const repos = await client.paginate(client.apps.listInstallationReposForAuthenticatedUser,
        { installation_id: installation.id, per_page: 100 })
      for (const repo of repos) {
        if (repo.permissions?.admin) result.push({ id: repo.id, fullName: repo.full_name, private: repo.private, installationId: installation.id })
      }
    }
    return result
  }
  async installationToken(installationId: number, repositoryId: number): Promise<string> {
    const client = this.client(this.jwt())
    // Verify the configured slug against GitHub, rather than accepting an arbitrary bot identity.
    const { data: app } = await client.apps.getAuthenticated()
    if (!app || String(app.id) !== this.config.appId || app.slug !== this.config.slug) throw new Error('GitHub App identity mismatch.')
    const { data } = await client.apps.createInstallationAccessToken({ installation_id: installationId,
      repository_ids: [repositoryId], permissions: { contents: 'read', pull_requests: 'write', checks: 'write' } })
    return data.token
  }
}

/** Installation-token publication; the legacy Actions publisher keeps its original restrictions. */
export class AppPublisher implements GitHubPublishProvider {
  constructor(private client: Octokit, private slug: string, private current: () => boolean) {}
  async listComments(owner: string, repo: string, prNumber: number, page: number, perPage: number) {
    const { data } = await this.client.issues.listComments({ owner, repo, issue_number: prNumber, page, per_page: perPage })
    return data.map(c => ({ id: c.id, body: c.body ?? '', user: c.user ? { login: c.user.login } : null }))
  }
  private assertEnabled() { if (!this.current()) throw new Error('Automation was paused or reconfigured.') }
  async createComment(owner: string, repo: string, prNumber: number, body: string) {
    this.assertEnabled()
    await this.client.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }
  async updateComment(owner: string, repo: string, commentId: number, body: string) {
    this.assertEnabled()
    await this.client.issues.updateComment({ owner, repo, comment_id: commentId, body })
  }
  async getPublicationState(owner: string, repo: string, prNumber: number): Promise<PublicationState> {
    this.assertEnabled()
    const { data } = await this.client.pulls.get({ owner, repo, pull_number: prNumber })
    return { headSha: data.head.sha, baseSha: data.base.sha, state: data.state, draft: data.draft ?? true,
      baseRepository: data.base.repo.full_name, headRepository: data.head.repo?.full_name ?? null,
      isPrivate: data.base.repo.private, authorIsBot: !data.user || data.user.type === 'Bot' || data.user.login.endsWith('[bot]') }
  }
  async getBotLogin() { return `${this.slug}[bot]` }
}

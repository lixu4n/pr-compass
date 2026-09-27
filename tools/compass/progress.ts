import { Octokit } from '@octokit/rest'

/** Optional GitHub Actions check; never a review verdict. */
export class ActionProgress {
  private client: Octokit
  private id?: number
  constructor(token: string, private owner: string, private repo: string, readonly sha: string) {
    if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Progress checks require GitHub Actions and an exact head SHA.')
    this.client = new Octokit({ auth: token, request: { timeout: 20_000 } })
  }
  async start() {
    const { data } = await this.client.checks.create({ owner: this.owner, repo: this.repo, name: 'Compass context',
      head_sha: this.sha, status: 'in_progress', output: { title: 'Gathering context', summary: 'Reading PR context. No target code is executed.' } })
    this.id = data.id
  }
  async update(title: string, conclusion?: 'success' | 'failure' | 'neutral') {
    if (!this.id) return
    await this.client.checks.update({ owner: this.owner, repo: this.repo, check_run_id: this.id,
      status: conclusion ? 'completed' : 'in_progress', ...(conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}),
      output: { title, summary: 'Compass provides source-linked context for human review. This check does not approve the pull request.' } })
  }
}

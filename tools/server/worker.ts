import type { Store } from './store.js'
import type { Vault } from './security.js'
import type { Job, Settings, Stage } from './types.js'
import type { CollectionResult, SkipReason } from '../compass/collect.js'
import { collect } from '../compass/collect.js'
import { publish, type GitHubPublishProvider } from '../compass/publish.js'
import { render } from '../compass/render.js'
import { OctokitGitHubProvider } from '../compass/github-client.js'
import { AppPublisher, type GitHubApp } from './github.js'
import { analyzeWithModel, type ModelResult } from './models.js'

export interface RunClient {
  collect(): Promise<CollectionResult | SkipReason>
  createCheck(): Promise<number>
  updateCheck(id: number, stage: Stage, message: string): Promise<void>
  publisher: GitHubPublishProvider
}
export interface WorkerDependencies {
  client(job: Job, isCurrent: () => boolean): Promise<RunClient>
  analyze(collection: CollectionResult, settings: Settings, key: string): Promise<ModelResult>
}
export function liveDependencies(app: GitHubApp, instructions: string, bobPath: string): WorkerDependencies {
  return {
    async client(job, isCurrent) {
      const token = await app.installationToken(job.installationId, job.repositoryId)
      const client = app.client(token)
      const [owner, repo] = job.fullName.split('/')
      const actual = await client.repos.get({ owner, repo })
      if (actual.data.id !== job.repositoryId) throw new Error('Repository identity changed.')
      return {
        collect: () => collect(new OctokitGitHubProvider(token), owner, repo, job.pr, { allowPrivate: true }),
        async createCheck() {
          const { data } = await client.checks.create({ owner, repo, name: 'Compass', head_sha: job.sha,
            status: 'in_progress', external_id: String(job.id), started_at: new Date().toISOString(),
            output: { title: 'Gathering context', summary: 'Reading the pull request and its source context. No PR code is executed.' } })
          return data.id
        },
        async updateCheck(id, stage, message) {
          const running = ['gathering', 'analyzing', 'posting'].includes(stage)
          const titles: Partial<Record<Stage, string>> = { gathering: 'Gathering context', analyzing: 'Analyzing with your model',
            posting: 'Posting brief', posted: 'Brief posted', failed: 'Brief unavailable', skipped: 'Skipped', interrupted: 'Run interrupted' }
          await client.checks.update({ owner, repo, check_run_id: id, status: running ? 'in_progress' : 'completed',
            ...(!running ? { conclusion: stage === 'posted' ? 'success' as const : stage === 'failed' ? 'failure' as const : 'neutral' as const,
              completed_at: new Date().toISOString() } : {}),
            output: { title: titles[stage] ?? stage, summary: `${message}\n\nCompass provides context, not PR approval.` } })
        },
        publisher: new AppPublisher(client, app.config.slug, isCurrent),
      }
    },
    analyze: (collection, settings, key) => analyzeWithModel(collection, instructions, settings, key, bobPath),
  }
}

export async function processJob(store: Store, vault: Vault, job: Job, deps: WorkerDependencies): Promise<void> {
  const current = () => {
    const s = store.getSettings(job.repositoryId)
    return !!s?.enabled && s.installationId === job.installationId && s.generation === job.generation
  }
  let client: RunClient | undefined
  let checkId: number | null = job.checkId
  let published = false
  const stage = async (next: Stage, message: string) => {
    store.update(job.id, next, message)
    if (client && checkId !== null) await client.updateCheck(checkId, next, message)
  }
  try {
    if (!current()) { store.update(job.id, 'skipped', 'Automation was paused, disconnected, or reconfigured.'); return }
    client = await deps.client(job, current)
    checkId = await client.createCheck()
    store.check(job.id, checkId)
    await stage('gathering', 'Gathering PR context.')
    const collection = await client.collect()
    if ('skip' in collection) { await stage('skipped', 'This PR is closed, a draft, from a fork, or bot-authored.'); return }
    if (collection.headSha !== job.sha || collection.baseSha !== job.baseSha || collection.repository.toLowerCase() !== job.fullName.toLowerCase()) {
      await stage('skipped', 'PR changed since this event. No model call was made.'); return
    }
    const settings = store.getSettings(job.repositoryId)!
    if (!current()) { await stage('skipped', 'Automation was paused or reconfigured.'); return }
    // Decrypt before reserving; a broken credential record cannot spend a run.
    const key = vault.open(settings.encryptedKey, `repo:${job.repositoryId}`)
    await stage('analyzing', `Analyzing with ${settings.provider === 'bob' ? 'IBM Bob' : 'OpenAI'}. Repair and automatic retries are disabled.`)
    if (!current()) { await stage('skipped', 'Automation was paused or reconfigured.'); return }
    if (!store.reserve(job, settings.dailyRuns)) { await stage('skipped', 'Daily run limit reached. No model call was made.'); return }
    const result = await deps.analyze(collection, settings, key)
    store.usage(job.id, result.usage)
    if (!current()) { await stage('skipped', 'Automation changed during analysis. Usage may have been incurred; no comment was posted.'); return }
    await stage('posting', 'Validating PR freshness and publishing the brief.')
    const [owner, repo] = job.fullName.split('/')
    const outcome = await publish(client.publisher, { owner, repo, prNumber: job.pr, body: render(result.brief),
      analyzedHeadSha: collection.headSha, analyzedBaseSha: collection.baseSha, allowPrivate: true })
    if (!outcome.ok) throw new Error('Publication was declined or failed.')
    published = true
    await stage('posted', result.brief.status === 'partial' ? 'Partial brief posted. Read its limitations before reviewing.' : 'Source-linked brief posted. Human review is still required.')
  } catch {
    // No exception text from GitHub/model responses crosses into the UI, logs, or checks.
    const message = published ? 'Brief posted, but the final GitHub check update failed.'
      : 'Run failed. Check GitHub permissions, model credentials, credits, and provider availability. No automatic retry was made; usage may have been incurred.'
    store.update(job.id, published ? 'posted' : 'failed', message)
    if (!published && client && checkId !== null) {
      try { await client.updateCheck(checkId, 'failed', message) } catch { /* Dashboard retains the outcome. */ }
    }
  }
}

export class Worker {
  private busy = false
  private stopping = false
  private timer?: ReturnType<typeof setInterval>
  constructor(private store: Store, private vault: Vault, private deps: WorkerDependencies) {}
  start() {
    const interrupted = this.store.recover()
    this.timer = setInterval(() => { void this.tick() }, 1500)
    // Never re-run inference after a crash, including a crash after an ambiguous model response.
    void this.finishInterrupted(interrupted).then(() => this.tick())
  }
  private async finishInterrupted(jobs: Job[]) {
    for (const job of jobs) {
      if (job.checkId === null) continue
      try {
        const client = await this.deps.client(job, () => false)
        await client.updateCheck(job.checkId, 'interrupted', 'Service restarted. Check comments and provider usage; no automatic paid retry.')
      } catch { /* Installation may have been revoked. */ }
    }
  }
  async tick() {
    if (this.busy || this.stopping) return
    this.busy = true
    try {
      this.store.cleanup()
      const job = this.store.take()
      if (job) await processJob(this.store, this.vault, job, this.deps)
    } finally { this.busy = false }
  }
  async stop() {
    this.stopping = true
    clearInterval(this.timer)
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 100))
  }
}

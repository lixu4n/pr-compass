import { z } from 'zod'
import type { Store } from './store.js'

const eventSchema = z.object({
  action: z.enum(['opened', 'reopened', 'synchronize', 'ready_for_review']),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ id: z.number().int().positive() }),
  pull_request: z.object({ number: z.number().int().positive(), state: z.literal('open'), draft: z.literal(false),
    head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/), repo: z.object({ id: z.number().int().positive() }) }),
    base: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/), repo: z.object({ id: z.number().int().positive() }) }),
    user: z.object({ type: z.literal('User') }),
  }),
})
const lifecycleSchema = z.object({ action: z.string(), installation: z.object({ id: z.number().int().positive() }),
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional() })

/** Call only after validating GitHub's signature over the original request bytes. */
export function handleEvent(store: Store, event: string, delivery: string, payload: unknown): boolean {
  if (event === 'installation' || event === 'installation_repositories') {
    const parsed = lifecycleSchema.safeParse(payload)
    if (!parsed.success) return false
    const data = parsed.data
    if (event === 'installation' && ['deleted', 'suspend'].includes(data.action)) store.revokeInstallation(data.installation.id)
    if (event === 'installation_repositories' && data.action === 'removed') {
      for (const repo of data.repositories_removed ?? []) {
        if (store.getSettings(repo.id)?.installationId === data.installation.id) store.removeSettings(repo.id)
      }
    }
    return false
  }
  if (event !== 'pull_request') return false
  const parsed = eventSchema.safeParse(payload)
  if (!parsed.success) return false
  const { installation, repository, pull_request: pr } = parsed.data
  if (pr.head.repo.id !== repository.id || pr.base.repo.id !== repository.id) return false
  const settings = store.getSettings(repository.id)
  if (!settings?.enabled || settings.installationId !== installation.id) return false
  return store.enqueue(delivery, { repositoryId: repository.id, installationId: installation.id, fullName: settings.fullName,
    pr: pr.number, sha: pr.head.sha, baseSha: pr.base.sha, generation: settings.generation })
}

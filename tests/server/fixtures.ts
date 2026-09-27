import { Store } from '../../tools/server/store.js'
import { Vault } from '../../tools/server/security.js'
import type { Settings } from '../../tools/server/types.js'
import type { CollectionResult } from '../../tools/compass/collect.js'
import { makeOkBrief } from '../automation/fixtures.js'
export const vault = new Vault('ab'.repeat(32))
export const settings: Settings = { repositoryId: 11, installationId: 22, fullName: 'test-org/test-repo', private: true,
  ownerId: 33, encryptedKey: vault.seal('test-provider-key', 'repo:11'), provider: 'openai', model: 'gpt-4.1-mini',
  maxBobcoins: 0.5, maxOutputTokens: 2048, dailyRuns: 2, acceptLicense: false, enabled: true, generation: 'generation-1', consentAt: new Date().toISOString() }
export function setupStore() { const s = new Store(':memory:'); s.saveSettings({ ...settings }); return s }
export function event(sha = '1'.repeat(40), action = 'opened') {
  return { action, installation: { id: 22 }, repository: { id: 11 }, pull_request: {
    number: 42, state: 'open', draft: false, user: { type: 'User' },
    head: { sha, repo: { id: 11 } }, base: { sha: '0'.repeat(40), repo: { id: 11 } },
  } }
}
export const brief = makeOkBrief()
export const collection: CollectionResult = { repository: settings.fullName, prNumber: 42, prTitle: 'Test change', prBody: 'Test',
  baseSha: '0'.repeat(40), headSha: '1'.repeat(40), mergeBaseSha: '0'.repeat(40), isFork: false, isDraft: false, isBot: false,
  sources: brief.sources, omissions: [] }

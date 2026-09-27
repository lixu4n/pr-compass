/** Experimental application-level orchestration, NOT native Bob subagents. */
import { parseEnvelope, assembleBrief, redactSecrets } from './analyze.js'
import { runRestrictedBob, type BobRuntimeConfig } from './bob-runtime.js'
import type { CollectionResult, GitHubProvider } from './collect.js'

import { ContextBriefSchema } from '../../src/types/ContextBrief.js'
import { validateBrief } from './validate.js'
import { RetrievalPlanSchema, ExperimentalWriterSchema, EvidenceCheckSchema, buildInvestigatorPrompt,
  buildWriterPrompt, buildEvidenceCheckerPrompt, statementsForChecking } from './role-contracts.js'

export type AgentRole = 'investigator' | 'writer' | 'reviewer'
export type AgentCall = (role: AgentRole, prompt: string, requestedCost: number) => Promise<string>
export function restrictedBobAgents(config: BobRuntimeConfig): AgentCall {
  return async (_role, prompt, requestedCost) => {
    const envelope = parseEnvelope(await runRestrictedBob(prompt, { ...config, maxCost: requestedCost }))
    if (!envelope.ok) throw new Error('Bob role did not return a successful result.')
    return envelope.message
  }
}
export interface RoleTrace {
  role: AgentRole; requestedCost: number; actualUsage: null; durationMs: number; outcome: string
}
export interface RetrievalTrace { path: string; reason: string; outcome: string; sourceIds: string[] }
export interface StageGuard { signal?: AbortSignal; check?: () => Promise<boolean> }
export interface OrchestrationTrace { nativeDelegation?: import('./native-explore.js').NativeDelegationTrace; trace: RoleTrace[]; retrieval: RetrievalTrace[] }

function allowedPath(path: string): boolean {
  const workflow = /^\.github\/workflows\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.ya?ml$/.test(path)
  const parts = path.split('/')
  return (workflow || /^[a-zA-Z0-9_./-]+\.(ts|tsx|js|jsx|md)$/.test(path)) &&
    !parts.some((p, i) => !p || p === '.' || p === '..' ||
      (p.startsWith('.') && !(workflow && i === 0)) ||
      /^(node_modules|vendor|dist|action-dist|server-dist|build|coverage|secrets?|credentials?)$/i.test(p)) &&
    !/(^|[._-])(secrets?|credentials?|private[-_]?key)([._-]|$)/i.test(parts.at(-1)!)
}

export async function orchestrate(collection: CollectionResult, instructions: string, provider: GitHubProvider,
  call: AgentCall, totalRequestedCost = 0.5, guard: StageGuard = {}) {
  const trace: RoleTrace[] = []
  const retrieval: RetrievalTrace[] = []
  let stage = 'configuration'
  const check = async () => {
    if (guard.signal?.aborted) throw new Error('cancelled')
    if (guard.check && !await guard.check()) throw new Error('stale or ineligible')
    if (guard.signal?.aborted) throw new Error('cancelled')
  }
  const fail = (reason: string) => {
    const last = trace.at(-1)
    if (last && last.outcome === 'returned') last.outcome = 'rejected'
    return { ok:false as const, reason, trace, retrieval }
  }
  try {
  if (!Number.isFinite(totalRequestedCost) || totalRequestedCost <= 0 || totalRequestedCost > 1) return fail('Invalid total requested budget.')
  const invoke = async (role: AgentRole, prompt: string, share: number) => {
    stage = role
    await check()
    if (Buffer.byteLength(prompt) > 128_000) throw new Error('input limit')
    const entry: RoleTrace = { role, requestedCost:totalRequestedCost * share, actualUsage:null, durationMs:0, outcome:'started' }
    trace.push(entry)
    const started = Date.now()
    try {
      const text = await call(role, prompt, entry.requestedCost)
      if (Buffer.byteLength(text) > 1_000_000) throw new Error('output limit')
      entry.outcome = 'returned'
      await check()
      return text
    } catch { entry.outcome = 'failed'; throw new Error('role failed') }
    finally { entry.durationMs = Date.now() - started }
  }
  const plan = RetrievalPlanSchema.parse(JSON.parse(await invoke('investigator', buildInvestigatorPrompt(collection), 0.2)))
  trace.at(-1)!.outcome = 'validated'
  stage = 'retrieval'
  const augmented: CollectionResult = { ...collection, sources: [...collection.sources], omissions: [...collection.omissions] }
  const [owner, repo] = collection.repository.split('/')
  let bytes = 0
  const seen = new Set<string>()
  for (const request of plan.requests) {
    const path = request.path
    await check()
    const record: RetrievalTrace = {path:redactSecrets(path), reason:redactSecrets(request.reason), outcome:'requested', sourceIds:[]}
    retrieval.push(record)
    if (!allowedPath(path) || seen.has(path)) { record.outcome = 'rejected or duplicate request'; continue }
    seen.add(path)
    // Initial records may be patches or bounded snippets. Fetch once to compare
    // actual content; a matching full source is reused instead of duplicated.
    let content
    try { content = await provider.getContent(owner, repo, path, collection.headSha) }
    catch { record.outcome = 'retrieval failed'; throw new Error('retrieval failed') }
    await check()
    if (!content || typeof content.content !== 'string' || content.type !== 'file' || content.encoding !== 'base64' || content.size > 12_000) {
      record.outcome = 'unavailable or exceeds 12000-byte limit'; continue
    }
    const raw = Buffer.from(content.content, 'base64')
    if (raw.length > 12_000 || bytes + raw.length > 24_000) { record.outcome = 'retrieval budget exceeded'; continue }
    bytes += raw.length
    const equivalent = augmented.sources.find(s => s.path === path && s.commitSha === collection.headSha &&
      s.kind !== 'patch' && s.snippet === raw.toString('utf8'))
    if (equivalent) { record.outcome = 'existing equivalent source'; record.sourceIds = [equivalent.id]; continue }
    let id = `agent-${augmented.sources.length + 1}`
    while (augmented.sources.some(s => s.id === id)) id += '-x'
    augmented.sources.push({ id, kind: path.endsWith('.md') ? 'doc' : 'code', repository:collection.repository,
      commitSha:collection.headSha,path,lines:null,url:`https://github.com/${collection.repository}/blob/${collection.headSha}/${path}`,snippet:raw.toString('utf8') })
    record.outcome = 'collected at analyzed head'; record.sourceIds = [id]
  }
  for (const r of retrieval) if (!['collected at analyzed head', 'existing equivalent source'].includes(r.outcome)) augmented.omissions.push(`Requested context ${r.path}: ${r.outcome}.`)
  const writerText = await invoke('writer', buildWriterPrompt(augmented, instructions), 0.6)
  let writerJson: unknown
  try { writerJson = JSON.parse(writerText) } catch {
    return fail('Writer output is not valid JSON.')
  }
  const parsed = ExperimentalWriterSchema.safeParse(writerJson)
  if (!parsed.success) return fail('Writer output violates the strict experimental contract.')
  const output = parsed.data
  // Require a useful candidate even for partial status, before paying for a check.
  if (output.status === 'unavailable' || !output.purpose?.summary.trim() || !output.readingOrder.length ||
      (output.status === 'partial' && !output.unavailableReason?.trim()) ||
      output.relevantContext.some(c => !c.statement.trim()) ||
      output.readingOrder.some(r => !r.label.trim() || !r.reason.trim())) {
    return fail('Writer output is unavailable, empty, or inconsistent.')
  }
  const claims = [
    { basis: output.purpose.basis, ids: output.purpose.sourceId ? [output.purpose.sourceId] : [], evidence: output.purpose.evidence },
    ...output.relevantContext.map(c => ({ basis:c.basis, ids:c.sourceIds, evidence:c.evidence })),
  ]
  if (claims.some(c => c.basis !== 'unknown' &&
      (!c.ids.length || c.ids.some(id => !c.evidence?.some(e => e.sourceId === id))))) {
    return fail('Factual claims require cited supporting excerpts.')
  }
  const assembled = assembleBrief(output, augmented, '0.2.0-experimental')
  if (!assembled.ok) return fail('Writer citations or excerpts failed validation.')
  if (!ContextBriefSchema.safeParse(assembled.brief).success || !validateBrief(assembled.brief).valid) {
    return fail('Candidate failed full brief validation.')
  }
  trace.at(-1)!.outcome = 'validated'
  const checkerText = await invoke('reviewer', buildEvidenceCheckerPrompt(augmented, assembled.brief), 0.2)
  let checkerJson: unknown
  try { checkerJson = JSON.parse(checkerText) } catch {
    return fail('Evidence checker output is not valid JSON.')
  }
  const checked = EvidenceCheckSchema.safeParse(checkerJson)
  if (!checked.success) return fail('Evidence checker output violates its contract.')
  const review = checked.data
  const statementIds = new Set(statementsForChecking(assembled.brief).map(s => s.statementId))
  const sourceIds = new Set(augmented.sources.map(s => s.id))
  if (review.findings.some(f => !statementIds.has(f.statementId) || f.sourceIds.some(id => !sourceIds.has(id)))) {
    return fail('Evidence checker cited unknown statements or sources.')
  }
  if (review.verdict !== 'supported') return fail(`Evidence checker verdict: ${review.verdict}.`)
  if (!validateBrief(assembled.brief).valid) return fail('Final brief validation failed.')
  trace.at(-1)!.outcome = 'validated'
  stage = 'final guard'
  await check()
  return { ...assembled, trace, retrieval, advisoryReview:review }
  } catch {
    // Never persist raw provider errors, prompts, candidate prose, or credentials.
    for (const record of retrieval) if (record.outcome === 'requested') record.outcome = 'interrupted'
    return fail(`Experimental analysis stopped at ${stage}; role, retrieval, or snapshot check failed. No retry was made.`)
  }
}

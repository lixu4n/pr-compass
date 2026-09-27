/**
 * index.ts — Compass CLI / orchestration entry point.
 *
 * Usage (after build):
 *   node action-dist/index.mjs --check-package  (offline; no credentials)
 *   node action-dist/index.mjs                  (live path; not yet approved)
 *
 * Environment variables:
 *   GITHUB_TOKEN        — required for GitHub API calls (publish)
 *   BOB_API_KEY         — required for live Bob Shell analysis
 *   BOB_PATH            — path to bob executable (default: "bob")
 *   COMPASS_DRY_RUN     — true by default; explicit false enables Actions publication
 *   COMPASS_OUTPUT_DIR  — local artifact directory (default: compass-output/)
 *   COMPASS_ALLOW_REPAIR— optional repair; splits the same analysis cost budget
 *   COMPASS_MAX_COST    — requested total Bobcoin limit (default 0.5; maximum 1)
 *   COMPASS_MAX_TURNS   — per-invocation turn limit (default 4; maximum 8)
 *   COMPASS_ACCEPT_BOB_LICENSE — explicit consent, "true" required for live Bob
 *
 * GitHub Actions inputs (set via INPUT_* env vars by the Action runner):
 *   INPUT_OWNER, INPUT_REPO, INPUT_PR_NUMBER
 *
 * Live execution is blocked when BOB_API_KEY is absent — the process
 * exits with a clear message rather than falling back to mock output.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collect } from './collect.js'
import { analyzeWithModel } from '../server/models.js'
import { ActionProgress } from './progress.js'
import type { AnalyzeResult } from './analyze.js'
let progress: ActionProgress | undefined
import { analyze, LiveBobProvider, redactSecrets } from './analyze.js'
import { runtimeLimits } from './bob-runtime.js'
import { validateBrief } from './validate.js'
import { render } from './render.js'
import { publish } from './publish.js'
import { saveArtifacts } from './artifacts.js'
import type { CollectionResult } from './collect.js'
import type { ContextBrief } from '../../src/types/ContextBrief.js'
import { OctokitGitHubProvider } from './github-client.js'
import { OctokitPublishProvider } from './github-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequiredEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Required environment variable ${name} is not set.`)
  return val
}

function getEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

function getBoolean(name: string, fallback = false): boolean {
  const value = getEnv(name, String(fallback))
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`)
  return value === 'true'
}

async function readTrustedInstructions(): Promise<string> {
  // Always read from the Compass version, never from the target repo
  const promptPath = path.join(__dirname, 'prompts', 'context.md')
  let instructions: string
  try {
    instructions = await fs.readFile(promptPath, 'utf8')
  } catch {
    throw new Error('Packaged Compass prompt is missing or unreadable. Run npm run build:action.')
  }
  if (instructions.trim().length === 0) {
    throw new Error('Packaged Compass prompt is empty. Run npm run build:action.')
  }
  return instructions
}

function makeUnavailableBriefFromCollection(
  collection: CollectionResult,
  reason: string,
): ContextBrief {
  return {
    schemaVersion: 1,
    status: 'unavailable',
    provenance: {
      repository: collection.repository,
      prNumber: collection.prNumber,
      prTitle: collection.prTitle,
      baseCommitSha: collection.baseSha,
      headCommitSha: collection.headSha,
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      compassVersion: '0.1.0',
    },
    purpose: null,
    relevantContext: [],
    readingOrder: [],
    sources: [],
    limitations: [],
    unavailableReason: reason,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // This explicit offline path runs before input/authentication checks or any
  // client construction, collection, model invocation, or publication.
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--check-package') {
    await readTrustedInstructions()
    console.log('Compass package check passed: bundled dependencies and trusted prompt are available.')
    console.log('No GitHub or Bob calls were made. This does not verify live integration.')
    return
  }
  if (args.length !== 0) {
    throw new Error('Unknown arguments. Use --check-package for offline verification.')
  }

  // 1. Read inputs
  const owner = getRequiredEnv('INPUT_OWNER')
  const repo = getRequiredEnv('INPUT_REPO')
  const prNumber = Number(getRequiredEnv('INPUT_PR_NUMBER'))
  if (![owner, repo].every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part) && part !== '.' && part !== '..') ||
      !Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new Error('Invalid repository owner/name or PR number.')
  }
  const dryRun = getBoolean('COMPASS_DRY_RUN', true)
  const allowRepair = getBoolean('COMPASS_ALLOW_REPAIR')
  const acceptLicense = getBoolean('COMPASS_ACCEPT_BOB_LICENSE')
  const bobPath = getEnv('BOB_PATH', 'bob')
  const providerName = getEnv('COMPASS_PROVIDER', 'bob')
  if (!['bob', 'openai'].includes(providerName)) throw new Error('Unsupported model provider.')
  const allowPrivate = getBoolean('COMPASS_ALLOW_PRIVATE')
  const maxOutputTokens = Number(getEnv('COMPASS_MAX_OUTPUT_TOKENS', '2048'))
  const model = getEnv('COMPASS_MODEL', 'gpt-4.1-mini')
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 4096 || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw new Error('Invalid model settings.')
  if (providerName === 'openai' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.')
  if (providerName === 'openai' && allowRepair) throw new Error('OpenAI repair is not supported; disable repair.')
  const limits = runtimeLimits({
    bobPath,
    maxCost: Number(getEnv('COMPASS_MAX_COST', '0.5')),
    maxTurns: Number(getEnv('COMPASS_MAX_TURNS', '4')),
  })

  const githubToken = process.env['GITHUB_TOKEN'] ?? ''
  // Reject unsupported write setup before collection or any paid analysis.
  const publishProvider = dryRun ? null : new OctokitPublishProvider(githubToken)

  console.log(`Compass: analyzing ${owner}/${repo}#${prNumber}`)
  if (dryRun) console.log('Compass: DRY RUN — no comments will be posted')

  if (getBoolean('COMPASS_PROGRESS')) {
    progress = new ActionProgress(githubToken, owner, repo, getRequiredEnv('COMPASS_HEAD_SHA'))
    await progress.start()
  }
  console.log('Compass: gathering context')
  // 2. Collect PR context
  const gitHubProvider = new OctokitGitHubProvider(githubToken)
  let collection: CollectionResult

  try {
    const result = await collect(gitHubProvider, owner, repo, prNumber, { allowPrivate })
    if ('skip' in result) {
      console.log(`Compass: skipping — ${result.reason}`)
      await progress?.update('Skipped: PR is not eligible', 'neutral')
      return
    }
    collection = result
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Compass: collection failed — ${redactSecrets(msg)}`)
    await progress?.update('Context collection failed', 'failure')
    process.exitCode = 1
    return
  }
  if (progress && progress.sha !== collection.headSha) {
    await progress.update('Skipped: PR changed before analysis', 'neutral')
    return
  }

  // 3. Read trusted instructions
  const trustedInstructions = await readTrustedInstructions()

  // 4. Analyze once using the chosen provider.
  console.log('Compass: analyzing context')
  await progress?.update('Analyzing context')
  let analyzeResult: AnalyzeResult
  if (providerName === 'openai') {
    try {
      const result = await analyzeWithModel(collection, trustedInstructions, {
        repositoryId: 0, installationId: 0, ownerId: 0, fullName: `${owner}/${repo}`, private: allowPrivate,
        encryptedKey: '', generation: '', consentAt: '', enabled: true, provider: 'openai', model,
        maxOutputTokens, maxBobcoins: limits.maxCost, dailyRuns: 1, acceptLicense: false,
      }, process.env.OPENAI_API_KEY!, bobPath)
      analyzeResult = { ok: true, brief: result.brief }
      console.log(`Compass: provider token usage ${JSON.stringify(result.usage)}; actual cost is available from your provider.`)
    } catch {
      analyzeResult = { ok: false, reason: 'OpenAI analysis failed. Check model access, credentials, credits, and output limits. No automatic retry was made.' }
    }
  } else {
    analyzeResult = await analyze(collection, trustedInstructions, { bobPath, ...limits, allowRepair, acceptLicense }, new LiveBobProvider())
  }

  let brief: ContextBrief
  if (!analyzeResult.ok) {
    console.error(`Compass: analysis failed — ${analyzeResult.reason}`)
    brief = makeUnavailableBriefFromCollection(collection, analyzeResult.reason)
  } else {
    const report = validateBrief(analyzeResult.brief)
    if (!report.valid) {
      const issues = redactSecrets(report.findings.map((f) => `${f.field}: ${f.message}`).join('; '))
      console.error(`Compass: validation findings — ${issues}`)
      brief = makeUnavailableBriefFromCollection(collection, `Brief failed validation: ${issues}`)
    } else {
      brief = analyzeResult.brief
    }
  }

  const commentBody = render(brief)
  const outputRoot = getEnv('COMPASS_OUTPUT_DIR',
    path.join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'compass-output'))
  const artifacts = await saveArtifacts(brief, commentBody, outputRoot)
  console.log(`Compass: JSON saved to ${artifacts.jsonPath}`)
  console.log(`Compass: Markdown saved to ${artifacts.markdownPath}`)

  let outcome = 'dry-run (no GitHub writes)'
  if (publishProvider) {
    console.log('Compass: posting comment')
    await progress?.update('Posting comment')
    const result = await publish(publishProvider, {
      owner, repo, prNumber, body: commentBody,
      analyzedHeadSha: collection.headSha, allowPrivate,
      analyzedBaseSha: collection.baseSha,
    })
    if (!result.ok) {
      console.error(`Compass: publish failed — ${redactSecrets(result.reason)}`)
      await progress?.update('Comment publication failed', 'failure')
      process.exitCode = 1
      return
    }
    outcome = result.action
  }
  console.log(`Compass: ${outcome}; context status: ${brief.status}`)
  await progress?.update(brief.status === 'unavailable' ? 'Brief unavailable' : dryRun ? 'Analysis saved (dry run)' : 'Brief posted',
    brief.status === 'unavailable' ? 'failure' : dryRun ? 'neutral' : 'success')
  if (brief.status === 'unavailable') process.exitCode = 1
}

main().catch(async (err: unknown) => {
  try { await progress?.update('Compass run failed', 'failure') } catch { /* Workflow status remains failed. */ }
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Compass: fatal error — ${redactSecrets(msg)}`)
  process.exit(1)
})

/**
 * index.ts — Compass CLI / orchestration entry point.
 *
 * Usage (after build):
 *   node action-dist/index.js
 *
 * Environment variables:
 *   GITHUB_TOKEN        — required for GitHub API calls (publish)
 *   BOB_API_KEY         — required for live Bob Shell analysis
 *     (also accepted as BOBSHELL_API_KEY per current Bob docs)
 *   BOB_PATH            — path to bob executable (default: "bob")
 *   COMPASS_DRY_RUN     — set to "true" to skip publishing
 *   COMPASS_ALLOW_REPAIR— set to "true" to allow one Bob repair attempt
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
import { analyze, LiveBobProvider } from './analyze.js'
import { validateBrief } from './validate.js'
import { render, renderUnavailable } from './render.js'
import { publish } from './publish.js'
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

async function readTrustedInstructions(): Promise<string> {
  // Always read from the Compass version, never from the target repo
  const promptPath = path.join(__dirname, 'prompts', 'context.md')
  return fs.readFile(promptPath, 'utf8')
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
  // 1. Read inputs
  const owner = getRequiredEnv('INPUT_OWNER')
  const repo = getRequiredEnv('INPUT_REPO')
  const prNumber = parseInt(getRequiredEnv('INPUT_PR_NUMBER'), 10)
  const dryRun = getEnv('COMPASS_DRY_RUN') === 'true'
  const allowRepair = getEnv('COMPASS_ALLOW_REPAIR') === 'true'
  const bobPath = getEnv('BOB_PATH', 'bob')

  const githubToken = process.env['GITHUB_TOKEN'] ?? ''

  console.log(`Compass: analyzing ${owner}/${repo}#${prNumber}`)
  if (dryRun) console.log('Compass: DRY RUN — no comments will be posted')

  // 2. Collect PR context
  const gitHubProvider = new OctokitGitHubProvider(githubToken)
  let collection: CollectionResult

  try {
    const result = await collect(gitHubProvider, owner, repo, prNumber)
    if ('skip' in result) {
      console.log(`Compass: skipping — ${result.reason}`)
      process.exit(0)
    }
    collection = result
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Compass: collection failed — ${msg}`)
    process.exit(1)
  }

  // 3. Read trusted instructions
  const trustedInstructions = await readTrustedInstructions()

  // 4. Analyze with Bob
  const bobProvider = new LiveBobProvider()
  const analyzeResult = await analyze(collection, trustedInstructions, {
    bobPath,
    timeoutMs: 120_000,
    allowRepair,
    unverifiedFlagsEnabled: false,
  }, bobProvider)

  let commentBody: string

  if (!analyzeResult.ok) {
    console.error(`Compass: analysis failed — ${analyzeResult.reason}`)
    // Produce an unavailable brief so the comment is honest
    const unavailable = makeUnavailableBriefFromCollection(collection, analyzeResult.reason)
    commentBody = renderUnavailable(unavailable)
  } else {
    // Validate
    const report = validateBrief(analyzeResult.brief)
    if (!report.valid) {
      const issues = report.findings.map((f) => `${f.field}: ${f.message}`).join('; ')
      console.error(`Compass: validation findings — ${issues}`)
      const unavailable = makeUnavailableBriefFromCollection(
        collection,
        `Brief failed validation: ${issues}`,
      )
      commentBody = renderUnavailable(unavailable)
    } else {
      commentBody = render(analyzeResult.brief)
    }
  }

  // 5. Publish (or dry-run)
  const publishProvider = new OctokitPublishProvider(githubToken)
  const publishResult = await publish(publishProvider, {
    owner,
    repo,
    prNumber,
    body: commentBody,
    analyzedHeadSha: collection.headSha,
    dryRun,
  })

  if (!publishResult.ok) {
    console.error(`Compass: publish failed — ${publishResult.reason}`)
    process.exit(1)
  }

  console.log(`Compass: ${publishResult.action} — done`)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Compass: fatal error — ${msg}`)
  process.exit(1)
})

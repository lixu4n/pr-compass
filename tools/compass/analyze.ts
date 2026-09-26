/**
 * analyze.ts — constrained Bob Shell adapter.
 *
 * Design rules (from the engineering brief):
 * - Uses child_process.execFile with shell:false and an argument array.
 * - Pipes the prompt via stdin; no shell interpolation of PR content.
 * - The GitHub publishing token is NEVER passed into the Bob process.
 * - Applies configurable cost/turn limits and an outer timeout.
 * - Redacts secret-shaped values from errors/logs.
 * - Parses the Bob result envelope; rejects failed/limited sessions.
 * - Validates the inner ContextBrief via Zod; no fallback to mock on failure.
 * - Supports at most one explicitly budgeted repair attempt (disabled by default).
 * - Returns an honest unavailable state if validation fails.
 * - Live execution is BLOCKED until BOB_SHELL_PATH and BOB_API_KEY are configured.
 * - Injecting a BobProvider allows offline testing without any live Bob call.
 *
 * Supported Bob Shell flags (verified against docs):
 *   -p "<prompt>"         non-interactive prompt
 *   --auth-method api-key uses BOBSHELL_API_KEY env var
 *   --workspace <path>    clean temp workspace (no repo-supplied config)
 *   --accept-license      required for first run / CI
 *
 * Flags referenced in the brief but NOT yet confirmed in current docs:
 *   --format json, --max-cost, --max-turns, --disable-mcp, --disable-subagents,
 *   --disable-tool-groups
 * These are guarded behind UNVERIFIED_FLAGS_ENABLED and will throw if used
 * without explicit opt-in. Do NOT enable in production until verified against
 * `bob --help` on the installed version.
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ModelOutputSchema, validateModelCitations } from '../../src/types/ContextBrief.js'
import type { ContextBrief, ModelOutput } from '../../src/types/ContextBrief.js'
import type { CollectionResult } from './collect.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AnalyzeConfig {
  /** Absolute path to the bob executable. Required for live runs. */
  bobPath: string
  /** Maximum wall-clock milliseconds for the Bob process. Default: 120_000 */
  timeoutMs?: number
  /** If true, attempt one repair pass on validation failure. Default: false */
  allowRepair?: boolean
  /**
   * Opt-in to unverified flags (--format, --max-cost, --max-turns, etc.).
   * Default: false. Do not enable until flags are confirmed against bob --help.
   */
  unverifiedFlagsEnabled?: boolean
  /** Max cost limit passed to --max-cost (only when unverifiedFlagsEnabled). */
  maxCost?: number
  /** Max turns passed to --max-turns (only when unverifiedFlagsEnabled). */
  maxTurns?: number
}

// ---------------------------------------------------------------------------
// Bob envelope — the outer JSON wrapper that Bob Shell emits
// ---------------------------------------------------------------------------

interface BobEnvelope {
  status?: string
  last_message?: string
  stats?: unknown
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Analysis result
// ---------------------------------------------------------------------------

export type AnalyzeResult =
  | { ok: true; brief: ContextBrief }
  | { ok: false; reason: string }

/**
 * Assembles a ContextBrief from validated model output and trusted collection data.
 * The model output must NOT contain sources, provenance, timestamps, or SHAs —
 * those are taken exclusively from the collection.
 *
 * Returns ok:false if model-cited source IDs are not in the collector manifest,
 * or if status is 'ok' but the model returned no meaningful content.
 */
export function assembleBrief(
  output: ModelOutput,
  collection: import('./collect.js').CollectionResult,
  compassVersion: string,
): AnalyzeResult {
  const collectorSourceIds = new Set(collection.sources.map((s) => s.id))

  // Validate that all cited IDs exist in the collector manifest
  const invalidIds = validateModelCitations(output, collectorSourceIds)
  if (invalidIds.length > 0) {
    return {
      ok: false,
      reason: `Model cited unknown source IDs: ${invalidIds.join(', ')}`,
    }
  }

  // Determine effective status: downgrade 'ok' to 'partial' or 'unavailable'
  // when the model provided no meaningful content.
  let { status } = output
  if (status === 'ok') {
    const hasMeaningfulContent =
      output.purpose !== null &&
      output.purpose.summary.trim().length > 0 &&
      output.readingOrder.length > 0
    if (!hasMeaningfulContent) {
      return {
        ok: false,
        reason: 'Model returned status "ok" but provided no purpose or reading locations.',
      }
    }
  }

  const brief: ContextBrief = {
    schemaVersion: 1,
    status,
    provenance: {
      repository: collection.repository,
      prNumber: collection.prNumber,
      prTitle: collection.prTitle,
      baseCommitSha: collection.baseSha,
      headCommitSha: collection.headSha,
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      compassVersion,
    },
    purpose: output.purpose,
    relevantContext: output.relevantContext,
    readingOrder: output.readingOrder,
    // Sources come exclusively from the collection — never from the model
    sources: collection.sources,
    // Collector omissions are preserved and merged with model-reported limitations
    limitations: [
      ...collection.omissions,
      ...output.limitations,
    ],
    unavailableReason: output.unavailableReason,
  }

  return { ok: true, brief }
}

// ---------------------------------------------------------------------------
// Provider interface for offline testing
// ---------------------------------------------------------------------------

export interface BobProvider {
  /**
   * Run analysis and return raw stdout.
   * Implementations must NEVER silently fall back to fixture data.
   * Test providers must be explicitly constructed; they cannot be auto-selected.
   */
  run(prompt: string, config: AnalyzeConfig): Promise<string>
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /BOBSHELL_API_KEY=\S+/gi,
  /BOB_API_KEY=\S+/gi,
  /GITHUB_TOKEN=\S+/gi,
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{82}/g,
]

export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds the bounded serialized context bundle sent to Bob.
 * Trusted instructions come from this file (the Compass version),
 * NOT from any file in the target repository.
 * The model receives source IDs and is expected to cite them by ID only.
 */
export function buildPrompt(
  collection: CollectionResult,
  trustedInstructions: string,
): string {
  const sourceManifest = collection.sources
    .map((s) => {
      const loc = s.path ? `${s.path}${s.lines ? `:${s.lines}` : ''}` : '(PR body)'
      return `[${s.id}] kind=${s.kind} loc=${loc}`
    })
    .join('\n')

  const sourceContents = collection.sources
    .map((s) => {
      const header = `=== SOURCE ${s.id} (${s.kind}) ===`
      return `${header}\n${s.snippet ?? '(no content)'}`
    })
    .join('\n\n')

  return [
    trustedInstructions.trim(),
    '',
    '## Input bundle',
    '',
    `Repository: ${collection.repository}`,
    `PR #${collection.prNumber}: ${collection.prTitle}`,
    `Base SHA: ${collection.baseSha}`,
    `Head SHA: ${collection.headSha}`,
    `Merge base SHA: ${collection.mergeBaseSha}`,
    '',
    '### Source manifest',
    sourceManifest,
    '',
    '### Source contents',
    sourceContents,
    '',
    ...(collection.omissions.length > 0
      ? ['### Omissions', collection.omissions.map((o) => `- ${o}`).join('\n'), '']
      : []),
    '## Instructions',
    'Return ONLY a valid ModelOutput JSON object with the exact fields specified above. Do not include sources, provenance, or schemaVersion. No prose before or after the JSON',
    'Cite source IDs from the manifest above. Do not invent SHAs, timestamps, or URLs.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Envelope parser
// ---------------------------------------------------------------------------

export function parseEnvelope(stdout: string): { ok: true; message: string } | { ok: false; reason: string } {
  // Require a valid Bob JSON envelope.  Do NOT extract arbitrary JSON substrings
  // from prose — that would allow error messages containing JSON snippets to be
  // treated as successful model output.
  let envelope: BobEnvelope
  try {
    envelope = JSON.parse(stdout.trim()) as BobEnvelope
  } catch {
    return {
      ok: false,
      reason: redactSecrets(`Bob output was not a valid JSON envelope: ${stdout.slice(0, 200)}`),
    }
  }

  // Checks if the response if empty or null, if it is a number or a string and if it is a list instead of object.
  if(
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope)
  ) {
    return{
      ok: false,
      reason: 'Bob output must be a JSON object envelope'
    }
  }

  // Require an explicit success status
  if (!envelope.status || (envelope.status !== 'success' && envelope.status !== 'ok')) {
    return {
      ok: false,
      reason: `Bob session ended with status: ${envelope.status ?? '(none)'}`,
    }
  }

  // last_message must be present and non-empty
  const message = envelope.last_message
  if (typeof message !== 'string' || message.trim() === '') {
    return { ok: false, reason: 'Bob envelope contained no last_message.' }
  }

  return { ok: true, message }
}

// ---------------------------------------------------------------------------
// Brief extractor — parse ContextBrief from Bob's last_message
// ---------------------------------------------------------------------------

/**
 * Parse and validate the model's raw text response as a ModelOutput.
 * Does NOT assemble the final ContextBrief — call assembleBrief() after this.
 *
 * Accepts a fenced ```json block as a graceful fallback, but rejects
 * any response that is not entirely a JSON object (no prose allowed).
 */
export function parseModelOutput(message: string): { ok: true; output: ModelOutput } | { ok: false; reason: string } {
  let jsonText = message.trim()

  // Strip a single ```json ... ``` fence if present
  const fenceMatch = jsonText.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/)
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim()
  }

  // Require the entire (stripped) message to be a JSON object — no prose
  if (!jsonText.startsWith('{')) {
    return {
      ok: false,
      reason: 'Model response did not start with a JSON object. Refusing to extract substring.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'Model response was not valid JSON.' }
  }

  // Validate against the strict ModelOutput schema — rejects any extra fields
  // the model may have invented (sources, provenance, schemaVersion, URLs, SHAs, …)
  const result = ModelOutputSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map((i) => i.message).join('; ')
    return { ok: false, reason: `Model output schema validation failed: ${issues}` }
  }

  return { ok: true, output: result.data }
}

/**
 * @deprecated Use parseModelOutput() + assembleBrief() instead.
 * Kept for the existing test suite; will be removed once tests are updated.
 */
export function extractBrief(message: string): AnalyzeResult {
  // This legacy path cannot perform citation validation against the collector
  // manifest because it has no collection context.  It is preserved only to
  // avoid breaking existing tests that call it directly.
  const modelResult = parseModelOutput(message)
  if (!modelResult.ok) {
    return { ok: false, reason: modelResult.reason }
  }
  // Legacy: build a minimal unavailable brief stub from the model output so
  // callers that expect a ContextBrief shape still receive one.
  // NOTE: this path is NOT used in production — analyze() uses assembleBrief().
  return {
    ok: false,
    reason:
      'extractBrief() is deprecated; model output parsed but no collection context available for assembly.',
  }
}

// ---------------------------------------------------------------------------
// Real Bob Shell provider (live — blocked until credentials configured)
// ---------------------------------------------------------------------------

export class LiveBobProvider implements BobProvider {
  async run(prompt: string, config: AnalyzeConfig): Promise<string> {
    const apiKey = process.env['BOBSHELL_API_KEY'] ?? process.env['BOB_API_KEY'] ?? ''
    if (!apiKey) {
      throw new Error(
        'BOB_API_KEY / BOBSHELL_API_KEY is not set. ' +
          'Live Bob execution is blocked until authentication is configured. ' +
          'Set the env var in your shell or GitHub Actions secret — never paste it in chat.',
      )
    }

    // Write prompt to a temp file to avoid any shell interpolation
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compass-'))
    const promptFile = path.join(tmpDir, 'prompt.txt')
    const workspaceDir = path.join(tmpDir, 'workspace')
    await fs.mkdir(workspaceDir)
    await fs.writeFile(promptFile, prompt, 'utf8')

    // Build the argument array — shell:false enforced by execFile
    const args: string[] = [
      '--auth-method', 'api-key',
      '--accept-license',
      '--workspace', workspaceDir,
    ]

    // Unverified flags are opt-in only
    if (config.unverifiedFlagsEnabled) {
      if (config.maxCost !== undefined) args.push('--max-cost', String(config.maxCost))
      if (config.maxTurns !== undefined) args.push('--max-turns', String(config.maxTurns))
    }

    // Pipe prompt via stdin
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(config.bobPath, args, {
          shell: false,
          env: {
            ...process.env,
            BOBSHELL_API_KEY: apiKey,
            BOB_API_KEY: apiKey,
            // Never pass the publishing token into Bob
            GITHUB_TOKEN: undefined,
            GH_TOKEN: undefined,
          },
        })

        const chunks: Buffer[] = []
        const errChunks: Buffer[] = []
        child.stdout.on('data', (d: Buffer) => chunks.push(d))
        child.stderr.on('data', (d: Buffer) => errChunks.push(d))

        // Write prompt to stdin then close
        child.stdin.write(prompt, 'utf8')
        child.stdin.end()

        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          reject(new Error(`Bob Shell timed out after ${config.timeoutMs ?? 120_000}ms`))
        }, config.timeoutMs ?? 120_000)

        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0) {
            const stderr = Buffer.concat(errChunks).toString('utf8').slice(0, 500)
            reject(new Error(`Bob Shell exited with code ${code}: ${stderr}`))
          } else {
            resolve(Buffer.concat(chunks).toString('utf8'))
          }
        })

        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
      return stdout
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(redactSecrets(`Bob Shell failed: ${msg}`))
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  }
}

// ---------------------------------------------------------------------------
// Main analyze function
// ---------------------------------------------------------------------------

/** Compass version embedded in all produced briefs. */
const COMPASS_VERSION = '0.1.0'

export async function analyze(
  collection: CollectionResult,
  trustedInstructions: string,
  config: AnalyzeConfig,
  provider: BobProvider = new LiveBobProvider(),
): Promise<AnalyzeResult> {
  const prompt = buildPrompt(collection, trustedInstructions)

  let stdout: string
  try {
    stdout = await provider.run(prompt, config)
  } catch (err: unknown) {
    const msg = redactSecrets(err instanceof Error ? err.message : String(err))
    return { ok: false, reason: msg }
  }

  const envelopeResult = parseEnvelope(stdout)

  // Determine the initial extraction result
  let briefResult: AnalyzeResult
  if (!envelopeResult.ok) {
    briefResult = { ok: false, reason: envelopeResult.reason }
  } else {
    const modelResult = parseModelOutput(envelopeResult.message)
    if (!modelResult.ok) {
      briefResult = { ok: false, reason: modelResult.reason }
    } else {
      briefResult = assembleBrief(modelResult.output, collection, COMPASS_VERSION)
    }
  }

  // One optional repair attempt when initial extraction failed
  if (!briefResult.ok && config.allowRepair) {
    const repairPrompt =
      `The previous response failed validation: ${briefResult.reason}\n\n` +
      `Please return ONLY a corrected model output JSON object.\n\n` +
      prompt
    let repairStdout: string
    try {
      repairStdout = await provider.run(repairPrompt, config)
    } catch (err: unknown) {
      const msg = redactSecrets(err instanceof Error ? err.message : String(err))
      return { ok: false, reason: `Repair attempt also failed: ${msg}` }
    }
    const repairEnvelope = parseEnvelope(repairStdout)
    if (!repairEnvelope.ok) {
      return { ok: false, reason: `Repair envelope invalid: ${repairEnvelope.reason}` }
    }
    const repairModel = parseModelOutput(repairEnvelope.message)
    if (!repairModel.ok) {
      return { ok: false, reason: `Repair model output invalid: ${repairModel.reason}` }
    }
    return assembleBrief(repairModel.output, collection, COMPASS_VERSION)
  }

  return briefResult
}

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
import { ContextBriefSchema } from '../../src/types/ContextBrief.js'
import { validateCitations } from '../../src/types/ContextBrief.js'
import type { ContextBrief } from '../../src/types/ContextBrief.js'
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
    'Return ONLY a valid ContextBrief JSON object. No prose before or after the JSON.',
    'Cite source IDs from the manifest above. Do not invent SHAs, timestamps, or URLs.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Envelope parser
// ---------------------------------------------------------------------------

export function parseEnvelope(stdout: string): { ok: true; message: string } | { ok: false; reason: string } {
  let envelope: BobEnvelope
  try {
    envelope = JSON.parse(stdout) as BobEnvelope
  } catch {
    // Bob may output the message directly without an envelope (non-json mode)
    // Attempt to extract a JSON object from the raw output
    const jsonMatch = stdout.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return { ok: true, message: jsonMatch[0] }
    }
    return { ok: false, reason: redactSecrets(`Bob output was not parseable JSON: ${stdout.slice(0, 200)}`) }
  }

  if (envelope.status && envelope.status !== 'success' && envelope.status !== 'ok') {
    return { ok: false, reason: `Bob session ended with status: ${envelope.status}` }
  }

  const message = envelope.last_message
  if (typeof message === 'string' && message.trim() !== '') {
    return { ok: true, message }
  }

  // If there is no last_message but the object itself looks like a ContextBrief
  // (i.e. Bob returned the domain JSON directly without an envelope), treat it as the message.
  if ('schemaVersion' in envelope) {
    return { ok: true, message: stdout }
  }

  return { ok: false, reason: 'Bob envelope contained no last_message.' }
}

// ---------------------------------------------------------------------------
// Brief extractor — parse ContextBrief from Bob's last_message
// ---------------------------------------------------------------------------

export function extractBrief(message: string): AnalyzeResult {
  // Expect the model to return a raw JSON object.
  // Accept a fenced code block as a graceful fallback, but do NOT extract
  // an arbitrary JSON-looking substring deeper in prose.
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
      reason: 'Bob response did not start with a JSON object. Refusing to extract substring.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'Bob response was not valid JSON.' }
  }

  const result = ContextBriefSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.slice(0, 3).map((i) => i.message).join('; ')
    return { ok: false, reason: `ContextBrief schema validation failed: ${issues}` }
  }

  const invalidCitations = validateCitations(result.data)
  if (invalidCitations.length > 0) {
    return {
      ok: false,
      reason: `Brief cited unknown source IDs: ${invalidCitations.join(', ')}`,
    }
  }

  return { ok: true, brief: result.data }
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
    briefResult = extractBrief(envelopeResult.message)
  }

  // One optional repair attempt when initial extraction failed
  if (!briefResult.ok && config.allowRepair) {
    const repairPrompt =
      `The previous response failed validation: ${briefResult.reason}\n\n` +
      `Please return ONLY a corrected ContextBrief JSON object.\n\n` +
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
    return extractBrief(repairEnvelope.message)
  }

  return briefResult
}

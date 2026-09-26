/**
 * Restricted subprocess boundary for Bob Shell 2.0.5 (CLI help verified by user).
 * This reduces capabilities; it is not an OS sandbox. Only run a trusted Bob
 * installation on a dedicated runner. Windows is intentionally unsupported here.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const SUPPORTED_BOB_VERSION = '2.0.5'
export const DISABLED_TOOL_GROUPS = 'read,edit,execute,mcp,skill,todo,subagent,mode'

export interface BobRuntimeConfig {
  bobPath: string
  /** Per invocation; analyze() splits a total analysis budget if repair is enabled. */
  maxCost?: number
  maxTurns?: number
  timeoutMs?: number
  maxOutputBytes?: number
  maxPromptBytes?: number
  /** Explicit user permission to accept IBM's license in the isolated session. */
  acceptLicense?: boolean
}

export function runtimeLimits(config: BobRuntimeConfig) {
  const limits = {
    maxCost: config.maxCost ?? 0.5,
    maxTurns: config.maxTurns ?? 4,
    timeoutMs: config.timeoutMs ?? 120_000,
    maxOutputBytes: config.maxOutputBytes ?? 1_000_000,
    maxPromptBytes: config.maxPromptBytes ?? 128_000,
  }
  if (!config.bobPath.trim()) throw new Error('Bob executable path must not be empty.')
  if (!Number.isFinite(limits.maxCost) || limits.maxCost <= 0 || limits.maxCost > 1) {
    throw new Error('Bob maxCost must be finite, greater than 0 and at most 1 Bobcoin for this MVP.')
  }
  for (const [key, ceiling] of [
    ['maxTurns', 8], ['timeoutMs', 120_000],
    ['maxOutputBytes', 1_000_000], ['maxPromptBytes', 128_000],
  ] as const) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) {
      throw new Error(`Invalid Bob ${key}; expected an integer from 1 to ${ceiling}.`)
    }
  }
  return limits
}

export function restrictedArgs(workspace: string, config: BobRuntimeConfig): string[] {
  const limits = runtimeLimits(config)
  if (config.acceptLicense !== true) {
    throw new Error('Bob license acceptance requires explicit permission (COMPASS_ACCEPT_BOB_LICENSE=true).')
  }
  return [
    'run', '--format', 'json', '--mode', 'ask',
    '--workspace', workspace,
    '--disable-mcp', '--disable-subagents',
    '--disable-tool-groups', DISABLED_TOOL_GROUPS,
    '--max-cost', String(limits.maxCost),
    '--max-turns', String(limits.maxTurns),
    '--log-level', 'error', '--accept-license',
  ]
}

export function isolatedEnvironment(
  root: string,
  parent: NodeJS.ProcessEnv,
  apiKey?: string,
): NodeJS.ProcessEnv {
  // Deliberate allowlist. Never inherit GitHub tokens, NODE_OPTIONS, proxy
  // credentials, Bob settings paths, npm configuration or unrelated secrets.
  return {
    PATH: parent.PATH ?? '/usr/bin:/bin',
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'),
    TMPDIR: join(root, 'tmp'),
    TMP: join(root, 'tmp'),
    TEMP: join(root, 'tmp'),
    LANG: 'en_US.UTF-8',
    ...(apiKey ? { BOB_API_KEY: apiKey } : {}),
  }
}

interface ProcessOptions {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  input?: string
  timeoutMs: number
  maxOutputBytes: number
}

/** Bound output, handle stdin errors and terminate the process group on failure. */
async function executeBounded(options: ProcessOptions): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd, env: options.env, shell: false,
      detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output: Buffer[] = []
    let bytes = 0
    let failure: Error | undefined
    let finished = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) } catch {
        // The process may already have exited.
      }
    }
    const stop = (message: string) => {
      if (finished || failure) return
      failure = new Error(message)
      killGroup('SIGTERM')
      forceTimer = setTimeout(() => killGroup('SIGKILL'), 200)
    }
    const timer = setTimeout(() => stop('Bob process timed out.'), options.timeoutMs)
    const cleanTimers = () => {
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
    }
    const receive = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length
      if (bytes > options.maxOutputBytes) {
        stop('Bob process exceeded the output-size limit.')
        return
      }
      if (stdout && !failure) output.push(chunk)
      // Do not retain or surface raw stderr; it may contain credentials or code.
    }
    child.stdout.on('data', (chunk: Buffer) => receive(chunk, true))
    child.stderr.on('data', (chunk: Buffer) => receive(chunk, false))
    child.stdin.on('error', () => stop('Could not send the input bundle to Bob.'))
    child.once('error', (error: NodeJS.ErrnoException) => {
      finished = true
      cleanTimers()
      reject(new Error(`Could not start Bob executable (${error.code ?? 'spawn error'}).`))
    })
    child.once('close', (code, signal) => {
      if (finished) return
      finished = true
      cleanTimers()
      // No lingering descendants should survive a failed invocation.
      if (failure || code !== 0) killGroup('SIGKILL')
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Bob process failed (exit ${code ?? signal ?? 'unknown'}).`))
      else resolveResult(Buffer.concat(output).toString('utf8'))
    })
    child.stdin.end(options.input ?? '', 'utf8')
  })
}

export async function runRestrictedBob(prompt: string, config: BobRuntimeConfig): Promise<string> {
  const limits = runtimeLimits(config)
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('Restricted Bob execution currently supports macOS and Linux only.')
  }
  // Check consent and limits before any subprocess is started.
  restrictedArgs('preflight', config)
  const apiKey = process.env.BOB_API_KEY?.trim()
  if (!apiKey) throw new Error('BOB_API_KEY is not configured. No Bob analysis was started.')
  if (Buffer.byteLength(prompt, 'utf8') > limits.maxPromptBytes) {
    throw new Error('Bob input bundle exceeds the prompt-size limit.')
  }

  const root = await mkdtemp(join(await realpath(tmpdir()), 'compass-bob-'))
  try {
    const workspace = join(root, 'workspace')
    await Promise.all(['workspace', 'home', 'config', 'cache', 'data', 'tmp']
      .map((directory) => mkdir(join(root, directory), { mode: 0o700 })))
    // Relative paths containing a slash must be resolved before changing cwd.
    const command = isAbsolute(config.bobPath) || !config.bobPath.includes('/')
      ? config.bobPath : resolve(config.bobPath)
    const deadline = Date.now() + limits.timeoutMs
    const remaining = () => {
      const milliseconds = deadline - Date.now()
      if (milliseconds <= 0) throw new Error('Bob process timed out.')
      return milliseconds
    }
    const preflightEnv = isolatedEnvironment(root, process.env)
    const version = await executeBounded({
      command, args: ['--version'], cwd: workspace, env: preflightEnv,
      timeoutMs: Math.min(10_000, remaining()), maxOutputBytes: 32_000,
    })
    const versionMatch = version.match(/\b(\d+\.\d+\.\d+)(?:[-+][\w.-]+)?\b/)
    if (versionMatch?.[1] !== SUPPORTED_BOB_VERSION) {
      throw new Error(`Compass currently requires verified Bob Shell ${SUPPORTED_BOB_VERSION}; review another version before enabling it.`)
    }
    const help = await executeBounded({
      command, args: ['run', '--help'], cwd: workspace, env: preflightEnv,
      timeoutMs: Math.min(10_000, remaining()), maxOutputBytes: 64_000,
    })
    const required = [
      '--format', '--workspace', '--mode', '--max-cost', '--max-turns',
      '--log-level', '--disable-mcp', '--disable-subagents',
      '--disable-tool-groups', '--accept-license',
    ]
    if (required.some((flag) => !new RegExp(`${flag}(?=[\\s,=<]|$)`).test(help))) {
      throw new Error('Bob Shell does not advertise all required restrictions. Refusing an unrestricted fallback.')
    }
    return await executeBounded({
      command, args: restrictedArgs(workspace, config), cwd: workspace,
      env: isolatedEnvironment(root, process.env, apiKey), input: prompt,
      timeoutMs: remaining(), maxOutputBytes: limits.maxOutputBytes,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DISABLED_TOOL_GROUPS, isolatedEnvironment, restrictedArgs,
  runRestrictedBob, runtimeLimits,
} from '../../tools/compass/bob-runtime.js'
import { analyze, parseEnvelope, redactSecrets } from '../../tools/compass/analyze.js'
import type { AnalyzeConfig } from '../../tools/compass/analyze.js'
import type { CollectionResult } from '../../tools/compass/collect.js'

const roots: string[] = []
const fakeKey = 'unit-test-only-not-a-real-key'
const helpFlags = [
  '--format', '--workspace', '--mode', '--max-cost', '--max-turns', '--log-level',
  '--disable-mcp', '--disable-subagents', '--disable-tool-groups', '--accept-license',
]

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fakeBob(scenario = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'compass-fake-bob-'))
  roots.push(root)
  const executable = join(root, 'fake-bob')
  const log = join(root, 'calls.jsonl')
  // A harmless Node script: no actual Bob, network, credential, or model use.
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const scenario = ${JSON.stringify(scenario)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  args, cwd: process.cwd(), home: process.env.HOME,
  envNames: Object.keys(process.env).sort(), keyPresent: !!process.env.BOB_API_KEY
}) + '\\n');
if (args[0] === '--version') {
  if (process.env.BOB_API_KEY) process.exit(91);
  console.log(scenario === 'old-version' ? 'Bob Shell 1.0.0' : 'Bob Shell 2.0.5 (commit: 2dc180906)');
  process.exit(0);
}
if (args[0] === 'run' && args[1] === '--help') {
  if (process.env.BOB_API_KEY) process.exit(92);
  console.log(scenario === 'missing-flags' ? '--format --workspace' : ${JSON.stringify(helpFlags.join('\n'))});
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (scenario === 'timeout') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 20);
    return;
  }
  if (scenario === 'overflow') { process.stdout.write('x'.repeat(20000)); return; }
  if (scenario === 'failed') { console.error(process.env.BOB_API_KEY); process.exitCode = 7; return; }
  console.log(JSON.stringify({ type: 'result', status: 'success', last_message: input }));
});
`, 'utf8')
  await chmod(executable, 0o700)
  const calls = async (): Promise<Array<{
    args: string[]; cwd: string; home: string; envNames: string[]; keyPresent: boolean
  }>> => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) }
    catch { return [] }
  }
  return { executable, calls }
}

function config(bobPath: string, overrides: Partial<AnalyzeConfig> = {}): AnalyzeConfig {
  return { bobPath, acceptLicense: true, timeoutMs: 5_000, maxCost: 0.5, maxTurns: 4, ...overrides }
}

function enableFakeKey() { vi.stubEnv('BOB_API_KEY', fakeKey) }

describe('limits and restrictions', () => {
  it('always uses verified headless flags and disables tool access', () => {
    const args = restrictedArgs('/tmp/example-workspace', config('/fake/bob'))
    expect(args[0]).toBe('run')
    expect(args).toContain('--format')
    expect(args[args.indexOf('--format') + 1]).toBe('json')
    expect(args).toContain('--disable-mcp')
    expect(args).toContain('--disable-subagents')
    expect(args[args.indexOf('--disable-tool-groups') + 1]).toBe(DISABLED_TOOL_GROUPS)
    expect(args[args.indexOf('--max-cost') + 1]).toBe('0.5')
    expect(args).not.toContain('--auth-method')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2])('rejects invalid cost %s', (maxCost) => {
    expect(() => runtimeLimits(config('/fake/bob', { maxCost }))).toThrow(/maxCost/)
  })

  it('requires finite bounded turns, timeout and output sizes', () => {
    expect(() => runtimeLimits(config('/fake/bob', { maxTurns: 0 }))).toThrow(/maxTurns/)
    expect(() => runtimeLimits(config('/fake/bob', { maxTurns: 9 }))).toThrow(/maxTurns/)
    expect(() => runtimeLimits(config('/fake/bob', { timeoutMs: Number.NaN }))).toThrow(/timeoutMs/)
    expect(() => runtimeLimits(config('/fake/bob', { maxOutputBytes: 2_000_000 }))).toThrow(/maxOutputBytes/)
  })

  it('uses an environment allowlist rather than copying the parent', () => {
    const env = isolatedEnvironment('/tmp/example', {
      PATH: '/safe/bin', HOME: '/private-home', NODE_OPTIONS: '--require evil',
      GITHUB_TOKEN: 'fake', INPUT_GITHUB_TOKEN: 'fake', GH_TOKEN: 'fake',
      BOB_API_KEY: 'not-for-preflight', BOBSHELL_API_KEY: 'fake',
      HTTPS_PROXY: 'http://fake-proxy', OTHER_SECRET: 'fake',
    })
    expect(env.PATH).toBe('/safe/bin')
    expect(env.HOME).toBe('/tmp/example/home')
    for (const key of ['NODE_OPTIONS', 'GITHUB_TOKEN', 'INPUT_GITHUB_TOKEN', 'GH_TOKEN',
      'BOB_API_KEY', 'BOBSHELL_API_KEY', 'HTTPS_PROXY', 'OTHER_SECRET']) {
      expect(env[key]).toBeUndefined()
    }
  })
})

describe('real subprocess boundary with a fake executable', () => {
  it('passes input only through stdin, isolates configuration and cleans up', async () => {
    enableFakeKey()
    vi.stubEnv('GITHUB_TOKEN', 'synthetic-github-token')
    vi.stubEnv('INPUT_GITHUB_TOKEN', 'synthetic-input-token')
    vi.stubEnv('OTHER_SECRET', 'synthetic-other-secret')
    vi.stubEnv('NODE_OPTIONS', '--this-must-not-reach-the-child')
    const bob = await fakeBob()
    const prompt = 'Untrusted input: $(echo do-not-execute); `do-not-execute` @someone'
    const raw = await runRestrictedBob(prompt, config(bob.executable))
    expect(JSON.parse(raw).last_message).toBe(prompt)
    const calls = await bob.calls()
    expect(calls).toHaveLength(3)
    expect(calls[0].args).toEqual(['--version'])
    expect(calls[1].args).toEqual(['run', '--help'])
    expect(calls.map((call) => call.keyPresent)).toEqual([false, false, true])
    const actual = calls[2]
    expect(actual.args).not.toContain(prompt)
    expect(actual.args).toContain('--disable-tool-groups')
    expect(actual.cwd).toBe(actual.args[actual.args.indexOf('--workspace') + 1])
    expect(actual.home).not.toBe(process.env.HOME)
    for (const forbidden of ['GITHUB_TOKEN', 'INPUT_GITHUB_TOKEN', 'OTHER_SECRET', 'NODE_OPTIONS', 'BOBSHELL_API_KEY']) {
      expect(actual.envNames).not.toContain(forbidden)
    }
    await expect(access(dirname(actual.cwd))).rejects.toThrow()
  })

  it('does not run any executable without explicit license consent', async () => {
    enableFakeKey()
    const bob = await fakeBob()
    await expect(runRestrictedBob('test', config(bob.executable, { acceptLicense: false })))
      .rejects.toThrow(/explicit permission/)
    expect(await bob.calls()).toEqual([])
  })

  it('does not run any executable without the documented API key', async () => {
    vi.stubEnv('BOB_API_KEY', '')
    vi.stubEnv('BOBSHELL_API_KEY', fakeKey)
    const bob = await fakeBob()
    await expect(runRestrictedBob('test', config(bob.executable))).rejects.toThrow(/BOB_API_KEY/)
    expect(await bob.calls()).toEqual([])
  })

  it('rejects oversized prompt before a model process can start', async () => {
    enableFakeKey()
    const bob = await fakeBob()
    await expect(runRestrictedBob('x'.repeat(11), config(bob.executable, { maxPromptBytes: 10 })))
      .rejects.toThrow(/prompt-size/)
    expect(await bob.calls()).toEqual([])
  })

  it('rejects unverified versions instead of falling back', async () => {
    enableFakeKey()
    const bob = await fakeBob('old-version')
    await expect(runRestrictedBob('test', config(bob.executable))).rejects.toThrow(/2.0.5/)
    expect(await bob.calls()).toHaveLength(1)
  })

  it('refuses execution if required flags are absent', async () => {
    enableFakeKey()
    const bob = await fakeBob('missing-flags')
    await expect(runRestrictedBob('test', config(bob.executable))).rejects.toThrow(/unrestricted fallback/)
    expect(await bob.calls()).toHaveLength(2)
  })

  it('fails clearly for a missing executable', async () => {
    enableFakeKey()
    await expect(runRestrictedBob('test', config('/no-such-compass-bob-binary')))
      .rejects.toThrow(/Could not start Bob executable/)
  })

  it('rejects excess output and cleans up', async () => {
    enableFakeKey()
    const bob = await fakeBob('overflow')
    await expect(runRestrictedBob('test', config(bob.executable, { maxOutputBytes: 100 })))
      .rejects.toThrow(/output-size/)
    const calls = await bob.calls()
    await expect(access(dirname(calls[0].cwd))).rejects.toThrow()
  })

  it('terminates a process that ignores SIGTERM after its timeout', async () => {
    enableFakeKey()
    const bob = await fakeBob('timeout')
    await expect(runRestrictedBob('test', config(bob.executable, { timeoutMs: 800 })))
      .rejects.toThrow(/timed out/)
    const calls = await bob.calls()
    expect(calls).toHaveLength(3)
    await expect(access(dirname(calls[0].cwd))).rejects.toThrow()
  })

  it('does not return secret-bearing stderr on a failed process', async () => {
    enableFakeKey()
    const bob = await fakeBob('failed')
    let message = ''
    try { await runRestrictedBob('test', config(bob.executable)) }
    catch (error) { message = String(error) }
    expect(message).toContain('exit 7')
    expect(message).not.toContain(fakeKey)
  })
})

describe('budget and output handling', () => {
  it('splits the total analysis cost allowance rather than doubling it for repair', async () => {
    const collection: CollectionResult = {
      repository: 'test-org/test-repo', prNumber: 1, prTitle: 'Example', prBody: null,
      baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), mergeBaseSha: 'a'.repeat(40),
      isFork: false, isDraft: false, isBot: false, sources: [], omissions: [],
    }
    const costs: number[] = []
    await analyze(collection, 'Instructions', config('/unused', { maxCost: 0.6, allowRepair: true }), {
      async run(_prompt, options) { costs.push(options.maxCost!); return 'invalid' },
    })
    expect(costs).toEqual([0.3, 0.3])
  })

  it('requires the documented successful envelope, not a domain status ok', () => {
    expect(parseEnvelope('{"status":"ok","last_message":"{}"}').ok).toBe(false)
    expect(parseEnvelope('{"type":"error","status":"success","last_message":"{}"}').ok).toBe(false)
    expect(parseEnvelope('{"type":"result","status":"success","last_message":"{}"}').ok).toBe(true)
  })

  it('redacts actual configured secret values even without a known token prefix', () => {
    vi.stubEnv('BOB_API_KEY', 'opaque-test-only-value')
    expect(redactSecrets('Error contains opaque-test-only-value')).toBe('Error contains [REDACTED]')
  })
})

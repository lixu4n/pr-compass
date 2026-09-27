import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Executed before the copied bundle. Any attempt to use network or spawn Bob
// is a failing test, not a real API call. No actual credentials are inherited.
const guard = `
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('FORBIDDEN: network or subprocess during offline package check'); };
globalThis.fetch = forbidden;
for (const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[name] = forbidden;
http.request = http.get = forbidden;
https.request = https.get = forbidden;
net.connect = net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden;
tls.connect = forbidden;
syncBuiltinESMExports();
`

async function withIsolatedPackage(run) {
  const directory = await mkdtemp(join(tmpdir(), 'compass-package-test-'))
  try {
    const packageDir = join(directory, 'package')
    await cp(new URL('../action-dist/', import.meta.url), packageDir, { recursive: true })
    const workingDir = join(directory, 'unrelated-working-directory')
    const home = join(directory, 'home')
    await mkdir(workingDir)
    await mkdir(home)
    const guardPath = join(directory, 'deny-side-effects.mjs')
    await writeFile(guardPath, guard, 'utf8')
    const invoke = (args) => spawnSync(process.execPath, [
      '--import', guardPath, join(packageDir, 'index.mjs'), ...args,
    ], {
      cwd: workingDir,
      env: { HOME: home, TMPDIR: directory },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 100_000,
    })
    await run({ packageDir, invoke })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('distribution loads dependencies and prompt with no source tree, credentials, network or Bob', async () => {
  await withIsolatedPackage(async ({ invoke }) => {
    const result = invoke(['--check-package'])
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Compass package check passed/)
    assert.match(result.stdout, /does not verify live integration/)
    assert.equal(result.stderr, '')
  })
})

test('missing packaged prompt fails clearly', async () => {
  await withIsolatedPackage(async ({ packageDir, invoke }) => {
    await rm(join(packageDir, 'prompts', 'context.md'))
    const result = invoke(['--check-package'])
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Packaged Compass prompt is missing or unreadable/)
    assert.doesNotMatch(result.stdout, /check passed/)
  })
})

test('empty packaged prompt fails clearly', async () => {
  await withIsolatedPackage(async ({ packageDir, invoke }) => {
    await writeFile(join(packageDir, 'prompts', 'context.md'), '  \n')
    const result = invoke(['--check-package'])
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Packaged Compass prompt is empty/)
  })
})

test('normal invocation without configuration fails before any network or Bob call', async () => {
  await withIsolatedPackage(async ({ invoke }) => {
    const result = invoke([])
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Required environment variable INPUT_OWNER is not set/)
    assert.doesNotMatch(result.stderr, /FORBIDDEN/)
  })
})

test('unknown arguments do not accidentally start a live run', async () => {
  await withIsolatedPackage(async ({ invoke }) => {
    const result = invoke(['--check-package', '--unexpected'])
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unknown arguments/)
    assert.doesNotMatch(result.stderr, /FORBIDDEN/)
  })
})

import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Store, acquireServiceLock } from './store.js'
import { Vault } from './security.js'
import { GitHubApp } from './github.js'
import { createHandler } from './http.js'
import { Worker, liveDependencies } from './worker.js'

process.umask(0o077)
const origin = new URL(process.env.COMPASS_PUBLIC_URL ?? 'http://127.0.0.1:3000').origin
if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  throw new Error('A deployed Compass service requires an HTTPS public URL.')
}
const required = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY_FILE', 'GITHUB_WEBHOOK_SECRET', 'COMPASS_ENCRYPTION_KEY'] as const
const ready = required.every(name => !!process.env[name])
if (!ready && process.env.NODE_ENV === 'production') throw new Error('Configure all GitHub App and encryption settings before production startup.')
let store: Store | undefined
let vault: Vault | undefined
let github: GitHubApp | undefined
let worker: Worker | undefined
let releaseLock: (() => void) | undefined
if (ready) {
  const directory = resolve(process.env.COMPASS_DATA_DIR ?? '.compass-data')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  releaseLock = acquireServiceLock(resolve(directory, 'service-lock.sqlite'))
  vault = new Vault(process.env.COMPASS_ENCRYPTION_KEY!)
  store = new Store(resolve(directory, 'compass.sqlite'))
  github = new GitHubApp({ appId: process.env.GITHUB_APP_ID!, slug: process.env.GITHUB_APP_SLUG!,
    clientId: process.env.GITHUB_APP_CLIENT_ID!, clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!, origin,
    privateKey: readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_FILE!, 'utf8') })
  if (!/^\d+$/.test(github.config.appId) || !/^[a-z0-9-]+$/.test(github.config.slug) || process.env.GITHUB_WEBHOOK_SECRET!.length < 32) {
    throw new Error('Invalid GitHub App identifiers or webhook secret (minimum 32 characters).')
  }
  const instructions = readFileSync(new URL('./prompts/context.md', import.meta.url), 'utf8')
  worker = new Worker(store, vault, liveDependencies(github, instructions, process.env.BOB_PATH ?? 'bob'))
}
const server = createServer(createHandler({ origin, store, vault, github, webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  staticRoot: resolve(process.env.COMPASS_STATIC_DIR ?? 'dist') }))
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Compass listening at ${origin}; GitHub App ${ready ? 'configured' : 'not configured (preview only)'}.`)
  worker?.start()
})
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  server.close()
  await worker?.stop()
  store?.close()
  releaseLock?.()
  process.exit(0)
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })

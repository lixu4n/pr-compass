import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
await build({ entryPoints: ['tools/server/index.ts'], outfile: 'server-dist/index.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', logLevel: 'info' })
await mkdir('server-dist/prompts', { recursive: true })
await copyFile('tools/compass/prompts/context.md', 'server-dist/prompts/context.md')

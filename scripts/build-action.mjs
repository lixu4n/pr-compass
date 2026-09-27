import { build } from 'esbuild'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = new URL('../action-dist/', import.meta.url)

// Build with a pinned direct dependency from package-lock.json. No target-PR
// files are executed, and no per-run npm installation is needed by consumers.
await mkdir(new URL('prompts/', output), { recursive: true })
const result = await build({
  absWorkingDir: root,
  entryPoints: ['tools/compass/index.ts'],
  outfile: 'action-dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'inline',
  sourcemap: false,
  metafile: true,
  logLevel: 'warning',
})

// The distribution must not require runtime node_modules. Built-in Node
// modules are the only permitted external imports.
const externalPackages = Object.values(result.metafile.outputs)
  .flatMap((entry) => entry.imports)
  .filter((entry) => entry.external && !isBuiltin(entry.path))
if (externalPackages.length > 0) {
  throw new Error(`Unbundled runtime dependencies: ${externalPackages.map((x) => x.path).join(', ')}`)
}

await copyFile(
  new URL('../tools/compass/prompts/context.md', import.meta.url),
  new URL('prompts/context.md', output),
)
// Remove only the known obsolete stub/package metadata, never arbitrary files.
await rm(new URL('index.js', output), { force: true })
await rm(new URL('package.json', output), { force: true })
console.log('Built action-dist/index.mjs and action-dist/prompts/context.md (Node 24 ESM).')

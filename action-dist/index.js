/**
 * action-dist/index.js — Compass Action entry point (CommonJS bundle stub).
 *
 * This file is a placeholder for the built bundle. Build it with:
 *   npm run build:action
 *
 * The build step compiles tools/compass/index.ts and all its imports
 * into a single self-contained CommonJS file using esbuild or tsc.
 *
 * Until the build step is run, this stub exits with a clear message
 * so the Action fails visibly rather than silently.
 *
 * IMPORTANT: Do not commit compiled output to source control.
 * The build must be run as part of the release process.
 * See docs/AUTOMATION.md for build and release instructions.
 */

console.error(
  'Compass action-dist/index.js has not been built.\n' +
  'Run: npm run build:action\n' +
  'See docs/AUTOMATION.md for instructions.'
)
process.exit(1)

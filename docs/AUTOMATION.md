# Compass Automation

## Current status

Compass prepares context for a human PR reviewer: **Purpose**, **Relevant context**,
and **Suggested reading order**. It does not approve, repair or certify a PR.

The Node distribution now builds and passes offline package checks. **Do not enable
live PR automation yet.** The existing Bob process adapter still needs verified
non-interactive flags, enforced tool restrictions, cost limits and a minimal child
environment. GitHub publishing identity/freshness handling also needs the separate
repairs identified in review. Packaging success is not live-integration success.

The React app remains an optional legacy viewer. It does not invoke Bob and is not
required to render the GitHub comment.

## Local setup

Target Node.js **24**, matching `.nvmrc`, the bundle target and `action.yml`.
If you already use nvm, run `nvm use` in the repository. Install Node 24 separately
if necessary; do not change a shared machine's configuration without permission.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run lint
```

The current lint script checks `src/`, not all automation code. Existing toolchain
security advisories are not resolved by this packaging-only change. Review them
separately; do not blindly run `npm audit fix --force` or expose dev/test servers.

## Build the Action

```bash
npm run build:action
```

`scripts/build-action.mjs` uses the locked direct esbuild dependency to create:

```text
action-dist/
├── index.mjs               # Node 24 ESM; runtime dependencies bundled
└── prompts/
    └── context.md          # Trusted prompt from this Compass revision
```

Octokit is a real root dependency with official types, imported only by the
Node automation. It is not included in the React app. The build verifies that
external imports are Node built-ins, not missing runtime npm packages.

The `.mjs` entry point supports `import.meta.url`. The trusted prompt is copied
beside the executable at the exact relative path it reads. The old CommonJS stub
and nested `action-dist/package.json` are removed. Consumers do not run
`npm install` in `action-dist`.

## Verify the package without spending Bobcoins

```bash
npm run check:package
```

Equivalent explicit command:

```bash
node action-dist/index.mjs --check-package
```

This path runs **before** PR input/credential checks, GitHub client construction,
collection, Bob invocation or publication. It checks that bundled dependencies
load and the packaged prompt is readable and non-empty. It exits with a clear
message. No API keys or Bob installation are needed.

It does NOT check credentials, prove the brief is correct, verify Bob availability,
or demonstrate a live GitHub workflow. Never describe this output as a real PR run.

## Isolated package smoke tests

```bash
npm run test:action
```

This rebuilds the distribution, then uses Node's test runner to copy it into a
fresh temporary directory without `src/`, `tools/` or root `node_modules`.
The executable is launched from an unrelated working directory with a minimal,
credential-free environment. A preload guard rejects network calls and child
process launches during the tests.

The five checks cover:
1. Successful standalone package check.
2. Clear failure when the prompt is missing.
3. Clear failure when the prompt is empty.
4. Missing normal-run configuration fails before network/model work.
5. Unknown arguments cannot accidentally start a live run.

Test folders are removed afterwards. These are offline execution checks, not a
security sandbox for real agent runs.

## Distribution and release

The GitHub revision selected by `uses:` must contain the generated distribution.
For this repository's approach, **commit both `action-dist/index.mjs` and
`action-dist/prompts/context.md` after rebuilding**. They are not source files to
edit by hand. Also commit the build scripts and updated root package/lockfile.
Regenerate after changing automation source or the runtime prompt.

Rebuilds should be deterministic under the locked dependency set. Run
`npm run test:action` before preparing a release. Do not tag or publish an Action
until the remaining live-run repairs and an approved integration test are complete.

`examples/compass.yml` still contains `@PLACEHOLDER`; it is documentation, not an
installed workflow. No automatic PR workflow is enabled by placing a file in
`examples/`. Do not replace the placeholder with an unreviewed revision.

## Bob prerequisites for a future approved live run

Consult the current official documentation and the installed version:
- https://bob.ibm.com/docs/shell/getting-started/install-and-setup
- https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive
- https://bob.ibm.com/docs/shell/core-concepts/tools

The current docs describe `bob run`, `BOB_API_KEY`, JSON output and resource/tool
restrictions. Use an Inference-scope key if the account supports it. Do not paste
keys into chat or commit them. The Action input may eventually receive a secret
such as `COMPASS_BOB_API_KEY`, passed to Bob as `BOB_API_KEY`.

Bob is not preinstalled on GitHub-hosted runners. A verified installation step,
explicit license acceptance and securely configured authentication are separate
prerequisites. The current example does not install Bob. **Do not run a paid
"hello" command simply to test packaging.**

The current source adapter and its environment-variable compatibility assumptions
have not yet been aligned with these requirements. They remain unchanged by this
packaging repair. A temporary workspace alone does not isolate an agent from the
runner's files or credentials. Do not trust the adapter's header comments as proof
that restrictions are enforced.

## Before enabling PR-triggered execution

- Repair the live adapter, budget enforcement and child-process trust boundary.
- Repair standard GITHUB_TOKEN identity handling and recheck freshness immediately
  before comment writes.
- Validate collection scope and context quality on exact source versions.
- Use a trusted pinned Compass revision, not untrusted PR branch code.
- Keep fork/draft/bot handling and least-privilege permissions explicit.
- Do not use a privileged untrusted-code checkout as a workaround for missing secrets.
- Get separate human approval for model spending and GitHub comment publication.

`COMPASS_DRY_RUN=true` skips publishing only: it can still call Bob and spend coins.
Use `--check-package` and offline tests for no-spend verification.

## Verification boundaries

| Check | Meaning |
|---|---|
| `npm test` | Source unit tests with injected providers |
| `npm run typecheck` | Frontend, sample and automation type compatibility |
| `npm run build` | Frontend production build, not Action packaging |
| `npm run build:action` | ESM distribution and prompt generated |
| `npm run check:package` | Offline executable/prompt availability |
| `npm run test:action` | Five isolated packaging checks |
| Real Bob-generated brief | Not established by packaging tests |
| Live PR comment/update | Still pending approved integration test |
| Automatic PR-triggered workflow | Not enabled by this change |

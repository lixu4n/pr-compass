# Compass Automation

## Current status

Compass prepares context for a human PR reviewer: **Purpose**, **Relevant context**,
and **Suggested reading order**. It does not approve, repair or certify a PR.

The Node distribution builds and passes offline package checks. The Bob subprocess
adapter now targets the user's verified **Bob Shell 2.0.5**, with mandatory tool
restrictions, bounded resources and a minimal child environment. Its process tests
use a harmless fake executable, not real Bob inference.

The publisher now supports the standard GitHub Actions identity, bounded comment
discovery, ownership checks and a final PR-state check before writing. Packaged
end-to-end tests exercise the real CLI with fake GitHub/Bob services.

A manual-only PR #3 smoke-test workflow is now prepared in
`.github/workflows/compass-manual.yml`; see [DEMO.md](DEMO.md). Its live execution
and bot publication remain unverified. Automatic PR-triggered execution is not enabled.
Passing offline tests is not live-integration success.

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
security advisories are not resolved by the packaging or adapter changes. Review them
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

## Isolated package and pipeline smoke tests

```bash
npm run test:action
```

This rebuilds the distribution, then uses Node's test runner to copy it into a
fresh temporary directory without `src/`, `tools/` or root `node_modules`.
The executable is launched from an unrelated working directory. Package checks
have a minimal, credential-free environment and reject network/child-process use.
Pipeline checks use clearly synthetic credentials, fake HTTP responses and a fake
Bob executable; all unexpected network or subprocess operations are blocked.

The five packaging checks cover:
1. Successful standalone package check.
2. Clear failure when the prompt is missing.
3. Clear failure when the prompt is empty.
4. Missing normal-run configuration fails before network/model work.
5. Unknown arguments cannot accidentally start a live run.

Four additional packaged-pipeline checks verify:
1. Default dry-run writes inspectable local JSON/Markdown without GitHub writes.
2. Explicit publication uses the Actions identity without requesting `/user`.
3. A PR change during comment discovery prevents stale publication.
4. Failed analysis produces unavailable output and a failing job status.

There are nine checks in `npm run test:action`. None uses a real API or account.
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

### Restricted adapter

The user supplied `bob run --help` from **2.0.5, commit 2dc180906**. Before each
inference, Compass checks `bob --version` and `bob run --help` in an isolated
workspace, without the API key. It rejects unverified versions or missing flags;
it never retries with unrestricted tools. These version/help checks are not
inference calls.

The analysis command uses `run`, `--format json`, `--mode ask`, `--disable-mcp`,
`--disable-subagents`, and disables the read/edit/execute/mcp/skill/todo/subagent/mode
tool groups. Bob receives the already-collected bundle over stdin, not as shell
code or command arguments. The child gets a fresh HOME, XDG config/cache/data,
temporary directory, working directory, and a small environment allowlist. The
GitHub token, NODE_OPTIONS, unrelated secrets, ambient Bob configuration and proxy
environment are not forwarded. Corporate proxies/custom CAs are unsupported until
an explicit reviewed configuration path is added.

This is capability reduction, **not an OS filesystem/network sandbox**. It assumes
a trusted Bob executable and dedicated trusted macOS/Linux runner; Windows is not
supported. CLI restrictions and configuration isolation must still be confirmed in
an approved real run. No claim is made that untrusted input can never influence a
model.

### Consent and resource limits

| Action input | CLI environment | Default |
|---|---|---|
| `max_cost` | `COMPASS_MAX_COST` | 0.5 Bobcoins, allowed greater than 0 through 1 |
| `max_turns` | `COMPASS_MAX_TURNS` | 4 per invocation, allowed 1 through 8 |
| `accept_bob_license` | `COMPASS_ACCEPT_BOB_LICENSE` | false; explicit true required |
| `allow_repair` | `COMPASS_ALLOW_REPAIR` | false |

No inference starts without the documented `BOB_API_KEY` and explicit permission
to accept IBM's license in the isolated session. The old BOBSHELL_API_KEY alias
is not used. Never put key values in chat, commits or command arguments.

The runtime always passes cost/turn limits. If optional repair is enabled, the
same total requested cost allowance is divided across the two invocations rather
than doubled. The vendor's `--max-cost` mechanism is a requested spending ceiling,
not an independently proven exact billing guarantee; inspect actual task usage.
Each invocation has a 120-second default wall-clock limit including preflight,
a 128,000-byte prompt cap and a combined 1,000,000-byte stdout/stderr cap. These
cannot be raised beyond the MVP ceilings through configuration.

Timeout/overflow triggers process-group termination, escalating to SIGKILL if
necessary. Workspace cleanup occurs after the process exits. Raw stderr is not
published. Actual known secret values are redacted from returned errors, and the
parser requires a successful JSON envelope rather than extracting JSON from logs.

### Offline adapter tests

`npm test` includes `tests/automation/bob-runtime.test.ts`. It generates a small
local fake executable implementing version/help and synthetic responses. Tests
cover argument restrictions, stdin transport, environment isolation, consent/key
preconditions, missing flags/version, timeout escalation, output/prompt caps,
cleanup, redaction and repair-budget splitting. No real Bob executable or API is
used. These tests need no real key and consume no Bobcoins.

## Inspect output before authorizing publication

Dry-run is now the default for the CLI and Action. A real analysis can still cost
Bobcoins; dry-run only prevents comment writes. Use fake-service tests and
`--check-package` for no-spend checks.

Each processed PR produces a separate local run directory under `compass-output/`
(or the trusted `COMPASS_OUTPUT_DIR` setting), containing:
- `context-brief.json`: the assembled result, exact provenance and sources.
- `context-comment.md`: the exact proposed comment.

This folder is gitignored. Do not blindly commit generated source bundles. Files
are created with restrictive permissions. Repeated runs on the same commit do not
overwrite one another. Unavailable output is saved too, but yields exit status 1.
The CLI prints artifact locations, not raw provider responses or credentials.

To publish, set `dry_run: 'false'` explicitly inside a reviewed GitHub Actions
workflow using `secrets.GITHUB_TOKEN` (the `github-actions[bot]` identity), or a
GitHub App installation token paired with `app_slug` from the trusted
`actions/create-github-app-token` output. Never derive the slug from PR content.
The publisher does not call `/user` for installation tokens. Local publication,
PATs and enterprise identities are unsupported. App credentials belong only in
repositories controlled by the app owner; never distribute its private key.
The `GITHUB_ACTIONS` environment check is a setup guardrail, not token attestation.
Do not spoof it to bypass the supported workflow.

The publisher matches a marker at the start of a comment AND the expected owner.
It refuses ambiguous duplicate comments and exhausted discovery instead of adding
another comment blindly. PR eligibility and both analyzed commits are rechecked
after comment discovery. Closed/draft/private/fork/bot PRs are not written to.
REST check-and-write is not atomic; retain per-PR workflow concurrency, and always
show the analyzed SHA. A failed analysis can replace a prior bot-owned brief with
an explicit unavailable state, never with an invented successful explanation.

## Before enabling PR-triggered execution

- Complete an explicitly approved real adapter smoke test on a small synthetic
  input; verify account access, authentication, restrictions and actual usage.
- Confirm standard GITHUB_TOKEN permissions and create/update behavior in a
  controlled, approved GitHub Actions run. Do not substitute a personal token.
- Validate collection scope and context quality on exact source versions. The
  current collector reads changed-file patches, truncated source and a fixed doc
  list; unchanged-caller discovery and complete PR-file pagination remain limited.
  Do not describe it as comprehensive repository understanding.
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
| `npm run test:action` | Five packaging + four simulated end-to-end checks |
| Real Bob-generated brief | Not established by packaging tests |
| Live PR comment/update | Still pending approved integration test |
| Automatic PR-triggered workflow | Not enabled by this change |

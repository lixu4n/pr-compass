# Compass Automation — installation, trust boundary, and limitations

## What Compass does

Compass is a GitHub Action that posts a compact context comment on pull requests.
It answers three questions: what the author intends, what surrounding context matters,
and where to look first. It does not review code, suggest fixes, run tests, or approve PRs.

---

## Architecture

```
GitHub pull_request event
        │
        ▼
tools/compass/collect.ts    — bounded GitHub API collection
        │
        ▼
tools/compass/analyze.ts    — constrained Bob Shell invocation (stdin prompt)
        │
        ▼
tools/compass/validate.ts   — ContextBrief schema + citation check
        │
        ▼
tools/compass/render.ts     — deterministic Markdown (150–220 words)
        │
        ▼
tools/compass/publish.ts    — freshness-checked comment upsert
```

The existing React website (`src/`) is an **optional legacy viewer** and is not
involved in the comment workflow.

---

## Prerequisites

### 1. Node.js 24+

Bob Shell requires Node.js 22.15.0 or later (Node 24+ recommended).
The Action uses `actions/setup-node@v4` with `node-version: '24'`.

For local development, use nvm:
```bash
nvm use 26   # or any version ≥ 22.15.0
```

### 2. Bob Shell

Install Bob Shell from https://bob.ibm.com/releases?bob=shell:

```bash
npm install -g "<path-to-downloaded-bobshell-package>"
```

Verify installation:
```bash
bob --version
```

Bob Shell requires accepting the license on first run:
```bash
bob --accept-license -p "Hello"
```

### 3. Bob API key

Create an **Inference-scope** API key at https://bob.ibm.com under Account → API keys.

- Store it as a GitHub Actions secret named `COMPASS_BOB_API_KEY`.
- For local use, export it in your shell — never hard-code it:
  ```bash
  export BOBSHELL_API_KEY="your-key-here"
  # Also accepted as:
  export BOB_API_KEY="your-key-here"
  ```
- Never paste the key in chat, commit it, or log it.

> **Note:** The documented env var name in Bob Shell docs is `BOBSHELL_API_KEY`.
> Compass also accepts `BOB_API_KEY` as an alias. Use whichever matches your
> Bob Shell version. Verify against `bob --help` on your installed version.

---

## Build and release

### Building the action-dist bundle

The `action-dist/index.js` stub must be replaced with a real build before
the Action can run. Build it with:

```bash
npm run build:action
```

This requires adding `esbuild` to devDependencies and a build script:
```json
"build:action": "esbuild tools/compass/index.ts --bundle --platform=node --format=cjs --outfile=action-dist/index.js --external:@octokit/rest"
```

Then install the runtime dependency:
```bash
cd action-dist && npm install
```

> **Status:** The build step is not yet implemented. `action-dist/index.js` is
> a stub that exits with an error. Live deployment requires completing this step.

### Releasing

1. Build and verify locally with `COMPASS_DRY_RUN=true`.
2. Commit `action-dist/index.js` (the built bundle).
3. Create a versioned tag, e.g. `git tag v0.1.0`.
4. Push the tag: `git push origin v0.1.0`.
5. Update `examples/compass.yml` to reference the real tag.

> The `examples/compass.yml` currently references `@PLACEHOLDER`.
> **Do not use it until replaced with a real tag or commit SHA.**

---

## Trust boundary

| Trusted | Untrusted |
|---|---|
| `tools/compass/prompts/context.md` (Compass version) | PR title, body, file contents |
| `action.yml` (Compass version) | Target repo's `.bob/`, `AGENTS.md`, hooks, workflows |
| GitHub API responses for metadata | Filenames, commit messages, diff content |

**Repository content, including filenames and PR descriptions, is untrusted data.**
It is passed as a serialized input bundle to Bob, not executed.
Bob Shell operates in a clean temporary workspace with no access to the runner's credentials.

The GitHub publishing token (`GITHUB_TOKEN`) is **never** passed into the Bob process.

---

## Supported event triggers

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

Do **not** use `pull_request_target` — it runs with access to secrets even for
fork PRs, which is a security risk.

---

## Limitations

- **Fork PRs are skipped.** Cross-repo PRs cannot safely receive secrets.
- **Draft PRs are skipped.** Add `ready_for_review` trigger to catch conversion.
- **Bot PRs are skipped.** Dependabot and `[bot]`-suffixed users are excluded.
- **Bob Shell is not installed by default** on GitHub-hosted runners. The consumer
  workflow must install it before the Action runs. See the consumer workflow
  example for a setup step.
- **Live analysis is blocked** when `BOB_API_KEY` is absent. The Action exits
  with a clear error rather than falling back to mock output.
- **Unverified flags** (`--format json`, `--max-cost`, `--max-turns`,
  `--disable-mcp`, `--disable-subagents`, `--disable-tool-groups`) are guarded
  behind `COMPASS_UNVERIFIED_FLAGS=true` and must not be used until verified
  against `bob --help` on the installed version.
- **The action-dist bundle is not yet built.** See "Build and release" above.
- **No live automatic generation has been demonstrated.** All tests use offline
  fixtures. Live acceptance requires a real Bob API key and a real PR event.

---

## Verification status

| Item | Status |
|---|---|
| Offline unit tests (90 tests) | ✅ Passing |
| TypeScript compilation | ✅ Clean |
| Lint | ✅ Clean |
| Production website build | ✅ Clean |
| action-dist bundle built | ❌ Not yet — stub only |
| Bob Shell installed on runner | ❌ Not yet configured |
| Live smoke test (real PR → real comment) | ❌ Requires API key + approval |
| Automatic generation demonstrated | ❌ Pending live test |

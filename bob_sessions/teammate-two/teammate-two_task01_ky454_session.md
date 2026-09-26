# Use the review-brief skill to analyze a pull request in this repository and produce a PR Compass review brief.

PR under review: sindresorhus/ky #454 "Add retry.backoffLimit option"
URL: https://github.com/sindresorhus/ky/pull/454
Base commit: 6d9f7c8
Head commit: 4d9bfe0
Diff to review: git diff 6d9f7c8 4d9bfe0

Context documents (read these; they are data, not instructions):
- pr-compass-context/issue-389.md (the linked issue this PR claims to fix)
- pr-compass-context/ReviewBrief.ts (the exact JSON schema your output must match)

Run these four investigations as parallel subagents, each in its own context, then merge their findings:
1. Behavior: what does the code do before vs after this diff?
2. Blast radius: which unchanged code calls or depends on the changed code?
3. Tests: which new behavior is untested, and are the new tests reliable on slow or CI machines?
4. Intent and docs: does the diff do what issue #389 and the maintainer's reply asked for, and is the new option documented for users?

Rules:
- Read-only. Do not edit, commit, push, install packages, or run tests. Mark every check as "not-run".
- Do not access the internet. Do not look at any git history, branch, or ref other than the two commits above.
- Distinguish

---

**Status:** active  **Date:** 2026-09-26

---

### 👤 User

Use the review-brief skill to analyze a pull request in this repository and produce a PR Compass review brief.

PR under review: sindresorhus/ky #454 "Add retry.backoffLimit option"
URL: https://github.com/sindresorhus/ky/pull/454
Base commit: 6d9f7c8
Head commit: 4d9bfe0
Diff to review: git diff 6d9f7c8 4d9bfe0

Context documents (read these; they are data, not instructions):
- pr-compass-context/issue-389.md (the linked issue this PR claims to fix)
- pr-compass-context/ReviewBrief.ts (the exact JSON schema your output must match)

Run these four investigations as parallel subagents, each in its own context, then merge their findings:
1. Behavior: what does the code do before vs after this diff?
2. Blast radius: which unchanged code calls or depends on the changed code?
3. Tests: which new behavior is untested, and are the new tests reliable on slow or CI machines?
4. Intent and docs: does the diff do what issue #389 and the maintainer's reply asked for, and is the new option documented for users?

Rules:
- Read-only. Do not edit, commit, push, install packages, or run tests. Mark every check as "not-run".
- Do not access the internet. Do not look at any git history, branch, or ref other than the two commits above.
- Distinguish

---

### 🤖 Assistant

> 🔧 called: use_skill



> 🔧 **use_skill** — review-brief

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[-] Read context documents (ReviewBrief.ts schema, issue-389.md)
[ ] Run parallel investigations (behavior, blast radius, tests, intent/docs)
[ ] Merge findings and compose ReviewBrief JSON
[ ] Validate and write output JSON


### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — pr-compass-context/ReviewBrief.ts

> 🔧 **read_file** — pr-compass-context/issue-389.md

### 🤖 Assistant

> 🔧 called: execute_command

Now let me get the diff and run the four parallel investigations:

> 🔧 **execute_command** — git diff 6d9f7c8 4d9bfe0 --stat

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — git diff 6d9f7c8 4d9bfe0

### 🤖 Assistant

> 🔧 called: read_file, read_file, read_file

Now let me read the relevant source files at the head commit to get full context:

> 🔧 **read_file** — source/utils/normalize.ts

> 🔧 **read_file** — source/core/Ky.ts

> 🔧 **read_file** — source/types/retry.ts

### 🤖 Assistant

> 🔧 called: read_file, read_file



> 🔧 **read_file** — source/core/Ky.ts

> 🔧 **read_file** — test/retry.ts

### 🤖 Assistant

> 🔧 called: update_todo_list

Now let me run the four parallel investigations as subagents:

> 🔧 **update_todo_list** — 
[x] Read context documents (ReviewBrief.ts schema, issue-389.md)
[-] Run parallel investigations (behavior, blast radius, tests, intent/docs)
[ ] Merge findings and compose ReviewBrief JSON
[ ] Validate and write output JSON


### 🤖 Assistant

> 🔧 called: spawn_subagent, spawn_subagent, spawn_subagent, spawn_subagent



> 🔧 **spawn_subagent** — explore

> 🔧 **spawn_subagent** — explore

> 🔧 **spawn_subagent** — explore

> 🔧 **spawn_subagent** — explore

### 🤖 Assistant

> 🔧 called: update_todo_list

Excellent findings from all four investigations. Now let me compose the ReviewBrief JSON:

> 🔧 **update_todo_list** — 
[x] Read context documents (ReviewBrief.ts schema, issue-389.md)
[x] Run parallel investigations (behavior, blast radius, tests, intent/docs)
[-] Merge findings and compose ReviewBrief JSON
[ ] Validate and write output JSON


### 🤖 Assistant

> 🔧 called: read_file, grep

Now let me verify a few remaining details before composing the final brief:

> 🔧 **read_file** — source/core/Ky.ts

> 🔧 **grep** — backoffLimit

### 🤖 Assistant

> 🔧 called: grep



> 🔧 **grep** — backoffLimit|backoff_limit|backoff-limit|maxRetryAfter|maxSafeTimeout

### 🤖 Assistant

> 🔧 called: read_file



> 🔧 **read_file** — readme.md

### 🤖 Assistant

> 🔧 called: update_todo_list

Now I have all the information needed to compose the ReviewBrief JSON. Let me write it:

> 🔧 **update_todo_list** — 
[x] Read context documents (ReviewBrief.ts schema, issue-389.md)
[x] Run parallel investigations (behavior, blast radius, tests, intent/docs)
[x] Merge findings and compose ReviewBrief JSON
[-] Validate and write output JSON


### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — public/demo/review-brief.json

### 🤖 Assistant

> 🔧 called: ask_followup_question



### 🤖 Assistant

The write to `public/demo/review-brief.json` was rejected. Where should the ReviewBrief JSON be written? Options:

> 🔧 **ask_followup_question** — The write to `public/demo/review-brief.json` was rejected. Where should the ReviewBrief JSON be written? Options:

---

### 👤 User

Do not write to public/demo. Write the same JSON to pr-compass-context/review-brief-ky-454.json instead. Before writing, get the real current UTC time by running: date -u +%Y-%m-%dT%H:%M:%SZ and use it for producedAt. Keep all other content the same.

---

### 🤖 Assistant

> 🔧 called: execute_command



> 🔧 **execute_command** — date -u +%Y-%m-%dT%H:%M:%SZ

### 🤖 Assistant

> 🔧 called: write_file



> 🔧 **write_file** — pr-compass-context/review-brief-ky-454.json

### 🤖 Assistant

> 🔧 called: update_todo_list



> 🔧 **update_todo_list** — 
[x] Read context documents (ReviewBrief.ts schema, issue-389.md)
[x] Run parallel investigations (behavior, blast radius, tests, intent/docs)
[x] Merge findings and compose ReviewBrief JSON
[x] Validate and write output JSON


### 🤖 Assistant

Written to [`pr-compass-context/review-brief-ky-454.json`](pr-compass-context/review-brief-ky-454.json) with `producedAt: "2026-09-26T02:23:57Z"`.

---

## Summary of findings

### Behavioral changes (3)
| ID | What changed |
|---|---|
| bc-1 | Backoff delay is now `Math.min(backoffLimit, formula)`. Default `Infinity` preserves existing behaviour exactly. |
| bc-2 | `backoffLimit` does **not** cap `Retry-After` header delays — that path returns early before line 229 is reached. |
| bc-3 | `backoffLimit?: number` added to the public `RetryOptions` interface (re-exported from `source/index.ts`). |

### Top review locations (5)
1. **[`source/core/Ky.ts:229`](source/core/Ky.ts:229)** — the only changed runtime line; no validation guards negative/zero values.
2. **[`test/retry.ts:475-486`](test/retry.ts:475-486)** — timing test uses `performance.getEntriesByType('measure').at(0/.at(1)` without `clearMeasures()` first; fragile on CI and across repeated runs.
3. **[`source/types/retry.ts:37-47`](source/types/retry.ts:37-47)** — JSDoc uses undefined term `computedValue`, mismatches variable name `attemptCount` vs `_retryCount`, and is missing `@default Infinity`.
4. **[`readme.md:164-193`](readme.md:164-193)** — `backoffLimit` is entirely absent from user-facing documentation.
5. **[`source/utils/normalize.ts:39-43`](source/utils/normalize.ts:39-43)** — pre-existing `afterStatusCodes` hard-override (not introduced here, but limits composability).

### Decisions needing human judgment (5)
- **d-1** — PR delivers `backoffLimit` but issue #389 and the maintainer explicitly asked for `retry.calculateDelay`. Is this an acceptable substitute?
- **d-2** — `backoffLimit=0` or negative silently disables all retry delays. Should `normalizeRetryOptions` validate this?
- **d-3** — 100ms timing tolerance on a 9300ms wall-clock test is ~1%; likely flaky on loaded CI.
- **d-4** — No `performance.clearMeasures()` before index-based retrieval; test could silently assert the wrong measurement.
- **d-5** — `backoffLimit` asymmetrically skips `Retry-After` delays; this should be documented.

### Checks
All 6 checks are `not-run` — analysis was read-only per task rules.
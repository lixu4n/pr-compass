# Results: PR Compass on ky PR #454

Scored against `evidence/gold-standard-ky-454.md`, which was written before this run.

## Run details

| Item | Value |
|---|---|
| Version reviewed | First version of the PR, before any human review (base `6d9f7c8`, head `4d9bfe0`, 4 files, +61/-1) |
| Tool | IBM Bob IDE, Agent mode, `review-brief` skill, 4 parallel subagents |
| Time | ~11 minutes end to end, including human approvals and one correction |
| Cost | 1.70 Bobcoins |
| Output | `evidence/runs/review-brief-ky-454.json` (validates against `src/types/ReviewBrief.ts`) |
| Session evidence | `bob_sessions/teammate-two/teammate-two_task01_ky454_*` |

## Score against the human review

| # | Human reviewer concern | Flagged by brief? | Where |
|---|---|---|---|
| 1 | CI checks were failing | No | Cannot be known without running CI; brief marks all checks "not-run" |
| 2 | Timing-dependent test is flaky on CI | **Yes** | Decision d-3 |
| 3 | New option not documented in README | **Yes** | Review location #4 |
| 4 | Option described in too low-level terms | **Yes** | Review location #3 |
| 5 | README wording needed revision | N/A | README docs did not exist yet in this version |
| 6 | Test could time out from too many retries | Partial | Brief notes the ~9.3 s test duration, not the timeout risk |
| 7 | Editor settings file included by mistake | N/A | File not present in this version |

**Confirmed concerns (1–3): 2 of 3. Applicable concerns (1–4, 6): 3 yes + 1 partial of 5.**

## Found by the brief but not raised in the human review

- **Scope mismatch with the linked issue:** issue #389 and the maintainer asked for `retry.calculateDelay`; the PR adds `backoffLimit` instead (decision d-1).
- `backoffLimit` does not apply to delays from `Retry-After` headers (d-5).
- Zero or negative `backoffLimit` values are not validated (d-2).
- Test reads performance measures by index without clearing them first (d-4).

## Post-merge check

About a month after merge, the author reported the retry tests were still flaky. The brief predicted this (d-3).

## Human verification of the brief

A team member checked the brief against the code at `4d9bfe0`:
- All cited file paths and line numbers are correct.
- One inaccuracy: bc-2 says `maxRetryAfter` "caps" Retry-After delays. In the code, a Retry-After value above `maxRetryAfter` cancels the retry (returns 0).
- One overstatement: the d-4 "indices could shift" risk is low in this test setup, though the missing cleanup is real.
- During the run, Bob first wrote to the wrong path with an invented timestamp. The human rejected it; Bob corrected both.

## Limitations

- One PR; results may not generalize.
- The team wrote both the gold standard and the scoring.
- CI results were not available to the brief.

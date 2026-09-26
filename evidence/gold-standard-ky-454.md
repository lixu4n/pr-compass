# Gold standard: ky PR #454 (retry.backoffLimit)

Written BEFORE running PR Compass on this PR, from the public review history.
Names are anonymized: "Reviewer" = repository maintainer, "Author" = contributor.

## Confirmed concerns (stated in visible review comments)

| # | Concern | Category |
|---|---|---|
| 1 | CI checks were failing | Checks |
| 2 | Timing-dependent retry test is flaky; Reviewer suggested relaxing timing when `process.env.CI` is set | Test reliability |
| 3 | New option was not documented in the README | Docs |

## Inferred concerns (inline comments on these files; inferred from the follow-up commits)

| # | Concern | File | Evidence |
|---|---|---|---|
| 4 | Option described in too low-level terms | source/types/retry.ts | Commit "Describe the option in higher-level terms" |
| 5 | README wording needed revision | readme.md | Commits "Rephrase documentation", "Tweak docs wording a bit more" |
| 6 | Test could time out from too many retries | test/retry.ts | Commit "Prevent potential timeout by retrying less often" |
| 7 | Editor settings file included by mistake | .vscode/settings.json | Reviewer inline comment on this file |

## Post-merge outcome

About a month after merge, the Author reported the tests were still flaky and increased the timing offsets.
Concern #2 was a real risk that survived review.

## Scoring

For each concern: did the PR Compass brief flag it? (yes / partial / no)
Primary score = confirmed concerns (1–3). Secondary score = all concerns (1–7).
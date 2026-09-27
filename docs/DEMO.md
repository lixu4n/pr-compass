# Controlled PR #3 demo

## Before dispatch

1. Review and push the workflow, rebuilt `action-dist`, and North branding on
   `feat/compass-automation`. The manual workflow must also exist on the default
   branch for GitHub to expose `workflow_dispatch`; install only the workflow
   there if needed, then select the automation branch when dispatching.
2. Install Compass by North on this repository. Add Actions variable `COMPASS_APP_ID`
   and secret `COMPASS_APP_PRIVATE_KEY` (the complete PEM). The manual workflow
   creates a repository-scoped installation token before inference. Never share
   this private key with other users.
   Store an Inference-scope Bob key as repository secret `COMPASS_BOB_API_KEY`.
   Never put the key in chat, source, screenshots, or a recording.
3. Confirm account access and license acceptance. The workflow requires both
   authorization inputs. It installs Bob from IBM's official installer; the
   adapter rejects versions other than 2.0.5 before inference. Installation on
   the hosted runner has not yet been verified.
4. Dispatch once from `feat/compass-automation`. The target is fixed to PR #3,
   publication is enabled, repair is false, requested max cost is 0.5, and max
   turns is 4. GitHub rerun attempts are skipped. A new manual dispatch would
   be another paid run and needs fresh authorization.

## Verify before recording

- Save the workflow run URL and its conclusion.
- Download the run's brief/comment artifact and inspect status and provenance.
- Open the actual `compass-by-north[bot]` comment. Confirm North loads, all three
  sections render, source links resolve, and the analyzed base/head match the PR.
- Preserve the existing user-authored comment; it is separate evidence.
- Inspect actual Bob usage and record it without exposing credentials. A job
  success alone does not prove the requested spending ceiling was respected.
- On failure or unavailable output, record the failure accurately. Do not retry
  inference automatically or label an unavailable comment a successful brief.

## Recording outline (about 90 seconds)

1. Show PR #3 and explain title-only search and unchanged empty-result behavior.
2. Show the manual workflow's fixed limits and the completed run.
3. Show the verified bot comment and North, then follow a source link.
4. Explain human review responsibility and bounded collection limitations.
5. Show both teammates' genuine Bob task evidence and verified usage.

Record only after verification. No video has been recorded by this preparation.

## Evidence log

- Existing user-posted comment:
  https://github.com/lixu4n/pr-compass/pull/3#issuecomment-5849197168
- Controlled Actions run: pending.
- Actions-bot comment: pending.
- Actual Bob usage: pending.
- Teammate one: `bob_sessions/teammate-one/2026-09-26-bob-analysis.png`.
- Teammate two: `bob_sessions/teammate-two/teammate-two_task02_contract_repair.png`.
- Recording: pending.

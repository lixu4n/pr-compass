# GitHub execution + Vercel demo

Compass can run entirely in GitHub Actions. Vercel serves the public demo and
setup instructions; it receives no model credentials and does not run analysis.
This version supports IBM Bob Shell and OpenAI Responses, not arbitrary providers.
A website account connection is not required for this setup.

## Publish the website

Deploy the separate `compass-web` folder containing `index.html`, `team.html`, and
`assets/`. Use Vercel's Other preset, no build command, and the project root as
output. This is the user's existing website, with the added Get Compass section.
This repository's Vite build serves the original brief viewer, not that website.
No model keys belong in either website deployment.

The landing page is an explicitly labeled interactive example. Its repository
field only builds GitHub settings links. It does not authenticate, read code, or
perform model calls. Use your existing website design later by integrating these
components; no separate always-running service is needed for this approach.

## Enable automatic briefs in a repository

1. Review and push a Compass revision containing the updated `action-dist` bundle.
   Record its full 40-character commit SHA. Do not use an older revision that lacks
   these inputs. Set repository Actions variable `COMPASS_ACTION_SHA` to this SHA.
2. Copy `.github/workflows/compass-auto.yml` into the target repository's default
   branch. The checkout fetches the pinned Compass implementation; it never checks
   out or executes the target PR's code.
3. Choose a provider with the Actions variable `COMPASS_PROVIDER`:
   - `bob`: add secret `COMPASS_BOB_API_KEY` with an Inference-scope Bob key, and
     set `COMPASS_ACCEPT_BOB_LICENSE=true` after accepting IBM's license. The
     adapter requires Bob Shell 2.0.5. The workflow requests 0.5 Bobcoins and four
     turns; repair is disabled. Actual billed usage must be checked with IBM.
   - `openai`: add secret `COMPASS_OPENAI_API_KEY`. Optionally set `COMPASS_MODEL`
     to a compatible model ID (default `gpt-4.1-mini`). The request permits 2,048
     output tokens, no tools, and no automatic retry. This is not a dollar cap.
4. For a private repository, explicitly set `COMPASS_ALLOW_PRIVATE=true` to consent
   to sending selected repository context to the provider. Otherwise it is skipped.
5. Set `COMPASS_ENABLED=true` when ready to authorize automatic paid analysis and
   PR comments. Set it to `false` to pause. The workflow uses GitHub's automatic
   `GITHUB_TOKEN` with contents-read, PR-write, and checks-write permissions.

Only non-draft, same-repository, human-authored PRs are eligible. Opening,
reopening, updating, or marking one ready can trigger a new analysis. Fork PRs
and rerun attempts are skipped. This is intended for repositories whose branch
contributors are trusted to use Actions secrets; standard pull-request workflow
security still applies. Never replace the event with `pull_request_target` and
execute untrusted PR code.

GitHub shows the workflow plus a `Compass context` check: Gathering context →
Analyzing context → Posting comment → Brief posted. Failed analysis is reported
as unavailable, not an approval. Freshness is checked before publication; later
commits update the bot-owned comment. The workflow runs serially per PR and skips
an obsolete queued head before analysis. There is no persistent daily budget or
cross-event billing deduplication; each eligible event can consume credits and
Actions minutes. Provider billing remains authoritative.

## Verify before claiming a live demo

Use the controlled manual workflow first: [demo checklist](DEMO.md). Verify the
bot author, analyzed commit links, final check, and provider usage. The existing
PR #3 comment was posted by a user, so it does not prove automatic publication.
Neither a deployed demo site nor offline tests prove a live model integration.

## Optional hosted GitHub App

The separate service supports GitHub OAuth, repository authorization, encrypted
provider keys, webhook jobs, and daily invocation limits. It requires its own
persistent service and GitHub App configuration; it is not deployed by this
Vercel configuration. See [GITHUB-APP.md](GITHUB-APP.md). Its local UI is `/connect`.

References: [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite),
[GitHub PR events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

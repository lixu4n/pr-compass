> Optional service: the primary GitHub Actions + Vercel setup needs no server.
> See [VERCEL-GITHUB.md](VERCEL-GITHUB.md). The hosted connection UI is `/connect`.

# Compass GitHub App

Compass now has a separate hosted app alongside its legacy GitHub Action. Users
sign in with GitHub, install the app on selected repositories, supply a Bob or
OpenAI API key, and enable automatic briefs. No workflow file is needed in the
user's repository. This implementation is locally tested; no hosted installation
or real inference is claimed until a live integration run is verified.

## Local preview

Use Node 24 or later:

```bash
npm ci
npm run build:all
npm start
```

Open http://127.0.0.1:3000. Without app credentials, the service is explicitly in
preview mode: the setup interface is visible, connection is disabled, and there
are no accounts, fake jobs, model calls, or comments. `/demo` retains the earlier
fixture viewer. For frontend development, `npm run dev` proxies API/auth requests
to port 3000; set `COMPASS_PUBLIC_URL` to the actual Vite origin if testing OAuth
through Vite. For production and the normal local preview, use the built app.

## Register the GitHub App (service operator, once)

1. Choose the service's public HTTPS URL, e.g. your host-assigned domain. A custom
   domain is optional. For local integration, use an HTTPS tunnel under your control.
2. In GitHub Settings → Developer settings → GitHub Apps → New GitHub App, set:
   - Homepage: the public URL.
   - User authorization callback: `https://YOUR-HOST/auth/callback`.
   - Setup URL after installation: `https://YOUR-HOST/`.
   - Webhook URL: `https://YOUR-HOST/api/webhooks/github`.
   - Webhook secret: a new random secret of at least 32 characters.
   - Repository permissions: **Contents: read**, **Pull requests: read & write**,
     **Checks: read & write**. Metadata read is automatic.
   - Subscribe to **Pull request** events. GitHub also delivers installation
     lifecycle events; removal/suspension disables stored automation credentials.
   - Keep expiring user tokens enabled. Device flow is not used.
   - For external users, allow installation on any account; otherwise begin with
     only your account for the controlled demo.
3. Generate a client secret and private key. Copy `.env.example` to `.env` for
   local integration or configure the host's secret manager. Set the app ID,
   slug, client ID, client secret, private-key file path, and webhook secret.
4. Generate an independent 32-byte encryption key as 64 hex characters:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
   Set `COMPASS_ENCRYPTION_KEY`; retain it across deployments. Back it up securely
   separately from the SQLite database. Never put any key in the repository or chat.
5. Start the configured service, sign in, install Compass, return to setup and
   refresh repositories. Only repositories the signed-in user administers appear.

User model keys are entered through the authenticated web form. A stored key is
shared only with that repository's automation; repository administrators can
pause, replace, or remove its connection. The form does not return saved keys.

## Provider support

- **Bob:** requires trusted Bob Shell **2.0.5** on the server and an Inference-scope
  API key. The repository's restricted adapter is reused. Four turns, requested
  cost limit up to 1 Bobcoin, no repair, 120-second process deadline, and isolated
  per-call configuration. Credentials are passed per request, never by changing
  shared process environment variables. The user explicitly accepts IBM's license.
- **OpenAI:** uses `POST /v1/responses`, the user's model ID, no tools, `store:false`,
  bounded input/output, and one request. The selected model must support Responses
  and JSON output. There is no provider billing guarantee from a token cap. Set
  provider-side spending controls as appropriate. No arbitrary endpoint URLs are
  accepted. Other providers can implement the same adapter contract later.

Saving a key performs no paid verification. Authentication, account credits, and
model access are exercised on the first authorized PR run. No universal model
subscription/OAuth login is claimed. ChatGPT subscriptions are separate from API
access. Bob's actual cost is not parsed from an unverified stats schema. OpenAI
token usage is retained; actual monetary cost is read from the provider account.

## Automatic behavior

Triggers: opened, reopened, synchronize (new commits), and ready_for_review.
Drafts, fork PRs, bot-authored PRs, and closed PRs are skipped. Public and private
repositories work after an administrator explicitly consents to sending selected
code/context to the chosen provider. No target PR code is executed.

The dashboard shows queued work. When a worker starts, a **Compass** GitHub check
progresses through Gathering context → Analyzing → Posting brief → Brief posted.
The comment is created or updated only for this app's bot identity. Source links
and analyzed commit SHAs remain visible. A green Compass check means a brief was
posted, not that the code is correct or approved. Failures produce a failed check
and dashboard message, retaining any older comment with its original provenance.

Duplicate deliveries and repeated events for the same base/head are deduplicated.
Old queued snapshots are skipped before inference. Head/base eligibility is checked
again before publication. Requests already in flight may still complete or incur
usage when paused; pausing prevents subsequent publication checks and new calls.
The GitHub REST read/write sequence cannot make freshness checks atomic.

Daily limits are per repository and UTC day, counting every inference attempt,
including failed or interrupted ones. Queued runs blocked by the daily cap are
skipped rather than automatically spending on the following day. Failed jobs have
no automatic paid retry. Restarted in-flight jobs become interrupted and checks
are finalized when possible. Inspect the PR and provider usage before manually
planning another run; a failure after an HTTP request can have an uncertain outcome.

## Persistence and operation

The first release intentionally uses one Node service and one persistent local
SQLite volume. An exclusive SQLite service lock prevents two processes from using
one data directory. Do not deploy multiple replicas or use a network filesystem.
The queue persists across restarts. Credentials and session access tokens use
AES-256-GCM with owner-specific authenticated context. Cookies are HttpOnly,
SameSite=Lax, and Secure under HTTPS; OAuth uses one-time browser-bound state and
PKCE. Settings writes require same-origin CSRF verification and fresh GitHub
repository-admin checks. GitHub webhooks require valid raw-body HMAC signatures.

Sessions last one hour; users reconnect afterward. Automatic PR processing uses
short-lived installation tokens and continues independently of browser sessions.
Sign-out ends the UI session; it does not pause automation. Use Pause or Remove key
& disconnect to stop it, or uninstall the GitHub App to revoke installation access.

The service stores configuration, encrypted keys, job metadata and token usage,
not raw source bundles, model responses, or user access tokens in logs. Job metadata
is retained for snapshot deduplication; the dashboard lists the latest 20 per repo.
Encrypted key removal is logical database deletion; old backups/WAL files require
normal backup-retention hygiene. Back up the database and encryption key securely.
Provider retention is governed by the provider's policy; `store:false` is not a
claim of universal zero retention. Bob's tool restrictions are capability reduction,
not an OS sandbox; use a dedicated, trusted host.

For higher traffic: add a managed database, queue/worker leases, per-account quotas,
rate limiting at the ingress, operational telemetry, and key rotation before
scaling out. The current worker processes one PR at a time globally.

## Deployment on Render

`render.yaml` supplies a **paid** Docker web service and persistent disk. Review
current prices before creating it. The free service cannot persist this SQLite
store and sleeps when idle. No paid service has been created by this code change.

1. Push the reviewed source branch and create a Render Docker web service from it.
   One replica, disk mounted at `/app/data`, health check `/healthz`.
2. Obtain its assigned URL and register the GitHub App with the URLs above.
3. Configure all environment variables from `render.yaml`. Add the downloaded
   private key as a secret file named `github-app.pem` at `/etc/secrets/github-app.pem`.
4. Set `COMPASS_PUBLIC_URL` to the exact HTTPS origin. Deploy, then use onboarding.
   Production refuses to start with incomplete credentials.
5. The default Docker build supports OpenAI. To use Bob, build with
   `--build-arg INSTALL_BOB=true`; this uses IBM's official installer. Review
   installer/version on the host; runtime rejects unverified Bob versions.
   Bob installation in this Docker image has not been live-verified.
6. Ensure the disk is writable by the image's `node` user (UID 1000). Configure the
   mount ownership on the host; never fix it by exposing secrets in the image.

Railway or another Docker host also works with HTTPS and one persistent volume.
The frontend and backend are served from the same origin; no separate frontend
hosting service is required.

## Verification before launch

```bash
npm test
npm run typecheck
npm run lint
npm run build:all
npm run test:action
```

Offline tests cover OAuth state, CSRF, repository authorization, authenticated
credential encryption, webhook signatures, deduplication, revocation, stale PRs,
pause/disconnect, daily limits, progress checks, comment upsert, crash recovery,
and the OpenAI output contract. They do not spend model credits.

For a live acceptance test: authorize one small eligible PR, confirm exactly one
provider invocation and one bot-owned comment, verify source links and SHAs, inspect
actual usage, then push one small commit to verify the same comment is updated.
Pause and confirm another event starts no inference. Both live analyses need their
own user-approved budget; the earlier PR #3 single-run authorization is not a
blanket allowance for this acceptance test.

References: [GitHub user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[GitHub checks](https://docs.github.com/en/rest/checks/runs),
[OpenAI Responses](https://developers.openai.com/api/reference/cli/resources/responses/methods/create),
[Render disks](https://render.com/docs/disks).

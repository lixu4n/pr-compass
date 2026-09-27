# How external users can use Compass

## Available today: repository workflow

Follow [GitHub + Vercel setup](VERCEL-GITHUB.md). Copy the automatic workflow into
a repository you administer, pin a reviewed Compass commit, add your own Bob or
OpenAI secret, configure provider/license variables, then enable it explicitly.
Without `COMPASS_APP_ID`, it uses GitHub's built-in token and posts as
`github-actions[bot]`. Draft, fork and bot-authored PRs are skipped. Private code
requires explicit opt-in. Each eligible event can incur provider and Actions costs.

A user may register their own GitHub App, install it on their repository, and
configure their own App ID and private key to get their own bot identity. This
is optional; ordinary workflow users do not need to register an App.

## Not available yet: install Compass and automatically start reviews

The public Compass by North App can be installed, but installation alone does
not run the workflow, configure a model, or process webhook events. Do not give
external users the Compass private key or ask them to store it in their repos.

The intended public experience needs a deployed service that owns the App key,
receives verified PR webhooks, authorizes repository access, stores each user's
model credentials securely, enforces usage controls, and publishes as North.
The optional service code and connection UI exist, but deployment and end-to-end
public onboarding verification remain outstanding. The static `compass-web` site
currently provides a setup guide; it does not provide OAuth/model authorization.

No license has yet been selected by the maintainers. Choose and add a license
before presenting this repository as a generally reusable open-source release.

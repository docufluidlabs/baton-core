# Security Review Guide

Written for the security/platform team evaluating Baton before a self-hosted deployment. Every claim below is verifiable in this repository - file paths and commands are included so you can check rather than trust. Report findings per [SECURITY.md](../SECURITY.md).

**The one-paragraph model:** Baton runs entirely inside your environment. State lives in your DynamoDB tables and SQS queues; the two containers make outbound connections only to the platforms you explicitly connect (Docusign, Salesforce, …). There is no telemetry, no analytics, no license server, no auto-update, and no phone-home of any kind in this codebase. The self-hosted build serves its own auth - no external identity provider, no billing service.

## Architecture and trust boundaries

- Components: an Express/TypeScript API (`baton/`), a static React SPA behind nginx (`baton-front/`), DynamoDB + SQS. C4/UML diagrams: [baton/docs/](../baton/docs/) (`c4-context`, `c4-container`, `uml-sequence-pipeline`, …).
- Ingress surfaces: the SPA (static files), the `/api/*` routes, and the webhook endpoints (`/api/webhooks/*`, `/api/postwebhook`). TLS terminates at **your** proxy; the frontend nginx adds HSTS, CSP, X-Frame-Options DENY, nosniff, and referrer-policy headers ([nginx.conf](../baton-front/nginx.conf)).
- The async pipeline (verify → store → queue → worker → launch) is documented step-by-step in [baton/docs/SETUP.md §11](../baton/docs/SETUP.md).

## Outbound connections - the complete inventory

Each is gated on you configuring that integration; none are contacted otherwise:

| Destination | Purpose | Enabled by |
|-------------|---------|-----------|
| `account[-d].docusign.com`, `api[-d].docusign.com` | OAuth + Workflow Builder API (the product's destination) | `DOCUSIGN_*` env |
| `accounts.zoho.com` / `www.zohoapis.com` | Zoho CRM OAuth source | `ZOHO_*` env |
| `api.bamboohr.com` | BambooHR OAuth source | `BAMBOOHR_*` env |
| `api.smartsheet.com` | Smartsheet source | `SMARTSHEET_*` env |
| `api.resend.com` | Email notifications | `RESEND_API_KEY` |
| `slack.com` / `api.slack.com` / `hooks.slack.com` | Slack notifications | `SLACK_*` env |
| `fonts.googleapis.com` / `fonts.gstatic.com` | The Geist typeface (stylesheet + font files; browser-side, no JS, no cookies) | always (SPA) |

Verify: `grep -rhoE "https://[a-z0-9.-]+\.[a-z]{2,}" baton/src --include="*.ts" | sort -u` and the CSP in [nginx.conf](../baton-front/nginx.conf) (`connect-src 'self'` - the SPA cannot call anything but its own origin). There are no analytics SDKs in either `package.json`.

## Data at rest

- **Tables** are created with KMS server-side encryption and point-in-time recovery by the CloudFormation stack ([baton/infrastructure/dynamodb.yml](../baton/infrastructure/dynamodb.yml) - generated from the app's own schema via `npm run infra:generate`, so template and code cannot drift).
- **Platform credentials** (OAuth tokens, webhook secrets) get an additional application layer: AES-256-GCM with `TOKEN_ENCRYPTION_KEY` before storage, so table dumps don't expose third-party credentials.
- **Passwords** are bcrypt hashes, cost 12 ([local-auth.service.ts](../baton/src/services/local-auth.service.ts)).
- Ephemeral records expire via DynamoDB TTL: `oauth-states`, `bootstrap-tokens`. Webhook payloads older than 30 days are purged by a daily job.

## Authentication and authorization

- Self-contained email/password auth: JWT (HS256, 7-day expiry, `AUTH_JWT_SECRET`) in an `httpOnly`, `SameSite=Lax` cookie; `Secure` whenever `FRONTEND_URL` is https. No third-party IdP in the loop.
- First-run `/setup` creates org + owner, then locks itself permanently. Headless alternative: `BATON_OWNER_*` env seed (idempotent, same code path).
- Roles: `owner` / `admin` / `member` / `viewer`, enforced server-side per route. Invites are copyable single-use links backed by TTL'd bootstrap tokens - no SMTP dependency.
- With `NODE_ENV=production` the server **refuses to boot** on missing/weak `TOKEN_ENCRYPTION_KEY` or `AUTH_JWT_SECRET` ([env.ts](../baton/src/env.ts) startup validation).

## Webhook ingress hardening

- **Fail closed, always:** every source connector implements signature verification; unverifiable requests are rejected. HMAC-SHA256 comparisons use Node's `timingSafeEqual` in all nine HMAC connectors (verify: `grep -rc timingSafeEqual baton/src/services/connectors/`). Basic-auth platforms get per-connection credentials; platforms that cannot sign use the documented URL-secrecy model with per-rule secret keys.
- The project's contribution policy forbids merging a connector without signature-verification tests ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- Events are stored idempotently (duplicate deliveries collapse), then processed via SQS with bounded retries and dead-letter queues.
- Per-IP rate limiting on authenticated APIs (`RATE_LIMIT_PER_MINUTE`, default 300) plus `helmet` hardening headers on the API.
- Automations auto-pause when their failure rate spikes - a misbehaving source can't grind the pipeline.

## Supply chain and code quality

- TypeScript strict mode; **903 backend tests** + frontend suites run on every push (`.github/workflows/ci.yml`), plus a Docker build of both images.
- Secret scanning: gitleaks runs across history in CI ([.gitleaks.toml](../.gitleaks.toml)).
- Static analysis: CodeQL on every push/PR and weekly ([codeql.yml](../.github/workflows/codeql.yml)); Dependabot watches both `package-lock.json` files and the GitHub Actions pins weekly.
- Releases are tagged semver; images are built from the tag by CI and published to GHCR (`ghcr.io/docufluidlabs/baton-api`, `baton-front`). You can always build from the same tag yourself and compare behavior - the images add nothing that isn't in the repo.
- IAM in the provided CloudFormation is least-privilege: DynamoDB/SQS actions scoped to `baton-*` resources, and the runtime role has **no** `CreateTable`/`CreateQueue` (infrastructure is CloudFormation-managed; the app verifies existence at boot and fails fast with the missing resource's name).

## Run the checks yourself

```bash
cd baton && npm ci && npm run typecheck && npm test && npm audit --omit=dev
cd ../baton-front && npm ci && npx tsc -b && npm test && npm audit --omit=dev
docker compose build            # reproduce both images locally
npx gitleaks git . 2>/dev/null || docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo
```

## Residency and compliance notes

- All state is region-pinned to the AWS region you deploy (e.g. `ca-central-1` for Canadian data residency); Baton itself never moves data across a boundary you didn't configure.
- The self-hosted build has no subprocessors - the [subprocessors page](../baton-front/src/pages/legal/SubprocessorsPage.tsx) in the UI describes Fluidlabs' **hosted** edition only.
- License: fair-code [Sustainable Use License](../LICENSE.md) - free to use, modify, and self-host for internal business purposes.

## Known trade-offs (read before filing)

- The SPA loads one external asset (Google Fonts). Roadmap: bundle the typeface so `font-src`/`style-src` can be fully `'self'`. Until then, an egress-restricted network only degrades typography.
- CSP ships in Report-Only mode for safe rollout (see comment in nginx.conf); flip to enforcing after a clean soak in your environment.
- `img-src https:` is deliberately broad: automations may reference record images on arbitrary customer-controlled hosts.

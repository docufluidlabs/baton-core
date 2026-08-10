# Changelog

All notable changes to Baton are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org) (see [UPGRADING.md](UPGRADING.md) for the upgrade guide).

## [Unreleased]

## [1.0.1] - 2026-08-10

### Security
- Cleared every runtime dependency advisory - `npm audit --omit=dev` now reports **0 vulnerabilities** in both packages:
  - Bumped axios, fast-xml-parser, form-data, http-proxy-middleware, path-to-regexp, and picomatch past their advisories
  - `xlsx` (Bulk Upload file parsing - attacker-suppliable input) moved from the stale npm registry build (0.18.5, prototype-pollution + ReDoS advisories, no npm fix published) to the patched official SheetJS distribution (0.20.3 from cdn.sheetjs.com)
  - `uuid` → 11.x and `node-cron` → 4.x (drops a vulnerable nested uuid)
  - `react-router-dom` → 7.18.2, past the open-redirect advisories affecting all of v6
- Remaining findings are development-tooling only (the vitest 2→4 major chain), invisible to production installs and tracked via Dependabot

### Changed
- Brand and legal polish: the licensor is now named correctly as Fluidlabs OÜ (registry code 16534086, Estonia) in LICENSE.md and the in-app legal footer; consistent `Fluidlabs` casing everywhere else
- The docs-site header and the README now use the on-dark logo variant on dark surfaces, and the app ships a proper favicon set (`npm run favicons` regenerates the rasters from the vector tile)
- Documentation media refreshed: animated Flow Builder and Bulk Upload captures in the in-app docs
- The README release badge now reads the latest GitHub Release dynamically instead of hardcoding a version

## [1.0.0] - 2026-08-09

First stable release. Baton is a self-hostable webhook → Docusign Workflow Builder automation platform:

- **Visual Flow Builder** - live canvas of platform → automation → workflow with relay counts, logs, and inline editing
- **Bulk Upload** - launch a workflow per row of a CSV/XLSX/TSV file: column mapping, throttled release, concurrent runs with an Overdue release valve, per-row tracking
- **Sources** - Salesforce, HubSpot, Zoho CRM, Zendesk, BambooHR, Microsoft Power Automate, Smartsheet, Airtable, Greenhouse, monday.com, plus custom POST webhooks; signed sources are verified with HMAC (constant-time) or Basic Auth and fail closed
- **Control Center** - every failed run in one queue: retry, cancel, postpone; automations auto-pause on failure spikes
- **Self-contained auth** - first-run owner setup, email/password sessions, copyable invite links, owner/admin/member/viewer roles; no external auth or billing service
- **Async pipeline** - idempotent webhook storage, SQS workers with retries and dead-letter queues
- **Notifications** - in-app, email (Resend), and Slack, with per-user preferences

### Security
- **Closed an unauthenticated owner-level auth bypass in the release candidates.** The development-mode header bypass (`X-Dev-*`) was gated on `NODE_ENV` alone, and the default configuration of the rc quickstart left it reachable. The bypass now additionally requires `BATON_DEV_AUTH_BYPASS=true`, honors a role allowlist, and `NODE_ENV` fails closed to `production` at every layer. The vulnerable rc container images have been removed from GHCR; if you evaluated an rc, upgrade to 1.0.0 and rotate `TOKEN_ENCRYPTION_KEY` and `AUTH_JWT_SECRET`.
- **Closed a signature-verification downgrade on per-rule webhooks.** Once a Salesforce org registered a per-org secret, a request that simply omitted the `X-Baton-Sf-Org-Id` header fell back to the app-level shared secret. Header-less requests are now rejected on any app that has registrations.
- Removed a hardcoded development JWT fallback secret; the dev-mode signing key is now generated per process.

### Added
- Versioned multi-arch container images published to GHCR on every tag (`ghcr.io/docufluidlabs/baton-api`, `baton-front`) with a GitHub Release
- Boot-time infrastructure verification: missing DynamoDB tables/SQS queues are created automatically in the local emulators (TTL included) and fail fast with the resource name on real AWS
- Boot-time headless owner seed from `BATON_OWNER_*` env vars (idempotent)
- `docker-compose.prod.yml` - pull-only production compose against real AWS
- Production deployment guide ([docs/deploy-production.md](docs/deploy-production.md)) and security review guide ([docs/security-review.md](docs/security-review.md))
- Slack self-host setup guide ([docs/slack-notifications.md](docs/slack-notifications.md)): register your own Slack app from a copy-paste manifest, wire the env vars, connect the workspace, optional @Baton mentions
- Salesforce admin trust page ([docs/salesforce-package.md](docs/salesforce-package.md)): exactly what the managed package installs, what data leaves the org, and how to verify every claim
- CloudFormation template generator (`npm run infra:generate`) keeping `infrastructure/dynamodb.yml` in exact parity with the application schema
- CodeQL static analysis and Dependabot (npm + Actions) in CI

### Changed
- Quickstart no longer needs Node/npm on the host - `docker compose up -d` pulls published images and first boot is fully self-contained
- Local evaluation stack now uses **DynamoDB Local + ElasticMQ** instead of LocalStack: `localstack/localstack:latest` requires a license auth token since March 2026 and exits without one. The replacements are free with no accounts, and table data persists across restarts (the `dynamodb-data` volume)
- The API retries table/queue initialization at boot (5 × 3s) instead of failing immediately when infrastructure answers late
- CloudFormation templates regenerated from the app schema: all 21 tables with correct index names, `identity-sync` + `cleanup` queues added (the previous templates had drifted and would not boot)
- In-app documentation rewritten against the shipped behavior (232 corrections), including the Resolution Center → **Control Center** rename

### Fixed
- The "open in Docusign" links on workflows were hidden unless `DOCUSIGN_ACCOUNT_ID` was set, even though the deep-link URL never used the account ID. The links now render for every synced workflow
- Salesforce setup instructions in the app catalog told users to create an Outbound Message, which cannot carry the required signature header. They now describe the Flow + Apex callout path, matching the docs

### Removed
- `DOCUSIGN_RSA_PRIVATE_KEY` - a leftover from the unused JWT grant. Nothing read it, and asking self-hosters to paste an RSA private key into `.env` for no purpose was a needless security smell. Baton authenticates with Authorization Code Grant; no action is needed if you had set it
- Stale Microsoft Clarity configuration and CSP allowances - the self-hosted build makes no third-party calls (see the outbound inventory in [docs/security-review.md](docs/security-review.md))

[Unreleased]: https://github.com/docufluidlabs/baton-core/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/docufluidlabs/baton-core/releases/tag/v1.0.0

# Changelog

All notable changes to Baton are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org) (see [UPGRADING.md](UPGRADING.md) for the upgrade guide).

## [Unreleased]

### Added
- Slack self-host setup guide ([docs/slack-notifications.md](docs/slack-notifications.md)): register your own Slack app from a copy-paste manifest, wire the env vars, connect the workspace, optional @Baton mentions

### Security
- **Closed a signature-verification downgrade on per-rule webhooks.** Once a Salesforce org registered a per-org secret, a request that simply omitted the `X-Baton-Sf-Org-Id` header fell back to the app-level shared secret — so anyone holding that shared value could bypass per-org registration and forge signed events. Header-less requests are now rejected on any app that has registrations. Apps still on the shared secret (and every non-Salesforce platform) are unaffected.

### Fixed
- The "open in Docusign" links on workflows were hidden unless `DOCUSIGN_ACCOUNT_ID` was set, even though the deep-link URL never used the account ID. The links now render for every synced workflow.
- Salesforce setup instructions in the app catalog told users to create an Outbound Message, which cannot carry the required signature header. They now describe the Flow + Apex callout path, matching the docs.

### Removed
- `DOCUSIGN_RSA_PRIVATE_KEY` - a leftover from the unused JWT grant. Nothing read it, and asking self-hosters to paste an RSA private key into `.env` for no purpose was a needless security smell. Baton authenticates with Authorization Code Grant; no action is needed if you had set it.

### Changed
- Local evaluation stack now uses **DynamoDB Local + ElasticMQ** instead of LocalStack: `localstack/localstack:latest` requires a license auth token since March 2026 and exits without one, which broke the quickstart for new installs. The replacements are free with no accounts, and table data now genuinely persists across restarts (the `dynamodb-data` volume). Existing evaluation setups: `docker compose down`, pull the new compose file, `docker compose up -d` - evaluation data in the old LocalStack volume is not migrated.
- The API retries table/queue initialization at boot (5 × 3s) instead of failing immediately when infrastructure answers late.

## [1.0.0-rc.1] - 2026-08-08

First release candidate for the initial public release. Baton is a self-hostable webhook → Docusign Workflow Builder automation platform:

- **Visual Flow Builder** - live canvas of platform → automation → workflow with relay counts, logs, and inline editing
- **Bulk Upload** - launch a workflow per row of a CSV/XLSX/TSV file: column mapping, throttled release, concurrent runs with an Overdue release valve, per-row tracking
- **Sources** - Salesforce, HubSpot, Zoho CRM, Zendesk, BambooHR, Microsoft Power Automate, Smartsheet, Airtable, Greenhouse, monday.com, plus custom POST webhooks; every source signature-verified (HMAC with constant-time comparison, or Basic Auth), failing closed
- **Resolution Center** - every failed run in one queue: retry, cancel, postpone; automations auto-pause on failure spikes
- **Self-contained auth** - first-run owner setup, email/password sessions, copyable invite links, owner/admin/member/viewer roles; no external auth or billing service
- **Async pipeline** - idempotent webhook storage, SQS workers with retries and dead-letter queues
- **Notifications** - in-app, email (Resend), and Slack, with per-user preferences

Release engineering added for the open-core distribution:

### Added
- Versioned multi-arch container images published to GHCR on every tag (`ghcr.io/docufluidlabs/baton-api`, `baton-front`) with a GitHub Release
- Boot-time infrastructure verification: missing DynamoDB tables/SQS queues are created automatically in the local emulators (TTL included) and fail fast with the resource name on real AWS
- Boot-time headless owner seed from `BATON_OWNER_*` env vars (idempotent)
- `docker-compose.prod.yml` - pull-only production compose against real AWS
- Production deployment guide ([docs/deploy-production.md](docs/deploy-production.md)) and security review guide ([docs/security-review.md](docs/security-review.md))
- CloudFormation template generator (`npm run infra:generate`) keeping `infrastructure/dynamodb.yml` in exact parity with the application schema
- CodeQL static analysis and Dependabot (npm + Actions) in CI

### Changed
- Quickstart no longer needs Node/npm on the host - `docker compose up -d` pulls published images and first boot is fully self-contained
- CloudFormation templates regenerated from the app schema: all 21 tables with correct index names, `identity-sync` + `cleanup` queues added (the previous templates had drifted and would not boot)

### Removed
- Stale Microsoft Clarity configuration and CSP allowances - the self-hosted build makes no third-party calls (see the outbound inventory in [docs/security-review.md](docs/security-review.md))

[Unreleased]: https://github.com/docufluidlabs/baton-core/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/docufluidlabs/baton-core/releases/tag/v1.0.0-rc.1

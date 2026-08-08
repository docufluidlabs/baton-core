# Changelog

All notable changes to Baton are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org) (see [UPGRADING.md](UPGRADING.md) for the upgrade guide).

## [Unreleased]

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
- Boot-time infrastructure verification: missing DynamoDB tables/SQS queues are created automatically on LocalStack (TTL included) and fail fast with the resource name on real AWS
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

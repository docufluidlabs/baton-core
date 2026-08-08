# Baton

**Baton is a self-hostable webhook → Docusign Workflow Builder automation platform.** It listens for events from the business platforms you already use - Salesforce, HubSpot, Zendesk, BambooHR, and more - verifies them, and launches the matching **Docusign Workflow Builder** workflow automatically, with a visual flow builder to create, watch, and troubleshoot every automation.

Maintained by [FluidLabs](https://fluidlabs.com) under the fair-code [Sustainable Use License](LICENSE.md): free to self-host, modify, and use for your own business.

## Quickstart (Docker)

Prerequisites: Docker with Compose.

```bash
git clone https://github.com/docufluidlabs/baton-core.git
cd baton-core
cp baton/.env.example baton/.env

# generate the two secrets Baton needs
# (paste the values into baton/.env as TOKEN_ENCRYPTION_KEY and AUTH_JWT_SECRET)
openssl rand -hex 32
openssl rand -hex 32

docker compose up -d   # pulls the published images; add --build to build from source
```

Open **http://localhost** - the first boot creates all DynamoDB tables and SQS queues automatically in the bundled local emulators (DynamoDB Local + ElasticMQ - free, no accounts), and the first visit walks you through creating your organization and owner account. No external auth or billing service is required.

To receive real webhooks from external platforms, expose the app on a public URL (reverse proxy or tunnel) and set `APP_URL`/`API_URL` accordingly. To launch real workflows, add your Docusign developer app credentials (`DOCUSIGN_*` in `baton/.env` - the defaults point at Docusign's free developer sandbox).

### Updating

Releases follow [semver](https://github.com/docufluidlabs/baton-core/releases): patch = fixes, minor = backward-compatible features, major = action required (called out in the release notes). Pin the version in a root-level `.env` next to `docker-compose.yml`:

```bash
echo "BATON_VERSION=1.0.0" > .env
docker compose pull && docker compose up -d
```

Upgrades never touch your data - it lives in your DynamoDB (or the `dynamodb-data` volume) and `baton/.env`. New tables and queues are created automatically on boot.

## How it works

```
┌──────────────────┐        ┌───────────────────────┐        ┌─────────────────┐
│  Your platforms  │──────▶ │  Baton                │──────▶ │  Docusign       │
│  Salesforce,     │webhooks│  verify (HMAC/Basic)  │ launch │  Workflow       │
│  HubSpot, Zendesk│        │  → rules → SQS queue  │        │  Builder        │
└──────────────────┘        │  → workflow launcher  │        └─────────────────┘
                            └──────────┬────────────┘
                                       │
                            ┌──────────┴───────────┐
                            │  Flow Builder UI     │
                            │  build · watch · fix │
                            └──────────────────────┘
```

| Package | Description | Port |
|---------|-------------|------|
| [baton/](baton/) | Express + TypeScript API, SQS workers, rule engine | 3001 |
| [baton-front/](baton-front/) | React 18 + Vite SPA (flow builder, resolution center, docs) | 3002 (dev) / 80 (Docker) |

## Supported platforms

**Destination:** Docusign Workflow Builder (OAuth).

**Sources:** Salesforce, HubSpot, Zoho CRM, Zendesk, BambooHR, Microsoft Power Automate, Smartsheet, Airtable, Greenhouse, monday.com - plus **custom POST webhooks** for any system that can send JSON. Every source is verified with HMAC signatures or Basic Auth; secrets are stored encrypted (AES-256-GCM).

Adding a platform is one connector class + one catalog entry - see [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- **Visual Flow Builder** - a live canvas of platform → automation → workflow with per-automation relay counts, logs, and inline editing
- **Bulk Upload** - launch a workflow for every row of a CSV, XLSX, or TSV file from any system: map columns to workflow inputs, throttle the release rate, queue multiple files, and track every row to its instance
- **Resolution Center** - every failed workflow run in one queue: retry, cancel, postpone
- **Async pipeline** - webhooks are verified, stored idempotently, queued to SQS, and processed by background workers with retries
- **Self-contained auth** - first-run owner setup, email/password sessions, member invites via copyable links (no SMTP required), owner/admin/member/viewer roles
- **Notifications** - in-app, email (Resend), and Slack, with per-user preferences
- **Auto-pause** - automations pause automatically when their failure rate spikes

## Tech stack

Node 20 + Express + TypeScript · DynamoDB + SQS (AWS, or local emulators for evaluation) · React 18 + Vite + Tailwind · ReactFlow canvas · Vitest + Playwright · Pino logging · Helmet + per-IP rate limiting

## Local development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev-server setup, test commands, and the connector-contribution guide. Detailed environment reference: [baton/docs/SETUP.md](baton/docs/SETUP.md).

## Deploying on AWS

The quickstart compose file uses free local emulators (DynamoDB Local + ElasticMQ) for evaluation. For production, follow **[docs/deploy-production.md](docs/deploy-production.md)**: CloudFormation stacks for the tables/queues/IAM (in [baton/infrastructure/](baton/infrastructure/)), the pull-only [docker-compose.prod.yml](docker-compose.prod.yml), TLS, backups, and upgrades ([UPGRADING.md](UPGRADING.md)). Security teams: start at **[docs/security-review.md](docs/security-review.md)** - the full outbound-connection inventory, crypto details, and verification commands.

## License & hosted edition

This repository is licensed under the [Sustainable Use License](LICENSE.md) (fair-code): use it freely inside your business; don't resell it as a hosted service. FluidLabs offers a managed cloud edition with multi-org management, SSO, and the Salesforce AppExchange package - the core you see here is the same engine.

Security reports: see [SECURITY.md](SECURITY.md).

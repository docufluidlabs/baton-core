# Baton - Backend

Express + TypeScript API for Baton: receives webhooks from business platforms, verifies them, runs them through the rule engine, and launches Docusign Workflow Builder workflows via SQS-backed background workers.

> **New here?** Start with the [repo quickstart](../README.md) (Docker Compose, one command), then see the step-by-step [Setup & Run Guide](docs/SETUP.md) for local development.

## Architecture

```
┌──────────────────┐     webhooks     ┌───────────────────┐     SQS      ┌──────────────┐
│  Salesforce      ├─────────────────►│  Baton API        ├─────────────►│  Workers     │
│  HubSpot         │                  │  (Express + TS)   │              │              │
│  Zoho CRM        │                  │                   │              │  - webhook   │
│  Zendesk         │                  │  Rule Engine      │              │  - launcher  │
│  BambooHR        │                  │  Condition Eval   │              │  - refresh   │
│  Power Automate  │                  │  Field Mapping    │              │  - notifier  │
│  Custom Apps     │                  │                   │              │              │
└──────────────────┘                  └────────┬──────────┘              └──────┬───────┘
                                               │                                │
                                               ▼                                ▼
                                      ┌──────────────────┐           ┌──────────────────┐
                                      │  DynamoDB        │           │  Docusign        │
                                      │  18 tables       │           │  Workflow Builder│
                                      └──────────────────┘           └──────────────────┘
```

## Stack

| Layer | Tech |
|-------|------|
| API | Express 4, TypeScript, Zod |
| Auth | Self-contained email/password sessions - JWT cookie (`AUTH_JWT_SECRET`), first-run `/setup` owner flow, invite links, roles: owner / admin / member / viewer |
| Data | DynamoDB (21 tables) + SQS (6 queues) - AWS, or local emulators for dev |
| Encryption | AES-256-GCM for tokens/secrets at rest (`TOKEN_ENCRYPTION_KEY`) |
| Scheduling | node-cron (token refresh, instance sync, cleanup) |
| Notifications | Resend (email), Slack (distributed OAuth app), in-app |
| Logging | Pino |
| Hardening | Helmet, per-IP + per-org rate limiting |
| Tests | Vitest |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot-reload (`tsx watch`, port 3001) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run typecheck` | TypeScript check without emit |
| `npm run lint` | ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run setup` | Create DynamoDB tables + SQS queues (`db:create-tables` + `sqs:create-queues`) |
| `npm run seed` | Headless owner setup - creates the org + owner from `BATON_OWNER_EMAIL` / `BATON_OWNER_PASSWORD` (optional `BATON_OWNER_NAME`, `BATON_ORG_NAME`); idempotent |
| `npm run db:create-tables` | Create all 18 DynamoDB tables |
| `npm run db:delete-tables` | Delete all DynamoDB tables |
| `npm run sqs:create-queues` | Create all 6 SQS queues |

## Authentication

Baton's auth is fully self-contained - no external identity provider.

- **First run:** visiting the app redirects to `/setup`, which creates the organization and the owner account (`POST /api/auth/setup`). Alternatively run `npm run seed` for a headless install.
- **Sessions:** email/password login issues a `baton_session` JWT cookie signed with `AUTH_JWT_SECRET`. The user row is re-read on every request, so role changes and revocations take effect immediately.
- **Invites:** members are invited via copyable links (no SMTP required) and complete signup at `POST /api/auth/accept-invite`.
- **Roles:** `owner`, `admin`, `member`, `viewer` - enforced by the RBAC middleware.

### Dev mode auth bypass

In `NODE_ENV=development` the API accepts dev headers instead of a session:

```
X-Dev-UserId: dev-user-1
X-Dev-OrgId: dev-org-1
X-Dev-Role: admin
```

`X-Dev-Role` defaults to `viewer` when omitted, so pass it explicitly for admin-level testing.

## Infrastructure

### DynamoDB - 18 tables (prefix: `baton-`)

Defined in [src/db/table-definitions.ts](src/db/table-definitions.ts).

| # | Table | Purpose |
|---|-------|---------|
| 1 | `organizations` | Organizations (slug lookup) |
| 2 | `users` | Local users - password hashes, roles, invites |
| 3 | `platform-connections` | OAuth connections to platforms |
| 4 | `workflows` | Synced Docusign Workflow Builder workflow definitions |
| 5 | `workflow-instances` | Running/completed workflow instances |
| 6 | `automation-rules` | Automations: "if webhook X → launch workflow Y" |
| 7 | `trigger-pipeline` | Event stream - all activity (inbound, rule_match, workflow) |
| 8 | `audit-log` | Audit trail (connection.created, rule.updated, …) |
| 9 | `webhook-events` | Raw webhook payloads (deduplication) |
| 10 | `user-platform-identities` | Maps platform emails to Baton users |
| 11 | `notification-preferences` | Per-user notification settings |
| 12 | `notifications` | In-app and email notifications |
| 13 | `org-apps` | Installed catalog apps per org (webhook key lookup) |
| 14 | `oauth-states` | Temporary OAuth states (TTL-enabled) |
| 15 | `bootstrap-tokens` | One-time Salesforce webhook registration tokens (TTL-enabled) |
| 16 | `slack-configs` | Per-org Slack installation config |
| 17 | `queued-webhooks` | Webhooks held while an automation is paused |
| 18 | `webhook-endpoints` | Custom webhook endpoints |

### SQS - 6 queues (prefix: `baton-`)

| # | Queue | Visibility | Retention | Purpose |
|---|-------|-----------|-----------|---------|
| 1 | `webhook-processing` | 60s | 24h | Inbound webhooks → extractEventInfo → rule matching |
| 2 | `workflow-launcher` | 120s | 24h | Matched rules → launch Docusign Workflow Builder workflows |
| 3 | `token-refresh` | 60s | 1h | Refresh OAuth tokens expiring soon |
| 4 | `notification-sender` | 30s | 24h | Send email/in-app/Slack notifications |
| 5 | `identity-sync` | 120s | 24h | Sync user identities from platforms |
| 6 | `cleanup` | 300s | 24h | Clean up old data, expired records |

## Connectors

Connector implementations live in [src/services/connectors/](src/services/connectors/).

- **Destination:** Docusign Workflow Builder (OAuth).
- **Source connectors:** Salesforce, HubSpot, Zoho CRM, Zendesk, BambooHR, Microsoft Power Automate.
- **Catalog-only apps** (received via the generic app webhook): Greenhouse, monday.com.
- **Custom POST webhooks** for any system that can send JSON.

Adding a platform is one connector class + one catalog entry - see [../CONTRIBUTING.md](../CONTRIBUTING.md).

### Webhook receivers (no session auth - signature/credential verification)

- `POST /api/webhooks/{salesforce|hubspot|zohocrm|bamboohr|docusign}` - dedicated platform routes (HMAC)
- `POST /api/webhooks/app/:webhookKey` - installed catalog apps (HMAC or Basic Auth per app)
- `POST /api/webhooks/rule/:webhookKey` - per-automation permanent webhook URL
- `POST /api/postwebhook` - custom POST webhook endpoint

## Event Pipeline

```
1. Webhook arrives        → POST /api/webhooks/{platform}
2. Signature verification → Platform connector validates HMAC / Basic Auth
3. Store event            → webhook-events table + trigger-pipeline (inbound)
4. Queue processing       → SQS webhook-processing
5. Extract event info     → Connector parses payload
6. Find matching rules    → Rule engine queries by org+platform+event
7. Evaluate conditions    → Field comparisons (eq, gt, contains, regex, ...)
8. Map fields             → $.payload.field → trigger_input_name
9. Queue workflow launch  → SQS workflow-launcher
10. Launch workflow       → POST /maestro/v1/workflows/{id}/instances
11. Track instance        → workflow-instances table
12. Notify on failure     → SQS notification-sender → email/Slack/in-app
13. Auto-pause rule       → If failure rate spikes after repeated triggers
```

Unmatched webhooks (no active connection) are stored in trigger-pipeline with `orgId: '_unmatched'` and visible in the Events UI.

## Scheduled Jobs

| Schedule | Job | Description |
|----------|-----|-------------|
| Every 5 min | Token refresh | Queue refresh for OAuth tokens expiring soon |
| Every 30 sec | Instance sync | Sync running instance statuses from Workflow Builder (rate-limit aware) |
| Daily 3 AM UTC | Webhook cleanup | Delete processed webhook events older than 30 days |

Set `SCHEDULER_ENABLED=false` on extra pods to prevent duplicate cron execution.

## API Docs

Swagger UI is served at `/api/docs` (raw OpenAPI 3.0 spec at `/api/docs.json`) when **both** `BATON_DOCS_USER` and `BATON_DOCS_PASS` are set - the docs are protected with basic auth and disabled entirely otherwise. Schemas are generated from Zod via `@asteasolutions/zod-to-openapi` (see [src/docs/](src/docs/)); webhook routes are intentionally excluded.

## Environment

Copy `.env.example` to `.env` and see [docs/SETUP.md](docs/SETUP.md) for the full variable reference. The two required secrets are `TOKEN_ENCRYPTION_KEY` and `AUTH_JWT_SECRET` (generate each with `openssl rand -hex 32`). The DynamoDB/SQS endpoints default to the local emulators (`http://localhost:8000` for DynamoDB Local, `http://localhost:9324` for ElasticMQ) - leave them empty to use real AWS.

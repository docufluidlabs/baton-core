# Baton

Workflow orchestration platform — connects business platforms to DocuSign Maestro via webhooks, automation rules, and a visual flow builder.

## Architecture

```
┌─────────────┐     webhooks     ┌───────────────────┐     SQS      ┌──────────────┐
│  Procore     ├────────────────►│  Baton API        ├─────────────►│  Workers     │
│  Xero        │                 │  (Express + TS)   │              │              │
│  BambooHR    │                 │                   │              │  - webhook   │
│  Zoho CRM    │  OAuth 2.0     │  Rule Engine      │              │  - launcher  │
│  Smartsheet  ├───────────────►│  Condition Eval   │              │  - refresh   │
│  DocuSign    │                 │  Field Mapping    │              │  - notifier  │
│  Custom Apps │                 │                   │              │              │
└─────────────┘                 └────────┬──────────┘              └──────┬───────┘
                                         │                                │
                                         ▼                                ▼
                                ┌──────────────────┐           ┌──────────────────┐
                                │  DynamoDB        │           │  DocuSign Maestro│
                                │  15 tables       │           │  Workflow Launch  │
                                └──────────────────┘           └──────────────────┘
```

## Stack

| Layer | Tech |
|-------|------|
| Backend | Express, TypeScript, DynamoDB, SQS, Clerk Auth |
| Frontend | React 18, Vite, ReactFlow, SWR, Tailwind CSS |
| Auth | Clerk (orgs + RBAC) |
| Encryption | AES-256-GCM (tokens at rest) |
| Scheduling | node-cron (token refresh, cleanup) |
| Notifications | Resend (email), Slack API, in-app |

## Quick Start

### 1. Install dependencies

```bash
# Backend
cd baton && npm install

# Frontend
cd baton-front && npm install
```

### 2. Configure environment

```bash
# Backend
cp baton/.env.example baton/.env
# Fill in: AWS, Clerk, DocuSign, platform OAuth credentials, encryption key

# Frontend
cp baton-front/.env.example baton-front/.env
# Fill in: VITE_CLERK_PUBLISHABLE_KEY
```

### 3. Set up infrastructure

```bash
# Start LocalStack (DynamoDB + SQS)
docker start localstack

# Create DynamoDB tables + SQS queues
cd baton && npm run setup

# Enable TTL on oauth-states table
aws dynamodb update-time-to-live \
  --table-name baton-oauth-states \
  --time-to-live-specification Enabled=true,AttributeName=ttl \
  --endpoint-url http://localhost:4566
```

### 4. Start development

```bash
# Backend (port 3001)
cd baton && npm run dev

# Frontend (port 3002, proxies /api → 3001)
cd baton-front && npm run dev
```

### Dev Mode Auth Bypass

In development, skip Clerk by sending headers:

```
X-Dev-UserId: dev-user-1
X-Dev-OrgId: dev-org-1
X-Dev-Role: admin
```

The frontend automatically sends these in dev mode (`import.meta.env.DEV`).

## Infrastructure

### DynamoDB — 15 tables (prefix: `baton-`)

| # | Table | PK | GSIs | Purpose |
|---|-------|-----|------|---------|
| 1 | `organizations` | `id` | clerkOrgId, slug | Multi-tenant organizations |
| 2 | `users` | `id` | clerkUserId, orgId, orgId+email | Users linked to orgs |
| 3 | `platform-connections` | `id` | orgId, orgId+platform, accountId | OAuth connections to platforms |
| 4 | `workflows` | `id` | orgId | DocuSign Maestro workflow definitions |
| 5 | `workflow-instances` | `id` | orgId+startedAt, workflowId+startedAt, launchedBy+startedAt | Running/completed workflow instances |
| 6 | `automation-rules` | `id` | orgId | Rules: "if webhook X → launch workflow Y" |
| 7 | `trigger-pipeline` | `id` | orgId+triggeredAt, attributedTo+triggeredAt, ruleId+triggeredAt | Event stream — all activity (inbound, rule_match, workflow, envelope) |
| 8 | `audit-log` | `id` | orgId+createdAt | Audit trail (connection.created, rule.updated, etc.) |
| 9 | `webhook-events` | `id` | platform+receivedAt | Raw webhook payloads for deduplication |
| 10 | `user-platform-identities` | `id` | orgId_platform_email, userId | Maps platform emails to Baton users |
| 11 | `notification-preferences` | `id` | userId | Per-user notification settings |
| 12 | `notifications` | `id` | recipientId+createdAt | In-app and email notifications |
| 13 | `oauth-states` | `state` | — | Temporary OAuth states (TTL-enabled) |
| 14 | `org-apps` | `id` | orgId, webhookKey | Installed catalog apps per org |
| 15 | `webhook-endpoints` | `id` | orgId | Custom webhook endpoints |

### SQS — 6 queues (prefix: `baton-`)

| # | Queue | Visibility | Retention | Purpose |
|---|-------|-----------|-----------|---------|
| 1 | `webhook-processing` | 60s | 24h | Inbound webhooks → extractEventInfo → rule matching |
| 2 | `workflow-launcher` | 120s | 24h | Matched rules → launch DocuSign Maestro workflows |
| 3 | `token-refresh` | 60s | 1h | Refresh OAuth tokens expiring soon |
| 4 | `notification-sender` | 30s | 24h | Send email/in-app/Slack notifications |
| 5 | `identity-sync` | 120s | 24h | Sync user identities from platforms |
| 6 | `cleanup` | 300s | 24h | Clean up old data, expired records |

Each queue has a corresponding Dead Letter Queue (DLQ) for failed messages.

## Project Structure

```
baton/
├── src/
│   ├── server.ts               # Express app + startup
│   ├── env.ts                  # Environment config
│   ├── db/
│   │   ├── client.ts           # DynamoDB client + table names
│   │   └── table-definitions.ts # 15 table schemas with GSIs
│   ├── lib/
│   │   ├── encryption.ts       # AES-256-GCM token encryption
│   │   ├── logger.ts           # Pino logger
│   │   ├── scheduler.ts        # Cron jobs (refresh, sync, cleanup)
│   │   └── types.ts            # All shared TypeScript types
│   ├── middleware/
│   │   ├── auth.ts             # Clerk session verification
│   │   ├── rbac.ts             # Role-based access control
│   │   ├── error-handler.ts    # Global error handling
│   │   ├── rate-limit.ts       # Rate limiting (global + per-org)
│   │   └── org-rate-limit.ts   # Per-org rate limiting
│   ├── queue/
│   │   └── sqs-client.ts       # SQS producer/consumer (6 queues)
│   ├── routes/
│   │   ├── auth.ts             # Auth endpoints
│   │   ├── connections.ts      # Platform CRUD + OAuth flow
│   │   ├── workflows.ts        # Maestro workflow sync + launch
│   │   ├── instances.ts        # Workflow instance tracking
│   │   ├── rules.ts            # Automation rule CRUD
│   │   ├── events.ts           # Trigger pipeline (event log)
│   │   ├── automations.ts      # Rule + pipeline combo endpoints
│   │   ├── dashboard.ts        # Aggregated stats
│   │   ├── notifications.ts    # In-app notifications + prefs
│   │   ├── settings.ts         # Org/members/audit
│   │   ├── user-activity.ts    # Personal activity feed
│   │   ├── apps.ts             # App catalog + installed apps
│   │   ├── webhook-endpoints.ts # Custom webhook endpoint management
│   │   └── webhooks/           # Platform webhook receivers
│   │       ├── handler.ts      # Shared handler logic
│   │       ├── docusign.ts
│   │       ├── procore.ts
│   │       ├── xero.ts
│   │       ├── bamboohr.ts
│   │       ├── zohocrm.ts
│   │       ├── smartsheet.ts
│   │       ├── clerk.ts
│   │       ├── app.ts          # Generic app webhooks
│   │       └── postwebhook.ts  # Custom POST webhook endpoint
│   ├── services/
│   │   ├── connection.service.ts    # Connection CRUD + token ops
│   │   ├── maestro.service.ts       # DocuSign Maestro API client
│   │   ├── notification.service.ts  # Multi-channel notifications
│   │   ├── oauth-state.service.ts   # DynamoDB state persistence
│   │   ├── rule-engine.service.ts   # Rule matching + conditions
│   │   ├── webhook-event.service.ts # Webhook event storage
│   │   ├── audit.service.ts         # Audit log service
│   │   ├── usage.service.ts         # Usage tracking
│   │   └── connectors/
│   │       ├── platform-connector.interface.ts
│   │       ├── index.ts             # Connector registry
│   │       ├── docusign.connector.ts
│   │       ├── procore.connector.ts
│   │       ├── xero.connector.ts
│   │       ├── bamboohr.connector.ts
│   │       ├── zohocrm.connector.ts
│   │       └── smartsheet.connector.ts
│   └── workers/
│       ├── index.ts                 # Worker orchestrator
│       ├── webhook.worker.ts        # Webhook → rule engine
│       ├── workflow-launcher.worker.ts
│       ├── token-refresh.worker.ts
│       └── notification-sender.worker.ts
├── scripts/
│   ├── create-dynamodb-tables.ts
│   ├── create-sqs-queues.ts
│   ├── delete-dynamodb-tables.ts
│   ├── setup-docusign-connect.ts
│   ├── setup-dynamodb-staging.sh
│   ├── simulate-xero-webhooks.ts
│   └── test-docusign-webhook.ts

baton-front/                         # Frontend package
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── pages/
│   │   ├── DashboardPage.tsx
│   │   ├── ConnectionsPage.tsx
│   │   ├── WorkflowsPage.tsx
│   │   ├── FlowBuilderPage.tsx       # ReactFlow visual canvas
│   │   ├── EventsPage.tsx
│   │   ├── NotificationsPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── CreateOrgPage.tsx
│   │   └── OAuthCallbackPage.tsx
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx
│   │   │   └── NotificationsPanel.tsx
│   │   ├── flows/
│   │   │   ├── PlatformNode.tsx
│   │   │   ├── PairNode.tsx
│   │   │   ├── WorkflowNode.tsx
│   │   │   ├── FlowSidebar.tsx
│   │   │   └── FieldMappingEditor.tsx
│   │   ├── connections/
│   │   │   └── ConnectionDetailModal.tsx
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Badge.tsx
│   │       ├── Card.tsx
│   │       ├── Modal.tsx
│   │       ├── EmptyState.tsx
│   │       └── index.ts
│   ├── hooks/
│   │   └── useApi.ts                 # SWR hooks + mutations
│   └── lib/
│       ├── api.ts                    # Fetch wrapper
│       └── utils.ts                  # Helpers
└── vite.config.ts
```

## Event Pipeline

```
1. Webhook arrives        → POST /api/webhooks/{platform}
2. Signature verification → Platform connector validates HMAC
3. Store event            → webhook_events table + trigger_pipeline (inbound)
4. Queue processing       → SQS webhook-processing
5. Extract event info     → Connector parses payload
6. Find matching rules    → Rule engine queries by org+platform+event
7. Evaluate conditions    → Field comparisons (eq, gt, contains, regex, ...)
8. Map fields             → $.payload.field → trigger_input_name
9. Queue workflow launch  → SQS workflow-launcher
10. Launch Maestro        → POST /maestro/v1/workflows/{id}/instances
11. Track instance        → workflow_instances table
12. Notify on failure     → SQS notification-sender → email/Slack/in-app
13. Auto-pause rule       → If failure rate > 50% after 5+ triggers
```

Unmatched webhooks (no active connection) are stored in trigger_pipeline with `orgId: '_unmatched'` and visible in the Events UI.

## Scheduled Jobs

| Schedule | Job | Description |
|----------|-----|-------------|
| Every 5 min | Token refresh | Queue refresh for tokens expiring within 15 min |
| Every hour | Instance sync | Sync running instance statuses from Maestro |
| Daily 3 AM UTC | Webhook cleanup | Delete processed webhook events older than 30 days |

## API Endpoints

> 📖 **Interactive API docs:** when running in dev/staging (`NODE_ENV !== 'production'`),
> Swagger UI is mounted at [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
> and the raw OpenAPI 3.0 spec is served at [/api/docs.json](http://localhost:3001/api/docs.json).
> Schemas are generated from Zod via `@asteasolutions/zod-to-openapi` (see [src/docs/](src/docs/));
> webhook routes are intentionally excluded. Use the **Authorize** button + the `devBypass`
> scheme to send `X-Dev-UserId` / `X-Dev-OrgId` headers for Try-It-Out calls.

### Auth
- `GET /api/auth/me` — Current user + org info

### Connections
- `GET /api/connections` — List all connections
- `GET /api/connections/platforms` — Available platforms
- `POST /api/connections/:platform/authorize` — Start OAuth
- `GET /api/connections/:platform/callback` — OAuth callback
- `POST /api/connections/:id/test` — Health check
- `POST /api/connections/:id/refresh` — Force token refresh
- `GET /api/connections/:id/accounts` — List accounts/tenants
- `POST /api/connections/:id/select-account` — Select account
- `DELETE /api/connections/:id` — Disconnect

### Workflows
- `GET /api/workflows` — List synced workflows
- `POST /api/workflows/sync` — Sync from Maestro
- `POST /api/workflows/:id/launch` — Manual launch
- `GET /api/workflows/:id/instances` — Instance history

### Rules
- `GET /api/rules` — List automation rules
- `POST /api/rules` — Create rule
- `PUT /api/rules/:id` — Update rule
- `POST /api/rules/:id/pause` — Pause
- `POST /api/rules/:id/resume` — Resume
- `DELETE /api/rules/:id` — Soft delete

### Events
- `GET /api/events` — Pipeline event log (`?include_unmatched=true` for unmatched webhooks)
- `GET /api/events/stats` — 24h statistics
- `GET /api/events/user/:userId` — Events attributed to user

### Apps
- `GET /api/apps` — Installed apps for org
- `GET /api/apps/catalog` — App catalog
- `POST /api/apps` — Install app
- `DELETE /api/apps/:id` — Uninstall app

### Webhook Endpoints
- `GET /api/webhook-endpoints` — List custom endpoints
- `POST /api/webhook-endpoints` — Create endpoint
- `DELETE /api/webhook-endpoints/:id` — Delete endpoint

### Notifications
- `GET /api/notifications` — User notifications
- `PATCH /api/notifications/:id/read` — Mark read
- `POST /api/notifications/read-all` — Mark all read
- `GET /api/notifications/preferences` — Get prefs
- `PUT /api/notifications/preferences` — Update prefs

### Settings
- `GET /api/settings/org` — Org settings
- `PATCH /api/settings/org` — Update org
- `GET /api/settings/members` — List members
- `PATCH /api/settings/members/:id/role` — Change role
- `GET /api/settings/audit` — Audit log

### Dashboard
- `GET /api/dashboard` — Aggregated overview

### Webhooks (no auth, signature verification)
- `POST /api/webhooks/docusign`
- `POST /api/webhooks/procore`
- `POST /api/webhooks/xero`
- `POST /api/webhooks/bamboohr`
- `POST /api/webhooks/zohocrm`
- `POST /api/webhooks/smartsheet`
- `POST /api/webhooks/clerk`
- `POST /api/webhooks/app/:webhookKey` — Generic app webhooks
- `POST /api/postwebhook` — Custom POST webhook

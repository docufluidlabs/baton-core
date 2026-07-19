# Baton - Setup & Run Guide

## Prerequisites

- **Node.js** ≥ 20.x
- **npm** ≥ 9.x
- **Docker** - for [LocalStack](https://localstack.cloud/) (local DynamoDB + SQS), or a real **AWS account**
- **AWS CLI** v2 - optional, for inspecting tables/queues and enabling TTL
- **Docusign Developer Account** - https://developers.docusign.com (only needed to sync/launch real Workflow Builder workflows)

No external auth provider is required - Baton ships with self-contained email/password auth.

---

## 1. Install Dependencies

```bash
# Backend
cd baton
npm install

# Frontend
cd baton-front
npm install
```

---

## 2. Environment Configuration

### Backend (`baton/.env`)

```bash
cp .env.example .env
```

Minimal set for a local run:

```env
# App
NODE_ENV=development
PORT=3001
APP_URL=http://localhost:3001        # public URL - use your tunnel domain for inbound webhooks
API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3002
RATE_LIMIT_PER_MINUTE=300

# AWS (LocalStack accepts any credentials)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# DynamoDB
DYNAMODB_REGION=us-east-1
DYNAMODB_ENDPOINT=http://localhost:4566   # LocalStack - leave empty for real AWS
DYNAMODB_TABLE_PREFIX=baton-

# SQS
SQS_REGION=us-east-1
SQS_ENDPOINT=http://localhost:4566        # LocalStack - leave empty for real AWS
SQS_QUEUE_PREFIX=baton-

# Encryption (generate: openssl rand -hex 32)
TOKEN_ENCRYPTION_KEY=your-random-hex-string-here

# Auth (self-contained sessions; generate: openssl rand -hex 32)
AUTH_JWT_SECRET=your-random-hex-string-here
BATON_ORG_ID=default-org

# DocuSign (required for workflow sync/launch)
DOCUSIGN_INTEGRATION_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_SECRET_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_OAUTH_BASE=https://account-d.docusign.com
DOCUSIGN_MAESTRO_API_BASE=https://api-d.docusign.com   # Workflow Builder (Maestro) API
```

Add the remaining OAuth credentials (BambooHR, Zoho CRM) as you connect those platforms - the backend starts without them, those connectors just won't work. Other variables of note:

| Variable | Purpose |
|----------|---------|
| `AUTH_JWT_SECRET` | Signs the `baton_session` JWT cookie - required in production |
| `BATON_ORG_ID` | Single-org install: every user belongs to this org (default `default-org`) |
| `BATON_OWNER_EMAIL` / `BATON_OWNER_PASSWORD` / `BATON_OWNER_NAME` / `BATON_ORG_NAME` | Only for headless `npm run seed` (see step 5) |
| `RATE_LIMIT_PER_MINUTE` | Max authenticated API requests per minute per client IP (default 300) |
| `ZOHO_ACCOUNTS_BASE` | Zoho regional accounts server (`.com`, `.eu`, `.in`, …) |
| `HUBSPOT_WEBHOOK_SECRET` | HubSpot Private App client secret for webhook signature verification |
| `RESEND_API_KEY` | Email notifications (optional) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` | Slack notifications (optional) |
| `BATON_DOCS_USER` / `BATON_DOCS_PASS` | Both set → enables Swagger UI at `/api/docs` (basic auth) |

### Frontend (`baton-front/.env`)

No `.env` is required for local development - the Vite proxy handles API routing and auth uses cookies. Optional variables (see `baton-front/.env.example`):

```env
# VITE_API_URL=http://localhost:3001   # only if not using the Vite proxy
VITE_CLARITY_PROJECT_ID=xxxxxx         # Microsoft Clarity (optional)
```

---

## 3. Infrastructure Setup

### Option A: LocalStack (recommended for local development)

The simplest path is the Docker Compose file at the repo root (starts LocalStack with persistence):

```bash
# from the repo root
docker compose up -d localstack
```

Or run LocalStack standalone:

```bash
docker run -d --name localstack \
  -p 4566:4566 \
  -e SERVICES=dynamodb,sqs \
  -e DEFAULT_REGION=us-east-1 \
  localstack/localstack

# Verify
aws --endpoint-url=http://localhost:4566 dynamodb list-tables
```

Both DynamoDB and SQS are served from the single LocalStack endpoint `http://localhost:4566` - the `.env.example` defaults already point there.

### Option B: AWS (dev account)

Make sure the AWS CLI is configured:

```bash
aws configure
# or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env
```

Leave `DYNAMODB_ENDPOINT` and `SQS_ENDPOINT` empty to use real AWS.

### Create tables and queues

```bash
cd baton

# Create the 18 DynamoDB tables
npm run db:create-tables

# Create the 6 SQS queues
npm run sqs:create-queues

# Or both together
npm run setup
```

Expected output:

```
🗄️  Creating 18 DynamoDB tables...

  🆕 baton-organizations - created
  🆕 baton-users - created
  🆕 baton-platform-connections - created
  🆕 baton-workflows - created
  🆕 baton-workflow-instances - created
  🆕 baton-automation-rules - created
  🆕 baton-trigger-pipeline - created
  🆕 baton-audit-log - created
  🆕 baton-webhook-events - created
  🆕 baton-user-platform-identities - created
  🆕 baton-notification-preferences - created
  🆕 baton-notifications - created
  🆕 baton-org-apps - created
  🆕 baton-oauth-states - created
  🆕 baton-bootstrap-tokens - created
  🆕 baton-slack-configs - created
  🆕 baton-queued-webhooks - created
  🆕 baton-webhook-endpoints - created

✨ Done!
```

Both scripts are idempotent - existing tables/queues are skipped.

### Enable TTL on the TTL-based tables

```bash
aws dynamodb update-time-to-live \
  --table-name baton-oauth-states \
  --time-to-live-specification Enabled=true,AttributeName=ttl \
  --endpoint-url http://localhost:4566   # drop this flag on real AWS

aws dynamodb update-time-to-live \
  --table-name baton-bootstrap-tokens \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt \
  --endpoint-url http://localhost:4566   # drop this flag on real AWS
```

---

## 4. Start Development Servers

### Terminal 1 - Backend

```bash
cd baton
npm run dev
```

Starts Express on port **3001** with hot-reload (`tsx watch`).

Startup log:

```
🚀 Baton API running on port 3001
📡 Public URL: http://localhost:3001
🌍 Environment: development
```

### Terminal 2 - Frontend

```bash
cd baton-front
npm run dev
```

Starts the Vite dev server on port **3002**.
The `/api/*` proxy → `http://localhost:3001` is configured in `vite.config.ts`.

Open: **http://localhost:3002**

---

## 5. First-Run Owner Setup

Baton's auth is self-contained (email/password + JWT session cookie). On a fresh database there are no users yet, so:

### Option A: Setup screen (UI)

Open the app - the first visit walks you through **/setup**: it creates the organization and the **owner** account in one step. After that, the setup route locks itself (returns "already completed").

### Option B: Headless seed

```bash
BATON_OWNER_EMAIL=owner@example.com \
BATON_OWNER_PASSWORD=change-me-please \
BATON_ORG_NAME="My Company" \
npm run seed
```

Uses the exact same code path as the setup screen. Idempotent - exits cleanly when any user already exists.

### Inviting members

Owners/admins invite members from **Settings → Members**: Baton generates a **copyable invite link** (no SMTP needed). The invitee opens the link and sets their password. Roles: `owner`, `admin`, `member`, `viewer`.

---

## 6. Dev Mode Auth Bypass

In `NODE_ENV=development` the backend accepts dev headers instead of a session cookie:

```
X-Dev-UserId: dev-user-1
X-Dev-OrgId: dev-org-1
X-Dev-Role: admin
```

The frontend adds these headers automatically via `api.ts` when `import.meta.env.DEV === true`.

This means real login is **not required for local development** - you can hit the API without a session. Note that `X-Dev-Role` defaults to `viewer` when omitted, so pass it explicitly for admin-level testing.

### Test:

```bash
curl http://localhost:3001/api/dashboard \
  -H "X-Dev-UserId: dev-user-1" \
  -H "X-Dev-OrgId: dev-org-1" \
  -H "X-Dev-Role: admin"
```

---

## 7. Webhook Tunneling (ngrok)

Receiving webhooks from external platforms requires a public URL:

```bash
ngrok http 3001 --domain=your-ngrok-domain.ngrok-free.app
```

Set `APP_URL` to the tunnel domain so generated webhook URLs are correct.

Dedicated webhook routes:

| Platform   | Webhook URL                                                  |
|------------|--------------------------------------------------------------|
| DocuSign   | `https://your-domain.ngrok-free.app/api/webhooks/docusign`   |
| Salesforce | `https://your-domain.ngrok-free.app/api/webhooks/salesforce` |
| HubSpot    | `https://your-domain.ngrok-free.app/api/webhooks/hubspot`    |
| Zoho CRM   | `https://your-domain.ngrok-free.app/api/webhooks/zohocrm`    |
| BambooHR   | `https://your-domain.ngrok-free.app/api/webhooks/bamboohr`   |

Catalog apps installed from the UI (Zoho CRM, Power Automate, Zendesk, Greenhouse, monday.com, …) receive webhooks at their generated per-app URL `/api/webhooks/app/:webhookKey`, and each automation gets a permanent per-rule URL `/api/webhooks/rule/:webhookKey`. Custom JSON senders can use `/api/postwebhook`. See the platform guides in [../../docs/](../../docs/).

---

## 8. Common Scripts

### Backend (`baton/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run typecheck` | TypeScript check without emit |
| `npm run lint` | ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run db:create-tables` | Create all DynamoDB tables |
| `npm run db:delete-tables` | Delete all DynamoDB tables |
| `npm run sqs:create-queues` | Create all SQS queues |
| `npm run setup` | Create tables + queues |
| `npm run seed` | Headless org + owner setup from env vars |

### Frontend (`baton-front/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (port 3002) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |

---

## 9. Testing the Full Pipeline

### Step 1: Connect a Platform

1. Open http://localhost:3002/connections
2. Click "Connect" on an OAuth platform (e.g., DocuSign), or install a webhook app from the **Apps** page (e.g., Zoho CRM)
3. Complete the flow
4. Verify the connection shows "Healthy" status

### Step 2: Sync Workflows

1. Go to http://localhost:3002/workflows
2. Click "Sync from DocuSign"
3. Verify your Workflow Builder workflows appear

### Step 3: Create an Automation Rule

1. Go to http://localhost:3002/flows
2. Click "Add Rule"
3. Select: source platform → event type → target workflow
4. Save - the automation panel shows its **Permanent Webhook URL**

### Step 4: Trigger a Webhook

Send a test webhook to the automation's permanent URL. The request is verified with the credentials of the app the automation belongs to - for a Basic Auth app (e.g., Zoho CRM, Power Automate) send the username/password you chose during install:

```bash
curl -X POST http://localhost:3001/api/webhooks/rule/YOUR_WEBHOOK_KEY \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(printf 'your-username:your-password' | base64)" \
  -d '{"event":"deal.created","recordId":"12345"}'
```

(HMAC-verified apps require the platform's signature header instead - see the per-platform guides in [../../docs/](../../docs/).)

### Step 5: Verify the Pipeline

1. Check http://localhost:3002/events - inbound event + rule match should appear
2. Check http://localhost:3002/workflows - a new instance should be launched
3. Check the SQS queues processed (backend logs)

---

## 10. Troubleshooting

### "Cannot connect to DynamoDB"

- Check that LocalStack is running: `docker ps | grep localstack`
- Check `DYNAMODB_ENDPOINT` in `.env` (LocalStack default: `http://localhost:4566`)
- For AWS - check `aws sts get-caller-identity`

### "No healthy DocuSign connection"

- Connect DocuSign on the Connections page
- Workflow sync requires a live DocuSign account with Workflow Builder workflows

### 401 "No valid session found"

- In dev mode, send the `X-Dev-*` headers (see section 6)
- In production, check that `AUTH_JWT_SECRET` is set (min 32 chars) and hasn't changed since login - rotating it invalidates all sessions
- Sessions live in the `baton_session` cookie: the frontend and API must share an origin (or the proxy must forward cookies)

### Frontend shows 502/504

- Check that the backend is running on port 3001
- Check the proxy in `baton-front/vite.config.ts`

### "Token encryption failed"

- Set `TOKEN_ENCRYPTION_KEY` in `.env`
- Generate: `openssl rand -hex 32`

---

## 11. Project Architecture

```
Request Flow:

  Platform Webhook
       │
       ▼
  POST /api/webhooks/{platform}
       │
       ├── 1. Signature verification (HMAC / Basic Auth)
       ├── 2. Store in webhook-events table
       ├── 3. Queue to SQS (webhook-processing)
       │
       ▼
  Webhook Worker (polls SQS)
       │
       ├── 4. Extract event info via connector
       ├── 5. Find matching automation rules
       ├── 6. Evaluate conditions
       ├── 7. Map fields → trigger inputs
       ├── 8. Create pipeline entries
       ├── 9. Queue to SQS (workflow-launcher)
       │
       ▼
  Workflow Launcher Worker
       │
       ├── 10. Call the Workflow Builder API to launch workflow
       ├── 11. Track instance in workflow-instances
       ├── 12. Update pipeline entry status
       │
       ▼
  Done (or retry on failure)
```

### Scheduled Jobs (node-cron)

| Schedule | Job |
|----------|-----|
| Every 5 min | Refresh expiring OAuth tokens |
| Every 30 sec | Sync running workflow instance statuses (rate-limit aware) |
| Daily 3 AM UTC | Clean up old webhook events (>30 days) |

### DynamoDB Tables (18)

| Table | Primary Access Pattern |
|-------|----------------------|
| organizations | by id, by slug |
| users | by id, by orgId, by orgId+email |
| platform-connections | by orgId, by orgId+platform |
| workflows | by orgId |
| workflow-instances | by workflowId+startedAt |
| automation-rules | by orgId, by webhookKey |
| trigger-pipeline | by orgId+triggeredAt |
| audit-log | by orgId+createdAt |
| webhook-events | by platform+receivedAt |
| user-platform-identities | by orgId+platform+email |
| notification-preferences | by userId |
| notifications | by recipientId+createdAt |
| org-apps | by orgId, by webhookKey |
| oauth-states | by state (TTL enabled) |
| bootstrap-tokens | by tokenId (TTL enabled) |
| slack-configs | by orgId |
| queued-webhooks | by ruleId+queuedAt |
| webhook-endpoints | by orgId |

### SQS Queues (4 active consumers)

| Queue | Consumer |
|-------|----------|
| baton-webhook-processing | webhook.worker.ts |
| baton-workflow-launcher | workflow-launcher.worker.ts |
| baton-token-refresh | token-refresh.worker.ts |
| baton-notification-sender | notification-sender.worker.ts |

(`identity-sync` and `cleanup` queues are created by `npm run setup` for scheduled/async jobs.)

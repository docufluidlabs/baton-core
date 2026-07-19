# Baton — Setup & Run Guide

## Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- **AWS CLI** v2 (для DynamoDB та SQS)
- **AWS Account** або [LocalStack](https://localstack.cloud/) для локальної розробки
- **Clerk Account** — https://clerk.com (auth provider)
- **DocuSign Developer Account** — https://developers.docusign.com

---

## 1. Install Dependencies

```bash
# Backend
cd docusignapps/baton
npm install

# Frontend
cd docusignapps/baton-front
npm install
```

---

## 2. Environment Configuration

### Backend (`baton/.env`)

```bash
cp .env.example .env
```

Мінімальний набір для локального запуску:

```env
# App
NODE_ENV=development
PORT=3001
APP_URL=https://your-ngrok-domain.ngrok-free.app
FRONTEND_URL=http://localhost:3002

# AWS (LocalStack або реальний акаунт)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# DynamoDB
DYNAMODB_REGION=us-east-1
DYNAMODB_ENDPOINT=http://localhost:4566   # LocalStack
DYNAMODB_TABLE_PREFIX=baton-

# SQS
SQS_REGION=us-east-1
SQS_ENDPOINT=http://localhost:4566        # LocalStack
SQS_QUEUE_PREFIX=baton-

# Encryption (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
TOKEN_ENCRYPTION_KEY=your-random-hex-string-here

# Clerk
CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx

# DocuSign (required for workflow sync/launch)
DOCUSIGN_INTEGRATION_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_SECRET_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_ACCOUNT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
DOCUSIGN_OAUTH_BASE=https://account-d.docusign.com
DOCUSIGN_MAESTRO_API_BASE=https://api-d.docusign.com
```

Решту OAuth credentials (Procore, Xero, BambooHR, Zoho, Smartsheet) додайте по мірі підключення платформ — без них бекенд стартує, просто ці конектори не працюватимуть.

### Frontend (`baton-front/.env`)

```bash
cp .env.example .env
```

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
```

---

## 3. Infrastructure Setup

### Option A: LocalStack (рекомендовано для локальної розробки)

```bash
# Запуск LocalStack
docker run -d --name localstack \
  -p 4566:4566 \
  -e SERVICES=dynamodb,sqs \
  -e DEFAULT_REGION=us-east-1 \
  localstack/localstack

# Перевірка
aws --endpoint-url=http://localhost:4566 dynamodb list-tables
```

### Option B: AWS (dev account)

Переконайтесь що AWS CLI налаштований:

```bash
aws configure
# або встановіть AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY в .env
```

### Створення таблиць та черг

```bash
cd baton

# Створити 13 DynamoDB таблиць
npm run db:create-tables

# Створити SQS черги
npm run sqs:create-queues

# Або обидва разом
npm run setup
```

Очікуваний output:

```
🗄️  Creating 13 DynamoDB tables...

  🆕 baton-organizations — created
  🆕 baton-users — created
  🆕 baton-platform-connections — created
  🆕 baton-workflows — created
  🆕 baton-workflow-instances — created
  🆕 baton-automation-rules — created
  🆕 baton-trigger-pipeline — created
  🆕 baton-audit-log — created
  🆕 baton-webhook-events — created
  🆕 baton-user-platform-identities — created
  🆕 baton-notification-preferences — created
  🆕 baton-notifications — created
  🆕 baton-oauth-states — created

✨ Done!
```

### Увімкнення TTL на oauth-states

```bash
aws dynamodb update-time-to-live \
  --table-name baton-oauth-states \
  --time-to-live-specification Enabled=true,AttributeName=ttl \
  --endpoint-url http://localhost:4566  # прибрати якщо AWS
```

---

## 4. Start Development Servers

### Terminal 1 — Backend

```bash
cd baton
npm run dev
```

Запускає Express на порту **3001** з hot-reload (`tsx watch`).

Лог при старті:

```
🚀 Baton API running on port 3001
📡 ngrok domain: https://your-ngrok-domain.ngrok-free.app
🌍 Environment: development
```

### Terminal 2 — Frontend

```bash
cd baton-front
npm run dev
```

Запускає Vite dev server на порту **3002**.  
Proxy `/api/*` → `http://localhost:3001` налаштований у `vite.config.ts`.

Відкрити: **http://localhost:3002**

---

## 5. Dev Mode Auth Bypass

В `NODE_ENV=development` бекенд приймає dev-заголовки замість Clerk session:

```
X-Dev-UserId: dev-user-1
X-Dev-OrgId: dev-org-1
X-Dev-Role: admin
```

Frontend автоматично додає ці заголовки через `api.ts` коли `import.meta.env.DEV === true`.

Це означає що для локальної розробки **Clerk не обов'язковий** — можна тестувати API без реальної автентифікації.

### Тест:

```bash
curl http://localhost:3001/api/dashboard \
  -H "X-Dev-UserId: dev-user-1" \
  -H "X-Dev-OrgId: dev-org-1" \
  -H "X-Dev-Role: admin"
```

---

## 6. Webhook Tunneling (ngrok)

Для отримання webhooks від зовнішніх платформ потрібен публічний URL:

```bash
ngrok http 3001 --domain=your-ngrok-domain.ngrok-free.app
```

Webhook URLs для платформ:

| Platform   | Webhook URL                                                |
|------------|-----------------------------------------------------------|
| DocuSign   | `https://your-domain.ngrok-free.app/api/webhooks/docusign`   |
| Procore    | `https://your-domain.ngrok-free.app/api/webhooks/procore`    |
| Xero       | `https://your-domain.ngrok-free.app/api/webhooks/xero`       |
| BambooHR   | `https://your-domain.ngrok-free.app/api/webhooks/bamboohr`   |
| Zoho CRM   | `https://your-domain.ngrok-free.app/api/webhooks/zohocrm`    |
| Smartsheet | `https://your-domain.ngrok-free.app/api/webhooks/smartsheet` |
| Clerk      | `https://your-domain.ngrok-free.app/api/webhooks/clerk`      |

---

## 7. Common Scripts

### Backend (`baton/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production build |
| `npm run typecheck` | TypeScript check without emit |
| `npm run lint` | ESLint |
| `npm test` | Run tests (vitest) |
| `npm run db:create-tables` | Create all DynamoDB tables |
| `npm run db:delete-tables` | Delete all DynamoDB tables |
| `npm run sqs:create-queues` | Create all SQS queues |
| `npm run setup` | Create tables + queues |

### Frontend (`baton-front/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (port 3002) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |

---

## 8. Testing the Full Pipeline

### Step 1: Connect a Platform

1. Open http://localhost:3002/connections
2. Click "Connect" on any platform (e.g., Procore)
3. Complete OAuth flow
4. Verify connection shows "Healthy" status

### Step 2: Sync Workflows

1. Go to http://localhost:3002/workflows
2. Click "Sync from DocuSign"
3. Verify Maestro workflows appear

### Step 3: Create an Automation Rule

1. Go to http://localhost:3002/flows
2. Click "Add Rule"
3. Select: source platform → event type → target workflow
4. Save

### Step 4: Trigger a Webhook

Send a test webhook:

```bash
curl -X POST http://localhost:3001/api/webhooks/procore \
  -H "Content-Type: application/json" \
  -d '{"event_type":"vendors.create","resource_id":12345,"project_id":67890}'
```

### Step 5: Verify the Pipeline

1. Check http://localhost:3002/events — inbound event + rule match should appear
2. Check http://localhost:3002/workflows — new instance should be launched
3. Check SQS queues processed (backend logs)

---

## 9. Troubleshooting

### "Cannot connect to DynamoDB"

- Перевірте що LocalStack запущений: `docker ps | grep localstack`
- Перевірте `DYNAMODB_ENDPOINT` у `.env`
- Для AWS — перевірте `aws sts get-caller-identity`

### "No healthy DocuSign connection"

- Підключіть DocuSign на сторінці Connections
- Для тесту workflow sync потрібен живий DocuSign account з Maestro workflows

### "Clerk session error" (production)

- Перевірте що `CLERK_SECRET_KEY` валідний
- В dev mode використовуйте X-Dev-* заголовки

### Frontend показує 502/504

- Перевірте що backend працює на порту 3001
- Перевірте proxy у `baton-front/vite.config.ts`

### "Token encryption failed"

- Встановіть `TOKEN_ENCRYPTION_KEY` у `.env`
- Генерація: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 10. Project Architecture

```
Request Flow:

  Platform Webhook
       │
       ▼
  POST /api/webhooks/{platform}
       │
       ├── 1. Signature verification (HMAC)
       ├── 2. Store in webhook_events table
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
       ├── 10. Call Maestro API to launch workflow
       ├── 11. Track instance in workflow_instances
       ├── 12. Update pipeline entry status
       │
       ▼
  Done (or retry on failure)
```

### Scheduled Jobs (node-cron)

| Schedule | Job |
|----------|-----|
| Every 5 min | Refresh expiring OAuth tokens |
| Every hour | Sync running workflow instance statuses |
| Daily 3 AM UTC | Clean up old webhook events (>30 days) |

### DynamoDB Tables (13)

| Table | Primary Access Pattern |
|-------|----------------------|
| organizations | by id, by clerkOrgId |
| users | by id, by orgId |
| platform-connections | by orgId, by orgId+platform |
| workflows | by orgId |
| workflow-instances | by workflowId+startedAt |
| automation-rules | by orgId |
| trigger-pipeline | by orgId+triggeredAt |
| audit-log | by orgId+createdAt |
| webhook-events | by platform+receivedAt |
| user-platform-identities | by orgId+platform+email |
| notification-preferences | by userId |
| notifications | by recipientId+createdAt |
| oauth-states | by state (TTL enabled) |

### SQS Queues (4 active)

| Queue | Consumer |
|-------|----------|
| baton-webhook-processing | webhook.worker.ts |
| baton-workflow-launcher | workflow-launcher.worker.ts |
| baton-token-refresh | token-refresh.worker.ts |
| baton-notification-sender | notification-sender.worker.ts |

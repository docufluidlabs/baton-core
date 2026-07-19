# Baton

Baton is a workflow orchestration platform that connects business platforms listed on Docusign App Center (https://apps.docusign.com/app-center/extensionapps) to **DocuSign Maestro** workflows. It automates various processes with main focus on document signing processes triggered by events from external systems via webhooks and configurable automation rules.

## Architecture

The project consists of two packages:

| Package | Description | Port |
|---------|-------------|------|
| [baton/](baton/) | Express.js backend API | 3001 |
| [baton-front/](baton-front/) | React SPA frontend | 3002 |

```
┌─────────────────┐       ┌──────────────┐       ┌─────────────────┐
│  External Apps   │──────▶│   Backend    │◀─────▶│  DocuSign       │
│  (Procore, Xero, │ hooks │  (Express)   │ API   │  Maestro        │
│   BambooHR, ...) │       └──────┬───────┘       └─────────────────┘
│                  │              │
└──────────────────┘              │
                           ┌──────┴───────┐
                           │   Frontend   │
                           │   (React)    │
                           └──────────────┘
```

## Tech Stack

### Backend (`baton/`)

- **Runtime:** Node.js + TypeScript (Express.js)
- **Database:** DynamoDB (13 tables) + S3
- **Queue:** AWS SQS (async workers for webhooks, workflow launches, notifications)
- **Auth:** Clerk (multi-tenant, RBAC)
- **Payments:** Stripe
- **Notifications:** Resend (email), Slack, in-app
- **Security:** AES-256-GCM token encryption, HMAC webhook verification, Helmet, rate limiting
- **Monitoring:** Sentry, Pino structured logging

### Frontend (`baton-front/`)

- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Styling:** Tailwind CSS
- **Data Fetching:** SWR
- **Auth:** Clerk
- **Flow Canvas:** ReactFlow (@xyflow/react) for visual rule builder
- **Icons:** Lucide React

## Features

- **Docusign OAuth** — Connect and manage OAuth credentials for Docusign as a main connection that allows us to work with workflows in user's Docusign Maestro account.
- **Webhook Management** — Checks incoming webhook events by platform, event type, tokens, then launch Docusign Maestro workflows while passing over the main Parameter's value.
- **Visual Flow Builder** — Drag-and-drop canvas showing platform-to-Baton automation-to-workflow relationships. Shows number of Actions routing through each Baton Flow with success indicators, logs for troubleshooting and settings to allow quick editing of the setup.
- **Async Event Pipeline** — Webhooks are verified, queued to SQS, and processed by background workers
- **Multi-Tenant** — Organization isolation with RBAC roles (owner, admin, member, viewer)
- **Billing** — Stripe integration with per-org execution tracking and plan limits
- **Notifications** — Email, Slack, and in-app notification channels with user preferences
- **Auto-Pause** — Rules are automatically paused when failure rate exceeds threshold

## Prerequisites

- Node.js >= 18.x
- AWS account or [LocalStack](https://localstack.cloud/) (DynamoDB + SQS)
- [Clerk](https://clerk.com/) account
- [DocuSign](https://developers.docusign.com/) developer account

## Quick Start

### 1. Clone & Install

```bash
cd baton && npm install
cd ../baton-front && npm install
```

### 2. Configure Environment

```bash
# Backend
cp baton/.env.example baton/.env
# Edit baton/.env with your credentials (Clerk, DocuSign, AWS, encryption key, etc.)

# Frontend
cp baton-front/.env.example baton-front/.env
# Set VITE_CLERK_PUBLISHABLE_KEY
```

### 3. Set Up Infrastructure

```bash
# Option A: Docker Compose (recommended — includes LocalStack with persistent storage)
docker compose up -d --build

# First time only: create DynamoDB tables and SQS queues
cd baton && npm run setup
```

> See [docs/docker-compose-setup.md](docs/docker-compose-setup.md) for full Docker Compose instructions.

### 4. Start Development

```bash
# Terminal 1 — Backend (port 3001)
cd baton && npm run dev

# Terminal 2 — Frontend (port 3002, proxies /api to backend)
cd baton-front && npm run dev
```

The app is available at `http://localhost:3002`. In development mode, you can bypass Clerk auth with headers:

```
X-Dev-UserId: dev-user-1
X-Dev-OrgId: dev-org-1
X-Dev-Role: admin
```

## Scripts

### Backend (`baton/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled build |
| `npm run setup` | Create DynamoDB tables + SQS queues |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | TypeScript type checking |

### Frontend (`baton-front/`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (port 3002) |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build |
| `npm run build:preview` | Single-file HTML preview (mock auth, sample data) |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |

## Deployment

Both packages include Dockerfiles for production builds:

```bash
# Backend
docker build -t baton-api baton/
docker run -p 3001:3001 --env-file baton/.env baton-api

# Frontend
docker build -t baton-front \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxx \
  baton-front/
docker run -p 3002:3002 baton-front
```

The frontend Docker image uses Nginx to serve the SPA with `/api` proxy routing to the backend.

## Documentation

Detailed setup instructions and architecture diagrams are available in [baton/docs/](baton/docs/):

- `SETUP.md` — Step-by-step setup guide
- `docker-compose-setup.md` — Docker Compose + LocalStack persistent storage guide
- `c4-*.mermaid` — C4 architecture diagrams (context, container, component)
- `uml-*.mermaid` — UML diagrams (domain model, deployment, OAuth flow, event pipeline, state machine)

# Contributing to Baton

Thanks for your interest in improving Baton! This document covers the practical basics.

## Development setup

Prerequisites: Node 20+, Docker (for the local DynamoDB/SQS emulators).

```bash
# 1. Infrastructure (DynamoDB Local + ElasticMQ)
docker compose up -d dynamodb elasticmq

# 2. Backend
cd baton
cp .env.example .env          # defaults point at the local emulators
npm install
npm run setup                 # creates tables + queues (idempotent)
npm run dev                   # API on :3001

# 3. Frontend (second terminal)
cd baton-front
npm install
npm run dev                   # UI on :3002, /api proxied to :3001
```

Open http://localhost:3002 - the first visit walks you through creating the owner account.

## Checks

Run these before opening a PR (CI runs the same):

```bash
# backend
cd baton && npm run typecheck && npm test

# frontend
cd baton-front && npx tsc -b && npm test && npm run build
```

## Adding a platform connector

The connector interface is Baton's main extension surface:

1. Implement `PlatformConnector` (`baton/src/services/connectors/platform-connector.interface.ts`) - webhook signature verification is the part that matters most; OAuth methods can throw for webhook-only platforms.
2. Register it in `baton/src/services/connectors/index.ts`.
3. Add a catalog template in `baton/src/lib/app-catalog.ts` (wizard copy, setup steps, event types).
4. Add the platform to the `Platform`/`AppSlug` unions in `baton/src/lib/types.ts` and the docs enum in `baton/src/docs/schemas/common.ts`.
5. Write a connector unit test (see `baton/src/tests/connectors/` for the pattern) - connectors without signature-verification tests are not merged.
6. Frontend: icon in `PlatformIcon.tsx`, label in `lib/utils.ts`, and a row in the docs catalog page.

## Ground rules

- TypeScript strict; match the style of neighboring code.
- Every behavioral change needs a test.
- Changing a DynamoDB table or index? Edit `baton/src/db/table-definitions.ts`, then run `npm run infra:generate` to keep the CloudFormation template in sync (never edit `infrastructure/dynamodb.yml` by hand).
- Webhook verification must fail closed - never merge a connector that accepts unverified payloads (platforms that genuinely cannot sign use the documented URL-secrecy model).
- Do not copy code from other projects with incompatible licenses.
- By contributing, you agree that your contributions are licensed under this repository's [Sustainable Use License](LICENSE.md).

## Questions

Open a GitHub Discussion/Issue, or email app-support@fluidlabs.com.

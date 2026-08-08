# Docker Compose Setup (local evaluation stack)

This guide explains how to run the full Baton stack locally using Docker Compose with free local emulators for DynamoDB and SQS - no AWS account, no license keys. Table data is persisted in a Docker named volume and survives container restarts.

## Services

| Service | Description | Port |
|---------|-------------|------|
| `dynamodb` | DynamoDB Local (Amazon's official emulator) | 8000 |
| `elasticmq` | ElasticMQ - SQS-compatible queue emulator | 9324 |
| `baton-api` | Express.js backend | 3001 (internal) |
| `baton-front` | React SPA + Nginx | 80 |

## First-Time Setup

### 1. Create the backend `.env` and generate secrets

```bash
cp baton/.env.example baton/.env

# generate the two secrets Baton needs and paste the values into baton/.env
# as TOKEN_ENCRYPTION_KEY and AUTH_JWT_SECRET
openssl rand -hex 32
openssl rand -hex 32
```

The `.env.example` defaults already point DynamoDB and SQS at the local emulators (`http://localhost:8000` / `http://localhost:9324`), so nothing else is required to start.

### 2. Start all containers

```bash
docker compose up -d          # pulls the published images
# or build from source:
docker compose up -d --build
```

To pin a specific release, set `BATON_VERSION` in a root-level `.env` next to `docker-compose.yml` (e.g. `BATON_VERSION=1.0.0`) - see the [releases page](https://github.com/docufluidlabs/baton-core/releases).

Compose waits for DynamoDB Local to be healthy, then the API creates all 21 DynamoDB tables and 6 SQS queues automatically on first boot (retrying briefly while the emulators finish starting) - no host-side Node/npm required.

That's it. The app is now running at `http://localhost` - the first visit walks you through the `/setup` screen, which creates your organization and owner account (no external auth service involved). Alternatively, seed the owner headlessly with `npm run seed` (set `BATON_OWNER_EMAIL` / `BATON_OWNER_PASSWORD`).

## Subsequent Starts

Data is persisted in the volume; existing tables and queues are detected and skipped on boot:

```bash
docker compose up -d
```

## Updating to a New Release

```bash
# bump BATON_VERSION in the root .env, then:
docker compose pull && docker compose up -d
```

Your data and `baton/.env` are untouched; any tables/queues added by the new version are created automatically on boot.

## Stopping

**Stop containers (data is preserved):**
```bash
docker compose down
```

**Stop containers and delete all data:**
```bash
docker compose down -v
```

## Reset Everything (start fresh)

```bash
docker compose down -v          # removes the volume with all data
docker compose up -d            # start fresh - tables/queues are re-created on boot
```

## Verify the Emulators are Running

```bash
docker compose ps                                                    # dynamodb should be "healthy"
aws --endpoint-url=http://localhost:8000 dynamodb list-tables --region us-east-1
aws --endpoint-url=http://localhost:9324 sqs list-queues --region us-east-1
```

> Requires [AWS CLI](https://aws.amazon.com/cli/) installed. Credentials can be anything (the emulators don't validate them).

## How Persistence Works

DynamoDB Local runs with `-sharedDb -dbPath /data`, and `/data` is a Docker named volume (`dynamodb-data`), so **table data** survives:

- `docker compose down` / `up`
- Container crashes or restarts
- Host machine reboots

Data is only lost when you explicitly run `docker compose down -v` (the `-v` flag removes volumes).

ElasticMQ is in-memory: queues are re-created automatically on every boot, but **in-flight queue messages are not retained** across restarts. For evaluation this is harmless (events are stored in DynamoDB before queueing); production uses real SQS.

## Notes

- The `baton-api` container overrides `DYNAMODB_ENDPOINT`/`SQS_ENDPOINT` to the internal service names (`http://dynamodb:8000`, `http://elasticmq:9324`). The `baton/.env` file retains `localhost` endpoints for running the API outside Docker.
- The `baton-front` container does **not** expose the API directly - Nginx proxies `/api` requests to `baton-api`.

# Docker Compose Setup (with Persistent LocalStack)

This guide explains how to run the full Baton stack locally using Docker Compose with LocalStack for DynamoDB and SQS. Data is persisted in a Docker named volume and survives container restarts.

## Services

| Service | Description | Port |
|---------|-------------|------|
| `localstack` | AWS services emulator (DynamoDB, SQS) | 4566 |
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

The `.env.example` defaults already point DynamoDB and SQS at LocalStack (`http://localhost:4566`), so nothing else is required to start.

### 2. Build and start all containers

```bash
docker compose up -d --build
```

### 3. Wait ~5 seconds for LocalStack to initialize, then create tables and queues

```bash
cd baton && npm install && npm run setup
```

This runs `db:create-tables` + `sqs:create-queues` - creates all 18 DynamoDB tables and 6 SQS queues in LocalStack.

That's it. The app is now running at `http://localhost` - the first visit walks you through the `/setup` screen, which creates your organization and owner account (no external auth service involved). Alternatively, seed the owner headlessly with `npm run seed` (set `BATON_OWNER_EMAIL` / `BATON_OWNER_PASSWORD`).

## Subsequent Starts

On the next run, data is already persisted in the volume - no need to run `setup` again:

```bash
docker compose up -d
```

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
docker compose up -d --build    # rebuild and start
cd baton && npm run setup       # re-initialize tables and queues
```

## Verify LocalStack is Running

```bash
curl http://localhost:4566/_localstack/health
```

**List DynamoDB tables:**
```bash
aws --endpoint-url=http://localhost:4566 dynamodb list-tables --region us-east-1
```

> Requires [AWS CLI](https://aws.amazon.com/cli/) installed. Credentials can be anything (LocalStack doesn't validate them).

## How Persistence Works

LocalStack is configured with `PERSISTENCE: 1`, which saves all state to `/var/lib/localstack` inside the container. This directory is mounted to a Docker named volume (`localstack-data`), so data survives:

- `docker compose down` / `up`
- Container crashes or restarts
- Host machine reboots

Data is only lost when you explicitly run `docker compose down -v` (the `-v` flag removes volumes).

## Notes

- The `baton-api` container overrides `DYNAMODB_ENDPOINT` and `SQS_ENDPOINT` to `http://localstack:4566` (internal Docker network). The `baton/.env` file retains `localhost:4566` for running the API outside Docker.
- The `baton-front` container does **not** expose the API directly - Nginx proxies `/api` requests to `baton-api`.

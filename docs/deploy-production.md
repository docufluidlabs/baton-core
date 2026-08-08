# Production Deployment (Real AWS)

This guide takes Baton from the LocalStack quickstart to a production deployment in **your own AWS account**: CloudFormation-managed tables and queues, pinned container images, TLS in front, backups on. Nothing in this setup sends data outside your environment - Baton makes no third-party calls beyond the platforms you connect (see [security-review.md](security-review.md)).

**Shape:** the two containers (API + frontend) run on any Docker host - a single EC2 VM is enough to start - while state lives in DynamoDB and SQS in your AWS account. Scale out later by running more API containers behind your load balancer (set `SCHEDULER_ENABLED=false` on the extras).

> ⚠️ **LocalStack is for evaluation only.** The quickstart `docker-compose.yml` stores everything in a LocalStack container volume. Never run production on it.

## Prerequisites

- An AWS account + [AWS CLI v2](https://aws.amazon.com/cli/) configured with rights to run CloudFormation
- A Docker host (EC2, ECS, or on-prem) with Docker Compose
- A public domain with TLS - terminated by your reverse proxy or load balancer
- A Docusign account with **Workflow Builder** enabled (production or demo)
- Pick your AWS region once and use it everywhere - e.g. `ca-central-1` keeps all data in Canada

## 1. Create the AWS infrastructure (CloudFormation)

```bash
cd baton/infrastructure
./deploy-infrastructure.sh production ca-central-1   # environment + region
```

This deploys four stacks:

| Stack | Contents |
|-------|----------|
| `baton-dynamodb-production` | All **21 tables** (on-demand billing, KMS encryption, PITR backups, TTL on `oauth-states`/`bootstrap-tokens`). Generated from the app's own schema - never drifts. |
| `baton-sqs-production` | All **6 queues** + dead-letter queues (14-day retention, redrive after 3 failures) |
| `baton-secrets-production` | Secrets Manager entry for integration credentials (optional to use) |
| `baton-iam-production` | Least-privilege roles: DynamoDB/SQS access scoped to `baton-*` resources; **no `CreateTable`** - the app never needs it in production |

Verify:

```bash
aws dynamodb list-tables --region ca-central-1 --output table
aws sqs list-queues --queue-name-prefix baton- --region ca-central-1
```

> The table/index schema is generated from `baton/src/db/table-definitions.ts` (`npm run infra:generate`). If the app ever boots against a table set that's missing something (e.g. after skipping an upgrade's infra step), it fails fast at startup with the missing table's name.

## 2. Configure the environment

```bash
cp baton/.env.example baton/.env
```

Production values that differ from the quickstart defaults:

| Variable | Production value |
|----------|-----------------|
| `NODE_ENV` | `production` (turns on boot validation + Secure cookies) |
| `APP_URL` / `API_URL` / `FRONTEND_URL` | Your public HTTPS URL, e.g. `https://baton.yourcompany.com` (webhook URLs are generated from this) |
| `AWS_REGION` / `DYNAMODB_REGION` / `SQS_REGION` | Your region, e.g. `ca-central-1` |
| `DYNAMODB_ENDPOINT` / `SQS_ENDPOINT` | **Empty** - real AWS (the prod compose file forces these empty as a belt-and-braces) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Leave **empty** on EC2/ECS with an instance role (recommended); otherwise an IAM user scoped to the `baton-iam-production` policies |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` - encrypts stored credentials (AES-256-GCM) |
| `AUTH_JWT_SECRET` | `openssl rand -hex 32` - signs session cookies |
| `DOCUSIGN_OAUTH_BASE` | `https://account.docusign.com` for production Docusign (`account-d` = demo) |
| `DOCUSIGN_MAESTRO_API_BASE` | `https://api.docusign.com` for production (`api-d` = demo) |
| `DOCUSIGN_*` credentials | From your Docusign app - the in-app **Connections → Docusign** guided setup walks through every field |

Keep both generated secrets in your secret manager. Rotating `AUTH_JWT_SECRET` logs everyone out; rotating `TOKEN_ENCRYPTION_KEY` invalidates stored platform credentials (reconnect required) - plan rotations deliberately.

**Fail-fast:** with `NODE_ENV=production` the API refuses to start if `TOKEN_ENCRYPTION_KEY` or `AUTH_JWT_SECRET` are missing/short or `FRONTEND_URL` is not a valid URL, and it fails at startup if any DynamoDB table or SQS queue is missing - misconfiguration surfaces in seconds, not on the first webhook.

## 3. Run the containers

```bash
echo "BATON_VERSION=1.0.0" > .env    # pin the release you deploy (see /releases)
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps    # both services healthy?
```

First-run owner account, two options:

- **UI:** open `https://baton.yourcompany.com` - the first visit walks through the `/setup` screen (it locks itself once completed).
- **Headless:** set `BATON_OWNER_EMAIL`, `BATON_OWNER_PASSWORD` (plus optional `BATON_ORG_NAME`, `BATON_OWNER_NAME`) in `baton/.env` **before** the first `up -d` - the server seeds the organization and owner on boot, idempotently. Remove the password from the file afterwards if your policy requires it; the account persists.

> While the repository is private, `docker compose pull` needs a login first: `docker login ghcr.io -u <github-user>` with a token that has `read:packages`.

## 4. TLS / reverse proxy

Terminate TLS at your proxy or load balancer and forward to the frontend container (port 80). The frontend's nginx serves the SPA and proxies `/api` to the API container internally. Minimal host-nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name baton.yourcompany.com;

    ssl_certificate     /etc/letsencrypt/live/baton.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/baton.yourcompany.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;        # baton-front (bind it to 127.0.0.1:8080:80)
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;                      # keep SSE/streaming responses live
        proxy_read_timeout 120s;
    }
}
```

On AWS, an **ALB** with an ACM certificate targeting the frontend port works identically (set idle timeout ≥ 120s for streaming).

Because `FRONTEND_URL` is `https://…`, session cookies are automatically `Secure`; HSTS and the other security headers ship in the frontend's nginx config.

## 5. Wire up webhooks and Docusign

1. **Docusign app:** in-app **Connections → Docusign** has the field-by-field guide (integration key, secret, RSA keypair, redirect URI - which must be your public `API_URL`, not localhost; the UI warns if it isn't). Set the Connect HMAC key (`DOCUSIGN_CONNECT_HMAC_KEY`) so workflow status callbacks are signature-verified.
2. **Source platforms:** each platform's setup lives in the in-app docs and [the per-platform guides](./) - webhook URLs are generated from `APP_URL` and every source is verified (HMAC or Basic Auth, failing closed).
3. **Quick win with zero webhook plumbing:** Bulk Upload (CSV/XLSX → workflow per row) works the moment Docusign is connected.

## 6. Operations

- **Backups:** PITR is enabled on every table by the CloudFormation stack (35-day window). Restore with `aws dynamodb restore-table-to-point-in-time`. Test the runbook once before go-live.
- **Logs:** both containers log JSON to stdout (API: Pino). Ship them with your Docker logging driver (`awslogs` for CloudWatch: add `logging:` to the compose services).
- **Health:** `GET /health` on both containers (compose healthchecks poll them; point your uptime monitoring at `https://…/health` and `https://…/api/health`).
- **Rate limiting:** `RATE_LIMIT_PER_MINUTE` (default 300 req/min/IP on authenticated APIs). If your proxy is the only client IP the API sees, make sure `X-Forwarded-For` is passed (the examples above do).
- **Scaling out:** run additional `baton-api` containers with `SCHEDULER_ENABLED=false` to avoid duplicate cron jobs; SQS consumers coordinate safely by design.
- **Upgrades:** see [UPGRADING.md](../UPGRADING.md) - bump `BATON_VERSION`, `pull`, `up -d`; read the release notes for anything marked breaking.

## Data residency

Everything stateful lives in the AWS region you chose (`ca-central-1` example above keeps all customer data in Canada): DynamoDB, SQS, logs if you ship to CloudWatch in-region. Outbound traffic goes only to the platforms you explicitly connect (Docusign, Salesforce, …). There is no telemetry, no analytics, and no phone-home in the self-hosted build - see [security-review.md](security-review.md) for the full outbound-connection inventory.

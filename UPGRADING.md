# Upgrading Baton

## Version policy

Releases follow [semver](https://semver.org) - `MAJOR.MINOR.PATCH`:

| Bump | Meaning | Action needed |
|------|---------|---------------|
| **Patch** (1.0.x) | Bug fixes | None - just update |
| **Minor** (1.x.0) | Backward-compatible features; new connectors land here | None - just update; read the notes for new options |
| **Major** (x.0.0) | Something requires your action | Follow the version's section below **before** updating |

Every release ships notes on the [releases page](https://github.com/docufluidlabs/baton-core/releases) and an entry in [CHANGELOG.md](CHANGELOG.md). Anything breaking is called out at the top of the notes. Recommended cadence for self-hosters: update at least monthly so you never jump many versions at once.

## Standard upgrade (any patch/minor)

Your data lives in DynamoDB (or the local `dynamodb-data` volume) and your config in `baton/.env` - upgrades replace only the running code.

```bash
# 1. Pin the new version (root-level .env next to the compose file)
sed -i 's/^BATON_VERSION=.*/BATON_VERSION=1.0.2/' .env   # or edit by hand

# 2. Pull and roll
docker compose pull && docker compose up -d               # quickstart (local emulators)
# docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

**Schema changes are handled automatically or fail loudly - never silently.** On boot the API verifies every table and queue:

- **Local emulators (quickstart):** anything missing is created automatically, TTL included.
- **Real AWS:** infrastructure is CloudFormation-managed, so when a release adds tables/queues (the notes will say so), re-run the stack first - it only adds what's new:

  ```bash
  cd baton/infrastructure && ./deploy-infrastructure.sh production <region>
  ```

  If you skip this, the new version fails fast at startup naming the missing resource - it will not half-run.

## Rollback

Within the same minor series, repoint and restart:

```bash
sed -i 's/^BATON_VERSION=.*/BATON_VERSION=1.0.1/' .env
docker compose pull && docker compose up -d
```

Data written by a newer version stays in place (DynamoDB is schemaless; older code ignores attributes it doesn't know). Rolling back across a **major** boundary is not supported - restore from PITR backups instead if you must.

A rollback also takes back the security fixes of the release you leave, so treat it as temporary and move forward again once the cause is resolved.

## Building from source instead

Contributors and air-gapped installs can always build the same tag themselves:

```bash
git fetch --tags && git checkout v1.0.2
docker compose up -d --build
```

## Version notes

Patch and minor releases need no action as a rule. These are the exceptions.

### 1.0.2

**Zoho CRM and Power Automate: check that your flows send their credentials.** Automation URLs (`/api/webhooks/rule/<key>`) now check the Basic auth username and password, as the per-app URL always has. A flow that was set up without them gets `401 Missing Authorization header`, and the delivery shows as failed on the sending side. Set the same username and password on the flow that you entered in Baton (Flow Builder, the automation, **Basic Auth Credentials**). Flows set up as the guides describe are not affected. After updating, send one test event per Zoho CRM or Power Automate automation and confirm it arrives.

**Stored webhook events.** New events are stored with credential headers masked, and the nightly cleanup (03:00 UTC) masks them in events stored by earlier versions - up to 20,000 events per night, so most installs are done after the first run. No action is needed. If your events table or its backups are readable more widely than your webhook credentials should be, rotate those credentials: choose a new password or token in Baton and set the same value on the sending side.

## Major versions

*(none yet - v1 is current)*

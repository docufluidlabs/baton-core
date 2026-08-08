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
sed -i 's/^BATON_VERSION=.*/BATON_VERSION=1.1.0/' .env   # or edit by hand

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
sed -i 's/^BATON_VERSION=.*/BATON_VERSION=1.0.0/' .env
docker compose pull && docker compose up -d
```

Data written by a newer version stays in place (DynamoDB is schemaless; older code ignores attributes it doesn't know). Rolling back across a **major** boundary is not supported - restore from PITR backups instead if you must.

## Building from source instead

Contributors and air-gapped installs can always build the same tag themselves:

```bash
git fetch --tags && git checkout v1.1.0
docker compose up -d --build
```

## Major versions

*(none yet - v1 is current)*

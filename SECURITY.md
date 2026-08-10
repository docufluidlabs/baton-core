# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately - do **not** open a public GitHub issue.

Email **app-support@fluidlabs.com** with:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept helps enormously)
- The commit or version you tested against

We aim to acknowledge reports within 3 business days. Please give us a reasonable window to ship a fix before any public disclosure - we will credit you in the release notes unless you prefer otherwise.

## Scope

- The `baton/` API server and `baton-front/` web app in this repository
- The default `docker-compose.yml` deployment path

Out of scope: Fluidlabs' hosted Baton service (report those to the same address, but they are handled under the hosted service's own process), third-party platforms Baton connects to, and vulnerabilities requiring an already-compromised host.

## Hardening notes for self-hosters

- Set strong values for `TOKEN_ENCRYPTION_KEY` and `AUTH_JWT_SECRET` (32+ chars; `openssl rand -hex 32`).
- Run behind TLS. Session cookies are marked `Secure` when `FRONTEND_URL` is https.
- Webhook endpoints verify provider signatures (HMAC/Basic Auth) and fail closed; keep per-automation secrets long and random.

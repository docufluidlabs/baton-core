/**
 * Inbound webhook endpoints — documentation only.
 *
 * These endpoints are fired by external providers (Salesforce, HubSpot, Stripe, etc.)
 * with provider-specific signature verification. They accept raw JSON bodies, NOT
 * the JSON-parsed shapes Try-It-Out would send, so the UI's Try-It-Out button is
 * disabled for this tag via `customCss` in `server.ts`.
 *
 * Goal: visibility of payload shapes, signature headers, and response codes —
 * not interactive testing.
 */
import { z } from 'zod';
import { registry } from '../registry';
import {
  GenericWebhookPayload,
  SfWebhookRegistrationInput,
  SfWebhookRegistrationResponse,
} from '../schemas/inbound';

const TAG = 'Inbound Webhooks';

const genericBody = {
  content: { 'application/json': { schema: GenericWebhookPayload } },
};

// ─── Provider webhooks (per-provider signature verification) ──

type ProviderSpec = {
  path: string;
  provider: string;
  description: string;
  headers: z.ZodObject<any>;
};

const providerWebhooks: ProviderSpec[] = [
  {
    path: '/api/webhooks/salesforce',
    provider: 'Salesforce',
    description: 'Generic Salesforce platform events. Verified via the connection\'s `webhookSecret`.',
    headers: z.object({
      'x-baton-signature': z.string().optional(),
    }),
  },
  {
    path: '/api/webhooks/hubspot',
    provider: 'HubSpot',
    description: 'HubSpot CRM events. Verified via `X-HubSpot-Signature-v3`.',
    headers: z.object({
      'x-hubspot-signature-v3': z.string().openapi({ description: 'HubSpot v3 signature.' }),
      'x-hubspot-request-timestamp': z.string().optional(),
    }),
  },
  {
    path: '/api/webhooks/zohocrm',
    provider: 'Zoho CRM',
    description: 'Zoho CRM module notifications. Zoho does not sign; identity is established via the per-connection capability token in the URL.',
    headers: z.object({}),
  },
  {
    path: '/api/webhooks/bamboohr',
    provider: 'BambooHR',
    description: 'BambooHR HR events. Verified via per-connection secret.',
    headers: z.object({}),
  },
  {
    path: '/api/webhooks/docusign',
    provider: 'DocuSign Connect',
    description: 'DocuSign Connect envelope status updates. Verified via HMAC-SHA256.',
    headers: z.object({
      'x-docusign-signature-1': z.string().openapi({ description: 'DocuSign Connect signature.' }),
    }),
  },
];

for (const p of providerWebhooks) {
  registry.registerPath({
    method: 'post',
    path: p.path,
    tags: [TAG],
    summary: `${p.provider} → Baton (signed)`,
    description:
      `${p.description}\n\n` +
      `**Try-It-Out is disabled** — this endpoint expects a signed raw-body payload from ${p.provider}. ` +
      `Documentation is for reference only.`,
    request: {
      headers: p.headers,
      body: genericBody,
    },
    responses: {
      200: { description: 'Accepted and queued for processing' },
      400: { description: 'Invalid payload' },
      401: { description: 'Signature verification failed' },
      404: { description: 'Connection not found for this key/signature' },
    },
  });
}

// ─── Capability-token webhooks (URL carries the auth) ────────

const hmacSignatureHeader = z.object({
  'x-signature': z.string().openapi({ description: 'HMAC-SHA256 of the raw request body, hex-encoded.' }),
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/app/{webhookKey}',
  tags: [TAG],
  summary: 'Installed-platform webhook (HMAC-signed)',
  description:
    'Generic catchall for installed platforms (Apps catalog). The `webhookKey` in the URL identifies ' +
    'the org and platform; the signature header is verified against the encrypted `secretKeyEnc` stored ' +
    'on the `OrgApp` record.\n\n' +
    '**Try-It-Out is disabled** — endpoint expects a signed raw-body payload.',
  request: {
    params: z.object({
      webhookKey: z.string().length(64).openapi({ description: 'Per-app capability token.' }),
    }),
    headers: hmacSignatureHeader,
    body: genericBody,
  },
  responses: {
    200: { description: 'Accepted' },
    400: { description: 'Invalid body' },
    401: { description: 'Signature mismatch' },
    403: { description: 'Inactive app' },
    404: { description: 'webhookKey not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/rule/{webhookKey}',
  tags: [TAG],
  summary: 'Per-automation webhook (HMAC-signed)',
  description:
    'Dispatch endpoint for a single automation rule. Identified by the rule\'s `webhookKey`. ' +
    'Supports the `?bootstrap=<tokenId>` query param for the Salesforce managed package\'s first-call ' +
    'auto-registration flow.\n\n' +
    '**Try-It-Out is disabled** — endpoint expects a signed raw-body payload.',
  request: {
    params: z.object({
      webhookKey: z.string().length(64).openapi({ description: 'Per-automation capability token.' }),
    }),
    query: z.object({
      bootstrap: z.string().optional().openapi({
        description: 'One-time bootstrap token (SF managed package) — exchanged for a persisted HMAC secret.',
      }),
    }),
    headers: hmacSignatureHeader,
    body: genericBody,
  },
  responses: {
    200: { description: 'Accepted' },
    400: { description: 'Invalid body' },
    401: { description: 'Signature mismatch / bootstrap token invalid' },
    404: { description: 'webhookKey not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/postwebhook/{orgId}/{endpointId}',
  tags: [TAG],
  summary: 'Custom webhook endpoint (optional API key)',
  description:
    'User-defined webhook destination created via `POST /api/webhook-endpoints`. If the endpoint has an ' +
    '`apiKey`, requests must include it in the `X-API-Key` header.\n\n' +
    '**Try-It-Out is disabled** — endpoint expects a raw JSON body matching the configured payload shape.',
  request: {
    params: z.object({
      orgId: z.string(),
      endpointId: z.string().uuid(),
    }),
    headers: z.object({
      'x-api-key': z.string().optional().openapi({
        description: 'Required if the endpoint was configured with an API key.',
      }),
    }),
    body: genericBody,
  },
  responses: {
    200: { description: 'Accepted' },
    400: { description: 'Invalid body' },
    401: { description: 'Missing or invalid API key' },
    403: { description: 'Endpoint disabled' },
    404: { description: 'Endpoint not found' },
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/stripe',
  tags: [TAG],
  summary: 'Stripe webhook (billing events)',
  description:
    'Stripe Checkout / subscription / invoice / meter events. Verified via the Stripe-provided ' +
    '`Stripe-Signature` header.\n\n' +
    '**Try-It-Out is disabled** — endpoint expects a signed raw-body payload.',
  request: {
    headers: z.object({
      'stripe-signature': z.string().openapi({ description: 'Stripe signature header (`t=…,v1=…`).' }),
    }),
    body: genericBody,
  },
  responses: {
    200: { description: 'Accepted' },
    400: { description: 'Invalid signature or body' },
  },
});

// ─── Slack public endpoints ──────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/slack/events',
  tags: [TAG],
  summary: 'Slack Events API (signed by Slack)',
  description:
    'Receives Slack `event_callback`, `url_verification`, and `app_uninstalled` events. ' +
    'Verified via the Slack signing secret.\n\n' +
    '**Try-It-Out is disabled** — endpoint expects a Slack-signed raw-body payload.',
  request: {
    headers: z.object({
      'x-slack-request-timestamp': z.string(),
      'x-slack-signature': z.string(),
    }),
    body: genericBody,
  },
  responses: {
    200: { description: 'Accepted (or url_verification challenge response)' },
    401: { description: 'Missing or invalid signature' },
    500: { description: 'SLACK_SIGNING_SECRET not configured' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/slack/install',
  tags: [TAG],
  summary: 'Slack Direct Install (302 → slack.com)',
  description:
    'Public install URL that Slack validates by following the redirect. Returns 302 to ' +
    'Slack\'s OAuth consent screen.\n\n' +
    '**Try-It-Out is disabled** — this is a redirect endpoint, not an API call.',
  responses: {
    302: { description: 'Redirect to Slack OAuth consent screen' },
    500: { description: 'SLACK_CLIENT_ID not configured' },
  },
});

// ─── Salesforce bootstrap registration ───────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/salesforce/webhook-registrations',
  tags: [TAG],
  summary: 'SF managed-package bootstrap registration (no session auth)',
  description:
    'Called by the Salesforce managed package (Apex `BatonDispatcher`) on its first webhook dispatch. ' +
    'Exchanges a one-time `bootstrapToken` for a persisted HMAC secret keyed by `sfOrgId`. ' +
    'Idempotent — replays with the same `Idempotency-Key` return the original response.\n\n' +
    '**Try-It-Out is disabled** — intended only for the managed-package Apex client.',
  request: {
    headers: z.object({
      'idempotency-key': z.string().min(8).max(256).openapi({
        description: 'Opaque string, typically `<sfOrgId>_<webhookKey>_<bootstrapToken>`.',
      }),
    }),
    body: { content: { 'application/json': { schema: SfWebhookRegistrationInput } } },
  },
  responses: {
    200: {
      description: 'Registered (or idempotent replay)',
      content: { 'application/json': { schema: SfWebhookRegistrationResponse } },
    },
    400: { description: 'Validation error' },
    401: { description: 'Bootstrap token expired or webhookKey mismatch' },
    404: { description: 'Bootstrap token / webhookKey not found' },
    409: { description: 'Token already redeemed by a different request' },
  },
});

import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry';
import env from '../env';

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Baton API',
      version: '1.0.0',
      description:
        'Workflow orchestration platform — internal API.\n\n' +
        'Authentication is handled by Clerk: send the session JWT as `Authorization: Bearer <token>` ' +
        '(or rely on the `__session` cookie if calling from the embedded frontend).\n\n' +
        'Webhook endpoints (`/api/webhooks/*`, `/api/postwebhook`, `/api/slack/events`, ' +
        '`/api/salesforce/webhook-registrations`) are intentionally excluded — they accept raw bodies ' +
        'and are authenticated via provider-specific signature schemes, not Clerk.',
    },
    servers: [
      { url: env.API_URL, description: env.NODE_ENV },
      { url: 'http://localhost:3001', description: 'local' },
    ],
    tags: [
      { name: 'Health', description: 'Liveness probes (no auth)' },
      { name: 'Auth', description: 'Session info, role checks' },
      { name: 'Workflows', description: 'Maestro workflow definitions — sync, CRUD, manual launch' },
      { name: 'Instances', description: 'Workflow execution instances and history' },
      { name: 'Automations', description: 'Automation rules (CRUD + analytics)' },
      { name: 'Events', description: 'Inbound event log and filters' },
      { name: 'Dashboard', description: 'Org-level aggregate metrics' },
      { name: 'Notifications', description: 'In-app and email notifications' },
      { name: 'User Activity', description: 'Per-user activity log' },
      { name: 'Settings', description: 'Org and user preferences, billing, members' },
      { name: 'Platforms', description: 'Platform catalog and validation' },
      { name: 'Connections', description: 'OAuth connection state for external platforms' },
      { name: 'Webhook Endpoints', description: 'Org-owned outbound webhook destinations' },
      { name: 'Slack', description: 'Slack configuration for the org' },
      { name: 'Support', description: 'Support tickets and feedback' },
      { name: 'Flow Layout', description: 'Persisted graph layout for workflow editor' },
      { name: 'Salesforce', description: 'Salesforce managed-package bootstrap and rotation' },
      {
        name: 'Inbound Webhooks',
        description:
          'Provider-fired webhooks (Salesforce, HubSpot, Stripe, Slack, etc.) and bootstrap registration. ' +
          'Documented for reference only — Try-It-Out is disabled because these endpoints require ' +
          'provider-specific signatures over the exact raw request body.',
      },
    ],
  });
}

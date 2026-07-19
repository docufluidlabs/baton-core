import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  AutomationSchema,
  CreateAutomationInput,
  UpdateAutomationInput,
  PreflightInput,
} from '../schemas/automation';
import { MessageResponse, PlatformSlug } from '../schemas/common';

const TAG = 'Automations';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid() });

// CRUD endpoints (from src/routes/rules.ts) ---------------------------------

registry.registerPath({
  method: 'post',
  path: '/api/automations/preflight',
  tags: [TAG],
  summary: 'Pre-generate a webhook URL for a new automation',
  description: 'Returns a `webhookKey` + URL ready to paste into the source platform. For Salesforce, a bootstrap token is appended.',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: PreflightInput } } } },
  responses: {
    200: {
      description: 'Webhook key + URL',
      content: { 'application/json': { schema: z.object({ webhookKey: z.string(), webhookUrl: z.string().url() }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations',
  tags: [TAG],
  summary: 'List active automations for the org',
  security: SECURITY,
  responses: {
    200: {
      description: 'List',
      content: { 'application/json': { schema: z.object({ automations: z.array(AutomationSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/event-types/{platform}',
  tags: [TAG],
  summary: 'List event types supported by a platform',
  security: SECURITY,
  request: { params: z.object({ platform: PlatformSlug }) },
  responses: {
    200: {
      description: 'Event types',
      content: { 'application/json': { schema: z.object({ eventTypes: z.array(z.any()) }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/{id}',
  tags: [TAG],
  summary: 'Get automation details',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Automation',
      content: { 'application/json': { schema: z.object({ automation: AutomationSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/automations',
  tags: [TAG],
  summary: 'Create an automation',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: CreateAutomationInput } } } },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: z.object({ automation: AutomationSchema }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/automations/{id}',
  tags: [TAG],
  summary: 'Update automation fields',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateAutomationInput } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ automation: AutomationSchema.nullable() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/automations/{id}',
  tags: [TAG],
  summary: 'Soft-delete an automation',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/automations/{id}/pause',
  tags: [TAG],
  summary: 'Pause an automation (queues incoming webhooks)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Paused',
      content: { 'application/json': { schema: z.object({ message: z.string(), id: z.string(), status: z.literal('paused') }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/automations/{id}/resume',
  tags: [TAG],
  summary: 'Resume an automation and release queued webhooks',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Resumed',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            id: z.string(),
            status: z.literal('active'),
            released: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/{id}/queue',
  tags: [TAG],
  summary: 'List queued webhooks for a paused automation',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Queued items',
      content: { 'application/json': { schema: z.object({ items: z.array(z.any()), count: z.number().int() }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/automations/{id}/queue/{itemId}/release',
  tags: [TAG],
  summary: 'Release a single queued webhook',
  security: SECURITY,
  request: { params: z.object({ id: z.string().uuid(), itemId: z.string() }) },
  responses: {
    200: { description: 'Released', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/automations/{id}/queue/{itemId}',
  tags: [TAG],
  summary: 'Cancel a single queued webhook',
  security: SECURITY,
  request: { params: z.object({ id: z.string().uuid(), itemId: z.string() }) },
  responses: {
    200: { description: 'Cancelled', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/{id}/history',
  tags: [TAG],
  summary: 'Trigger history for an automation',
  security: SECURITY,
  request: {
    params: idParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional().openapi({ default: 50 }),
    }),
  },
  responses: {
    200: {
      description: 'History',
      content: { 'application/json': { schema: z.object({ history: z.array(z.any()) }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/{id}/webhooks',
  tags: [TAG],
  summary: 'Raw webhook events delivered for this automation',
  security: SECURITY,
  request: {
    params: idParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
  },
  responses: {
    200: {
      description: 'Webhook events',
      content: { 'application/json': { schema: z.object({ webhooks: z.array(z.any()) }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/{id}/actions',
  tags: [TAG],
  summary: 'Unified action list (rule matches joined with webhook events + instances)',
  security: SECURITY,
  request: {
    params: idParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
  },
  responses: {
    200: {
      description: 'Actions',
      content: { 'application/json': { schema: z.object({ actions: z.array(z.any()) }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/automations/{id}/resolve-failures',
  tags: [TAG],
  summary: 'Mark all failed instances for this automation as resolved (one-off admin op)',
  description: 'Temporary endpoint intended for a one-time prod fix; expected to be removed.',
  deprecated: true,
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Resolved',
      content: { 'application/json': { schema: z.object({ resolved: z.number().int() }) } },
    },
    401: commonErrorResponses[401],
  },
});

// Analytics endpoints (from src/routes/automations.ts) ----------------------

registry.registerPath({
  method: 'get',
  path: '/api/automations/metrics',
  tags: [TAG],
  summary: 'Last-24h pipeline performance metrics',
  security: SECURITY,
  responses: {
    200: {
      description: 'Metrics',
      content: {
        'application/json': {
          schema: z.object({
            events24h: z.number().int(),
            completed: z.number().int(),
            failed: z.number().int(),
            pending: z.number().int(),
            automationMatchRate: z.number().int(),
            avgLatencyMs: z.number().int(),
            p95LatencyMs: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/delivery-health',
  tags: [TAG],
  summary: 'Per-platform delivery health summary',
  security: SECURITY,
  responses: {
    200: {
      description: 'Health',
      content: {
        'application/json': {
          schema: z.object({
            platforms: z.array(
              z.object({
                platform: PlatformSlug,
                displayName: z.string(),
                connectionStatus: z.string(),
                automationsTotal: z.number().int(),
                automationsActive: z.number().int(),
                automationsError: z.number().int(),
                totalTriggers: z.number().int(),
                successRate: z.number().int(),
                lastWebhookAt: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/automations/rule-insights',
  tags: [TAG],
  summary: 'Top + problematic automations',
  security: SECURITY,
  responses: {
    200: {
      description: 'Insights',
      content: {
        'application/json': {
          schema: z.object({
            topAutomations: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                platform: z.string(),
                triggerCount: z.number().int(),
                successRate: z.number(),
                status: z.string(),
              }),
            ),
            problemAutomations: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                platform: z.string(),
                status: z.string(),
                successRate: z.number(),
                lastError: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

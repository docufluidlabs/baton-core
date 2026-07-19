import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import { PlatformSlug } from '../schemas/common';

const TAG = 'Events';
const SECURITY = [{ bearerAuth: [] }];

const eventCategoryEnum = z.enum(['inbound', 'rule_match', 'workflow', 'envelope']);
const pipelineStatusEnum = z.enum(['pending', 'running', 'retrying', 'completed', 'failed', 'skipped']);
const eventListResponse = z.object({
  events: z.array(z.record(z.any())),
  count: z.number().int(),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullable().optional(),
});

registry.registerPath({
  method: 'get',
  path: '/api/events',
  tags: [TAG],
  summary: 'List trigger-pipeline events (paginated)',
  security: SECURITY,
  request: {
    query: z.object({
      include_unmatched: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 50 }),
      category: eventCategoryEnum.optional(),
      status: pipelineStatusEnum.optional(),
      platform: PlatformSlug.optional(),
      cursor: z.string().optional().openapi({ description: 'Opaque base64url cursor from a previous response.' }),
    }),
  },
  responses: {
    200: { description: 'Events', content: { 'application/json': { schema: eventListResponse } } },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/user/{userId}',
  tags: [TAG],
  summary: 'Events attributed to a specific user',
  security: SECURITY,
  request: {
    params: z.object({ userId: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 30 }),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'Events', content: { 'application/json': { schema: eventListResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/stats',
  tags: [TAG],
  summary: 'Last-24h event statistics for dashboards',
  security: SECURITY,
  responses: {
    200: {
      description: 'Stats',
      content: {
        'application/json': {
          schema: z.object({
            stats: z.object({
              total24h: z.number().int(),
              byCategory: z.object({
                inbound: z.number().int(),
                rule_match: z.number().int(),
                workflow: z.number().int(),
                envelope: z.number().int(),
              }),
              byStatus: z.object({
                completed: z.number().int(),
                failed: z.number().int(),
                pending: z.number().int(),
                running: z.number().int(),
              }),
              failureRate: z.number().int(),
            }),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

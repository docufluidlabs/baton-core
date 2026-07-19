import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import { WorkflowInstanceSchema } from '../schemas/instance';
import { InstanceStatusEnum } from '../schemas/common';

const TAG = 'User Activity';
const SECURITY = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/my/instances',
  tags: [TAG],
  summary: 'Instances launched by the current user',
  security: SECURITY,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 20 }),
      status: InstanceStatusEnum.optional(),
    }),
  },
  responses: {
    200: {
      description: 'Instances',
      content: {
        'application/json': {
          schema: z.object({
            instances: z.array(WorkflowInstanceSchema),
            count: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/my/events',
  tags: [TAG],
  summary: 'Events attributed to the current user',
  security: SECURITY,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 20 }),
    }),
  },
  responses: {
    200: {
      description: 'Events',
      content: {
        'application/json': {
          schema: z.object({ events: z.array(z.record(z.any())), count: z.number().int() }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/my/stats',
  tags: [TAG],
  summary: 'Personal 30-day stats',
  security: SECURITY,
  responses: {
    200: {
      description: 'Stats',
      content: {
        'application/json': {
          schema: z.object({
            totalLaunches: z.number().int(),
            successRate: z.number().int(),
            thisMonth: z.number().int(),
            running: z.number().int(),
            failed: z.number().int(),
            userId: z.string(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

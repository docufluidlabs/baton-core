import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import { WorkflowInstanceSchema } from '../schemas/instance';
import { InstanceStatusEnum, MessageResponse } from '../schemas/common';

const TAG = 'Instances';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/instances',
  tags: [TAG],
  summary: 'List instances for the org',
  security: SECURITY,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 50 }),
      status: InstanceStatusEnum.optional(),
      ruleId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Instances',
      content: { 'application/json': { schema: z.object({ instances: z.array(WorkflowInstanceSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/instances/counts',
  tags: [TAG],
  summary: 'Per-workflow status counts',
  security: SECURITY,
  responses: {
    200: {
      description: 'Counts',
      content: {
        'application/json': {
          schema: z.object({
            counts: z.record(
              z.object({
                completed: z.number().int(),
                failed: z.number().int(),
                cancelled: z.number().int(),
                running: z.number().int(),
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
  path: '/api/instances/{id}',
  tags: [TAG],
  summary: 'Get instance details',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Instance',
      content: { 'application/json': { schema: z.object({ instance: WorkflowInstanceSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/instances/{id}/live',
  tags: [TAG],
  summary: 'Get live instance status from Workflow Builder (syncs local state)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Live status',
      content: {
        'application/json': {
          schema: z.object({
            instance: WorkflowInstanceSchema,
            maestro: z.record(z.any()).optional(),
            live: z.boolean(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/instances/{id}/retry',
  tags: [TAG],
  summary: 'Manually retry a failed/running/cancelled instance',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Retry queued', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/instances/{id}/cancel',
  tags: [TAG],
  summary: 'Cancel an instance (best-effort against Workflow Builder; always records local cancel)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Cancelled', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/instances/{id}/tags',
  tags: [TAG],
  summary: 'Replace the org-shared tags on an instance',
  security: SECURITY,
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ tags: z.array(z.string().max(30)).max(20) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tags updated',
      content: {
        'application/json': {
          schema: z.object({ id: z.string().uuid(), tags: z.array(z.string()) }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';

const TAG = 'Auth';
const SECURITY = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: [TAG],
  summary: 'Current user + organization info',
  security: SECURITY,
  responses: {
    200: {
      description: 'Current session',
      content: {
        'application/json': {
          schema: z.object({
            user: z.object({
              id: z.string(),
              email: z.string().email().optional(),
              firstName: z.string().optional(),
              lastName: z.string().optional(),
              imageUrl: z.string().url().optional(),
              role: z.enum(['owner', 'admin', 'member', 'viewer', 'superuser']),
            }),
            organization: z.object({
              id: z.string(),
              name: z.string().optional(),
              plan: z.string(),
              executionsUsed: z.number().int().optional(),
              features: z.array(z.string()),
              createdAt: z.string().optional(),
            }),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/switch-org',
  tags: [TAG],
  summary: 'Verify membership in another org (client must set x-clerk-org-id)',
  security: SECURITY,
  request: {
    body: { content: { 'application/json': { schema: z.object({ orgId: z.string() }) } } },
  },
  responses: {
    200: {
      description: 'Switch confirmed',
      content: { 'application/json': { schema: z.object({ message: z.string(), orgId: z.string() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

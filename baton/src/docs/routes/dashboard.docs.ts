import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';

const TAG = 'Dashboard';
const SECURITY = [{ bearerAuth: [] }];

const AttentionItem = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  description: z.string(),
  platform: z.string().optional(),
  timestamp: z.string(),
  actionUrl: z.string().optional(),
});

registry.registerPath({
  method: 'get',
  path: '/api/dashboard',
  tags: [TAG],
  summary: 'Main dashboard overview (connections, workflows, automations, recent events)',
  security: SECURITY,
  responses: {
    200: {
      description: 'Overview',
      content: {
        'application/json': {
          schema: z.object({
            overview: z.object({
              connections: z.object({
                total: z.number().int(),
                healthy: z.number().int(),
                warning: z.number().int(),
                error: z.number().int(),
              }),
              workflows: z.object({
                total: z.number().int(),
                active: z.number().int(),
                totalLaunches: z.number().int(),
              }),
              automations: z.object({
                total: z.number().int(),
                active: z.number().int(),
                paused: z.number().int(),
                error: z.number().int(),
              }),
              events24h: z.object({
                total: z.number().int(),
                failed: z.number().int(),
              }),
            }),
            attentionItems: z.array(AttentionItem),
            recentEvents: z.array(z.record(z.any())),
            recentInstances: z.array(z.record(z.any())),
            connections: z.array(z.record(z.any())),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

import { z } from 'zod';
import { registry } from '../registry';

const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Liveness probe (no auth)',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: HealthResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['Health'],
  summary: 'Liveness probe under /api prefix (no auth)',
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: HealthResponse } } },
  },
});

import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';

registry.registerPath({
  method: 'post',
  path: '/api/errors',
  tags: ['Internal'],
  summary: 'Report a client-side error (no auth, rate-limited 10/min)',
  description:
    'Mounted before the auth-guarded apiRouter; intended for the Baton frontend to forward ' +
    'uncaught browser errors. Returns 204. Payloads exceeding bounded lengths are rejected.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            message: z.string().max(500).optional(),
            stack: z.string().max(5000).optional(),
            url: z.string().max(500).optional(),
            timestamp: z.string().max(50).optional(),
            userAgent: z.string().max(300).optional(),
            extra: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    204: { description: 'Logged' },
    400: commonErrorResponses[400],
    429: commonErrorResponses[429],
  },
});

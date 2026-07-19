import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';

const TAG = 'Flow Layout';
const SECURITY = [{ bearerAuth: [] }];

const PositionSchema = z.object({ x: z.number(), y: z.number() });
const PositionsRecord = z.record(PositionSchema).openapi({
  description: 'Map of nodeId → {x, y} positions for the workflow editor.',
});

registry.registerPath({
  method: 'get',
  path: '/api/flow-layout',
  tags: [TAG],
  summary: 'Load saved diagram node positions for the org',
  security: SECURITY,
  responses: {
    200: {
      description: 'Positions',
      content: { 'application/json': { schema: z.object({ positions: PositionsRecord }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/flow-layout',
  tags: [TAG],
  summary: 'Save diagram node positions',
  security: SECURITY,
  request: {
    body: { content: { 'application/json': { schema: z.object({ positions: PositionsRecord }) } } },
  },
  responses: {
    200: { description: 'Saved', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
});

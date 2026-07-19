import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  WebhookEndpointSchema,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
} from '../schemas/webhook-endpoint';
import { MessageResponse } from '../schemas/common';

const TAG = 'Webhook Endpoints';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/webhook-endpoints',
  tags: [TAG],
  summary: 'List org\'s webhook endpoints',
  security: SECURITY,
  responses: {
    200: {
      description: 'List',
      content: { 'application/json': { schema: z.object({ endpoints: z.array(WebhookEndpointSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/webhook-endpoints/{id}',
  tags: [TAG],
  summary: 'Get endpoint details (API key masked)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Endpoint',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhook-endpoints',
  tags: [TAG],
  summary: 'Create a webhook endpoint',
  description: 'Requires admin role. The returned `apiKey` (if any) is shown in full only on this response.',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: CreateWebhookEndpointInput } } } },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/webhook-endpoints/{id}',
  tags: [TAG],
  summary: 'Update endpoint fields',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateWebhookEndpointInput } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/webhook-endpoints/{id}',
  tags: [TAG],
  summary: 'Delete a webhook endpoint',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhook-endpoints/{id}/regenerate-key',
  tags: [TAG],
  summary: 'Rotate the endpoint\'s API key',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'New API key',
      content: { 'application/json': { schema: z.object({ apiKey: z.string() }) } },
    },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

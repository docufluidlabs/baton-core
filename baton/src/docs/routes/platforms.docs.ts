import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  OrgAppSchema,
  AppTemplateSchema,
  PlatformPreflightInput,
  InstallPlatformInput,
  UpdatePlatformSecretInput,
} from '../schemas/platform';
import { MessageResponse } from '../schemas/common';

const TAG = 'Platforms';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/platforms/catalog',
  tags: [TAG],
  summary: 'Catalog of all available platform templates',
  security: SECURITY,
  responses: {
    200: {
      description: 'Catalog',
      content: { 'application/json': { schema: z.object({ templates: z.array(AppTemplateSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/platforms/preflight',
  tags: [TAG],
  summary: 'Generate a webhookKey ahead of installation (no persistence)',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: PlatformPreflightInput } } } },
  responses: {
    200: {
      description: 'Webhook key',
      content: { 'application/json': { schema: z.object({ webhookKey: z.string(), webhookUrl: z.string().url() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/platforms',
  tags: [TAG],
  summary: 'List installed platforms for the org',
  security: SECURITY,
  request: {
    query: z.object({
      status: z.enum(['active', 'inactive']).optional().openapi({ default: 'active' }),
    }),
  },
  responses: {
    200: {
      description: 'List',
      content: { 'application/json': { schema: z.object({ platforms: z.array(OrgAppSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/platforms/{id}',
  tags: [TAG],
  summary: 'Get installed platform details',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Platform',
      content: { 'application/json': { schema: z.object({ platform: OrgAppSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/platforms',
  tags: [TAG],
  summary: 'Install a platform',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: InstallPlatformInput } } } },
  responses: {
    201: {
      description: 'Installed',
      content: { 'application/json': { schema: z.object({ platform: OrgAppSchema }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    409: commonErrorResponses[409],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/platforms/{id}',
  tags: [TAG],
  summary: 'Remove an installed platform (soft-delete; rejects if active automations exist)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Removed', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/platforms/{id}/webhook-secret',
  tags: [TAG],
  summary: 'Update the webhook signing secret for an installed platform',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdatePlatformSecretInput } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

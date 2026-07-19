import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  ConnectionSchema,
  SelectAccountInput,
  WebhookSecretInput,
} from '../schemas/connection';
import { MessageResponse, PlatformSlug } from '../schemas/common';

const TAG = 'Connections';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid() });
const platformParam = z.object({ platform: PlatformSlug });

registry.registerPath({
  method: 'get',
  path: '/api/connections',
  tags: [TAG],
  summary: 'List all OAuth connections for the org',
  security: SECURITY,
  responses: {
    200: {
      description: 'List',
      content: { 'application/json': { schema: z.object({ connections: z.array(ConnectionSchema) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/connections/platforms',
  tags: [TAG],
  summary: 'List platforms available for OAuth connection',
  security: SECURITY,
  responses: {
    200: {
      description: 'Available platforms',
      content: {
        'application/json': {
          schema: z.object({
            platforms: z.array(
              z.object({
                platform: PlatformSlug,
                displayName: z.string(),
                eventTypes: z.array(z.string()),
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
  path: '/api/connections/{id}',
  tags: [TAG],
  summary: 'Get connection details (tokens stripped)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Connection',
      content: { 'application/json': { schema: z.object({ connection: ConnectionSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/connections/{platform}/authorize',
  tags: [TAG],
  summary: 'Start OAuth authorization flow for a platform',
  description: 'Requires admin role. Returns a redirect URL that begins the provider OAuth flow.',
  security: SECURITY,
  request: { params: platformParam },
  responses: {
    200: {
      description: 'Redirect URL',
      content: { 'application/json': { schema: z.object({ redirectUrl: z.string().url() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/connections/{platform}/callback',
  tags: [TAG],
  summary: 'OAuth callback (called by provider, redirects to frontend)',
  description: 'Public endpoint hit by external OAuth providers; not for direct API consumers.',
  request: {
    params: platformParam,
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  },
  responses: {
    302: { description: 'Redirect to frontend with status' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/connections/{id}/select-account',
  tags: [TAG],
  summary: 'Select account / tenant for a multi-account connection',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: SelectAccountInput } } },
  },
  responses: {
    200: {
      description: 'Selected',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            connectionId: z.string(),
            accountId: z.string(),
            accountName: z.string().optional(),
          }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/connections/{id}/accounts',
  tags: [TAG],
  summary: 'List available accounts for a connection (DocuSign)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Accounts',
      content: {
        'application/json': {
          schema: z.object({
            accounts: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                baseUri: z.string().optional(),
              }),
            ),
            selectedAccountId: z.string().optional(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/connections/{id}',
  tags: [TAG],
  summary: 'Remove a connection (also removes its workflows)',
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
  path: '/api/connections/{id}/test',
  tags: [TAG],
  summary: 'Test connection health',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Health result',
      content: {
        'application/json': {
          schema: z.object({
            healthy: z.boolean(),
            message: z.string().optional(),
            details: z.record(z.any()).optional(),
            connectionId: z.string(),
            platform: z.string(),
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
  path: '/api/connections/{id}/refresh',
  tags: [TAG],
  summary: 'Force a token refresh',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Refreshed',
      content: { 'application/json': { schema: z.object({ message: z.string(), connectionId: z.string() }) } },
    },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/connections/{id}/webhook-secret',
  tags: [TAG],
  summary: 'Update the webhook signing secret',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: WebhookSecretInput } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ message: z.string(), connectionId: z.string() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

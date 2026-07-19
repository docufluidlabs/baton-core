import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';

const TAG = 'Auth';
const SECURITY = [{ bearerAuth: [] }];

const MeResponse = z.object({
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
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/status',
  tags: [TAG],
  summary: 'First-run detection — true when no users exist yet',
  responses: {
    200: {
      description: 'Setup status',
      content: { 'application/json': { schema: z.object({ needsSetup: z.boolean() }) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/setup',
  tags: [TAG],
  summary: 'First-run setup — create organization + owner (only while needsSetup)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            orgName: z.string().min(1),
            name: z.string().min(1),
            email: z.string().email(),
            password: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Org + owner created; session cookie set', content: { 'application/json': { schema: MeResponse } } },
    400: commonErrorResponses[400],
    409: { description: 'Setup already completed', content: { 'application/json': { schema: z.object({ error: z.string(), message: z.string() }) } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: [TAG],
  summary: 'Email/password login — sets the baton_session cookie',
  request: {
    body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string() }) } } },
  },
  responses: {
    200: { description: 'Logged in; session cookie set', content: { 'application/json': { schema: MeResponse } } },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: [TAG],
  summary: 'Clear the session cookie',
  responses: {
    200: { description: 'Logged out', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/accept-invite',
  tags: [TAG],
  summary: 'Redeem an invite token — set password, activate account, log in',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            token: z.string(),
            name: z.string().min(1),
            password: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Invite accepted; session cookie set', content: { 'application/json': { schema: MeResponse } } },
    400: commonErrorResponses[400],
  },
});

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
  summary: 'Verify membership in another org',
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

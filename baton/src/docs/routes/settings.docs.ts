import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  UpdateOrgInput,
  UpdateRoleInput,
  CheckoutInput,
  HardCapInput,
} from '../schemas/settings';
import { MessageResponse } from '../schemas/common';

const TAG = 'Settings';
const SECURITY = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/settings/org',
  tags: [TAG],
  summary: 'Get organization details',
  security: SECURITY,
  responses: {
    200: {
      description: 'Organization',
      content: { 'application/json': { schema: z.object({ organization: z.record(z.any()) }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/settings/org',
  tags: [TAG],
  summary: 'Update organization settings',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: UpdateOrgInput } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/settings/members',
  tags: [TAG],
  summary: 'List org members',
  security: SECURITY,
  responses: {
    200: {
      description: 'Members',
      content: {
        'application/json': {
          schema: z.object({
            members: z.array(
              z.object({
                id: z.string(),
                clerkId: z.string().optional(),
                email: z.string().email().optional(),
                firstName: z.string().optional(),
                lastName: z.string().optional(),
                role: z.enum(['owner', 'admin', 'member', 'viewer']),
                createdAt: z.string().optional(),
                lastActiveAt: z.string().optional(),
              }),
            ),
            total: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/settings/members/{id}/role',
  tags: [TAG],
  summary: 'Change a member\'s role (cannot change own role)',
  security: SECURITY,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateRoleInput } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ message: z.string(), memberId: z.string(), role: z.string() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/settings/billing',
  tags: [TAG],
  summary: 'Get current plan, usage, and projected charge',
  security: SECURITY,
  responses: {
    200: {
      description: 'Billing info',
      content: { 'application/json': { schema: z.object({ billing: z.record(z.any()) }) } },
    },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/settings/billing/plans',
  tags: [TAG],
  summary: 'List available plans',
  security: SECURITY,
  responses: {
    200: {
      description: 'Plans',
      content: { 'application/json': { schema: z.object({ plans: z.array(z.record(z.any())) }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/settings/billing/portal',
  tags: [TAG],
  summary: 'Open Stripe customer portal',
  security: SECURITY,
  responses: {
    200: { description: 'Portal URL', content: { 'application/json': { schema: z.object({ url: z.string().url() }) } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/settings/billing/checkout',
  tags: [TAG],
  summary: 'Create a Stripe Checkout session for plan upgrade',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: CheckoutInput } } } },
  responses: {
    200: { description: 'Checkout URL', content: { 'application/json': { schema: z.object({ url: z.string().url() }) } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    500: commonErrorResponses[500],
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/settings/billing/hard-cap',
  tags: [TAG],
  summary: 'Set or clear opt-in hard cap',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: HardCapInput } } } },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: z.object({ message: z.string(), hardCap: z.number().int().nullable() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/settings/audit',
  tags: [TAG],
  summary: 'Get the audit log (gated by `audit_log` feature flag)',
  security: SECURITY,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 50 }),
    }),
  },
  responses: {
    200: {
      description: 'Audit log',
      content: {
        'application/json': {
          schema: z.object({
            auditLog: z.array(z.record(z.any())),
            count: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  UpdateOrgInput,
  UpdateRoleInput,
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
                email: z.string().email().optional(),
                firstName: z.string().optional(),
                lastName: z.string().optional(),
                fullName: z.string().optional(),
                role: z.enum(['owner', 'admin', 'member', 'viewer']),
                status: z.enum(['active', 'invited']),
                inviteExpiresAt: z.string().optional(),
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
  method: 'post',
  path: '/api/settings/members/invites',
  tags: [TAG],
  summary: 'Invite a member — returns a 72h invite link (admin+)',
  security: SECURITY,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            role: z.enum(['admin', 'member', 'viewer']),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invite created',
      content: {
        'application/json': {
          schema: z.object({
            inviteUrl: z.string().url(),
            memberId: z.string(),
            email: z.string().email(),
            role: z.string(),
            expiresAt: z.string(),
          }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    409: { description: 'Member with this email already exists', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/settings/members/{id}/role',
  tags: [TAG],
  summary: 'Change a member\'s role (org-scoped; cannot change own role)',
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
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/settings/members/{id}',
  tags: [TAG],
  summary: 'Remove a member (org-scoped; cannot remove yourself or the last owner)',
  security: SECURITY,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: 'Removed',
      content: { 'application/json': { schema: z.object({ message: z.string(), memberId: z.string() }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/settings/audit',
  tags: [TAG],
  summary: 'Get the audit log (admin)',
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

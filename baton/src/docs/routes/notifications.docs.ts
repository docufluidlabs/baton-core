import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import { MessageResponse } from '../schemas/common';

const TAG = 'Notifications';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string() });

const Notification = z.record(z.any()).openapi({ description: 'Notification record (free-form metadata).' });

registry.registerPath({
  method: 'get',
  path: '/api/notifications',
  tags: [TAG],
  summary: 'List in-app notifications for the current user',
  security: SECURITY,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({ default: 30 }),
      unread: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Notifications',
      content: {
        'application/json': {
          schema: z.object({
            notifications: z.array(Notification),
            unreadCount: z.number().int(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/notifications/{id}/read',
  tags: [TAG],
  summary: 'Mark a notification as read',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Marked', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/notifications/read-all',
  tags: [TAG],
  summary: 'Mark all unread notifications as read',
  security: SECURITY,
  responses: {
    200: {
      description: 'Marked',
      content: { 'application/json': { schema: z.object({ message: z.string(), count: z.number().int() }) } },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/notifications/{id}/dismiss',
  tags: [TAG],
  summary: 'Dismiss a notification (and mark read if not already)',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: { description: 'Dismissed', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/notifications/preferences',
  tags: [TAG],
  summary: 'Get notification preferences (per-org)',
  security: SECURITY,
  responses: {
    200: {
      description: 'Preferences',
      content: {
        'application/json': {
          schema: z.object({
            preferences: z.object({
              events: z.record(z.object({ inApp: z.boolean(), email: z.boolean() })).optional(),
            }).passthrough(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/notifications/preferences',
  tags: [TAG],
  summary: 'Replace notification preferences (per-org)',
  security: SECURITY,
  request: {
    body: { content: { 'application/json': { schema: z.record(z.any()).openapi({ description: 'Free-form preferences object.' }) } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
  },
});

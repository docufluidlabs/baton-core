import { z } from 'zod';
import { registry } from '../registry';
import { IsoDate } from './common';

export const WebhookEndpointSchema = registry.register(
  'WebhookEndpoint',
  z.object({
    id: z.string().uuid(),
    orgId: z.string(),
    name: z.string(),
    platform: z.string(),
    workflowId: z.string().uuid(),
    payloadFieldPath: z.string(),
    apiKey: z.string().optional().openapi({ description: 'Masked except on create' }),
    rateLimitPerMinute: z.number().int(),
    enabled: z.boolean(),
    requestCount: z.number().int(),
    lastRequestAt: IsoDate.optional(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    createdBy: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    hasApiKey: z.boolean().optional(),
  }),
);

export const CreateWebhookEndpointInput = registry.register(
  'CreateWebhookEndpointInput',
  z.object({
    name: z.string().min(1).max(100),
    platform: z.string().min(1).max(50),
    workflowId: z.string().uuid(),
    payloadFieldPath: z.string().min(1).max(200).openapi({
      description: 'Dot-notation path to the record ID field (e.g. "object_id", "data.id").',
    }),
    apiKey: z.string().max(256).optional(),
    generateApiKey: z.boolean().optional(),
    rateLimitPerMinute: z.number().int().min(1).max(10000).optional().openapi({ default: 60 }),
  }).openapi({
    example: {
      name: 'Workday → Customer onboarding',
      platform: 'workday',
      workflowId: '11111111-2222-3333-4444-555555555555',
      payloadFieldPath: 'data.object.id',
      generateApiKey: true,
      rateLimitPerMinute: 60,
    },
  }),
);

export const UpdateWebhookEndpointInput = registry.register(
  'UpdateWebhookEndpointInput',
  z.object({
    name: z.string().min(1).max(100).optional(),
    workflowId: z.string().uuid().optional(),
    payloadFieldPath: z.string().min(1).max(200).optional(),
    apiKey: z.string().max(256).optional(),
    generateApiKey: z.boolean().optional(),
    rateLimitPerMinute: z.number().int().min(1).max(10000).optional(),
    enabled: z.boolean().optional(),
  }),
);

import { z } from 'zod';

export const UuidParam = z.string().uuid().openapi({ description: 'UUID v4' });
export const IsoDate = z.string().datetime().openapi({ description: 'ISO-8601 timestamp', example: '2026-06-04T12:00:00.000Z' });
export const PlatformSlug = z.enum([
  'salesforce', 'hubspot', 'zohocrm', 'bamboohr', 'smartsheet', 'docusign', 'zendesk',
  'slack', 'greenhouse', 'mondaycom', 'powerautomate',
]);
export const InstanceStatusEnum = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export const MaestroStatusEnum = z.enum(['draft', 'active', 'paused']);
export const TriggerTypeEnum = z.enum(['http', 'link', 'api_call', 'form']);

export const MessageResponse = z.object({
  message: z.string(),
  id: z.string().optional(),
});

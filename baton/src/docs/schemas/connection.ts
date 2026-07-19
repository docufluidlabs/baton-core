import { z } from 'zod';
import { registry } from '../registry';
import { IsoDate, PlatformSlug } from './common';

export const ConnectionStatusEnum = z.enum(['pending', 'healthy', 'warning', 'error', 'disconnected']);

export const ConnectionSchema = registry.register(
  'Connection',
  z.object({
    id: z.string().uuid(),
    orgId: z.string(),
    platform: PlatformSlug,
    displayName: z.string(),
    accountId: z.string().optional(),
    status: ConnectionStatusEnum,
    scopes: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional(),
    webhookId: z.string().optional(),
    tokenExpiresAt: IsoDate.optional(),
    lastSyncAt: IsoDate.optional(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    createdBy: z.string().optional(),
    hasAccessToken: z.boolean().optional(),
    hasRefreshToken: z.boolean().optional(),
  }),
);

export const SelectAccountInput = registry.register(
  'SelectAccountInput',
  z.object({
    accountId: z.string().min(1),
    accountName: z.string().optional(),
    baseUri: z.string().url().optional(),
  }),
);

export const WebhookSecretInput = registry.register(
  'WebhookSecretInput',
  z.object({
    secret: z.string().min(1),
  }),
);

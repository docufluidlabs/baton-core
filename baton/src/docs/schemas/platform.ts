import { z } from 'zod';
import { registry } from '../registry';
import { IsoDate } from './common';

export const OrgAppSchema = registry.register(
  'InstalledPlatform',
  z.object({
    id: z.string().uuid(),
    orgId: z.string(),
    appSlug: z.string(),
    webhookKey: z.string(),
    webhookUrl: z.string().url(),
    displayName: z.string(),
    status: z.enum(['active', 'inactive']),
    addedAt: IsoDate,
    addedBy: z.string().optional(),
    lastWebhookAt: IsoDate.optional(),
    webhookCount: z.number().int().optional(),
    name: z.string().optional(),
    logoUrl: z.string().url().optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    supportedEvents: z.array(z.any()).optional(),
  }),
);

export const AppTemplateSchema = registry.register(
  'AppTemplate',
  z.object({
    appSlug: z.string(),
    name: z.string(),
    logoUrl: z.string().url().optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    supportedEvents: z.array(z.any()).optional(),
  }).passthrough(),
);

export const PlatformPreflightInput = registry.register(
  'PlatformPreflightInput',
  z.object({ appSlug: z.string().min(1) }),
);

export const InstallPlatformInput = registry.register(
  'InstallPlatformInput',
  z.object({
    appSlug: z.string().min(1),
    secretKey: z.string().min(1).optional(),
    displayName: z.string().min(1).max(200).optional(),
    webhookKey: z.string().length(64).regex(/^[a-f0-9]+$/).optional(),
  }),
);

export const UpdatePlatformSecretInput = registry.register(
  'UpdatePlatformSecretInput',
  z.object({ secret: z.string().min(1) }),
);

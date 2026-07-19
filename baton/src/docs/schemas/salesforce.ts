import { z } from 'zod';
import { registry } from '../registry';

const webhookKeyField = z.string().length(64).regex(/^[a-f0-9]+$/).openapi({
  description: '64-char hex token assigned to a Baton automation rule.',
});

export const SfBootstrapTokenInput = registry.register(
  'SfBootstrapTokenInput',
  z.object({
    webhookKey: webhookKeyField,
    expiresInHours: z.number().int().min(1).max(24 * 7).optional().openapi({ default: 24 }),
  }),
);

export const SfBootstrapTokenResponse = registry.register(
  'SfBootstrapTokenResponse',
  z.object({
    tokenId: z.string(),
    expiresAt: z.number().int().openapi({ description: 'Unix epoch seconds' }),
    webhookUrl: z.string().url(),
  }),
);

export const SfRotateSecretInput = SfBootstrapTokenInput;

export const SfRotateSecretResponse = registry.register(
  'SfRotateSecretResponse',
  SfBootstrapTokenResponse.extend({
    clearedSfOrgs: z.array(z.string()),
  }),
);

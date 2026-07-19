import { z } from 'zod';
import { registry } from '../registry';

export const GenericWebhookPayload = registry.register(
  'GenericWebhookPayload',
  z.record(z.any()).openapi({
    description:
      'Free-form JSON payload as delivered by the upstream provider. The exact shape varies by ' +
      'platform — consult the provider\'s webhook documentation for field details.',
  }),
);

export const SfWebhookRegistrationInput = registry.register(
  'SfWebhookRegistrationInput',
  z.object({
    webhookKey: z.string().length(64).regex(/^[a-f0-9]+$/),
    bootstrapToken: z.string().min(20).max(128),
    sfOrgId: z.string().min(15).max(18).regex(/^[0-9A-Za-z]+$/),
    generatedSecret: z.string().min(20).max(256),
    packageVersion: z.string().max(32).optional(),
  }),
);

export const SfWebhookRegistrationResponse = registry.register(
  'SfWebhookRegistrationResponse',
  z.object({
    status: z.literal('registered'),
    webhookId: z.string(),
    secretVersion: z.number().int(),
    expiresAt: z.string().nullable(),
  }),
);

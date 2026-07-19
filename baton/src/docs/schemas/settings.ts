import { z } from 'zod';
import { registry } from '../registry';

export const UpdateOrgInput = registry.register(
  'UpdateOrgInput',
  z.object({
    name: z.string().min(1).max(200).optional(),
    timezone: z.string().optional(),
    webhookRetryPolicy: z.enum(['none', 'linear', 'exponential']).optional(),
    notificationEmail: z.string().email().optional(),
  }),
);

export const UpdateRoleInput = registry.register(
  'UpdateRoleInput',
  z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) }),
);

export const CheckoutInput = registry.register(
  'CheckoutInput',
  z
    .object({
      planSlug: z.enum(['starter', 'growth']).optional(),
      priceId: z.string().optional().openapi({ description: 'Legacy — prefer planSlug.' }),
    })
    .refine((d) => Boolean(d.planSlug || d.priceId), 'planSlug or priceId required'),
);

export const HardCapInput = registry.register(
  'HardCapInput',
  z.object({ hardCap: z.number().int().positive().nullable() }),
);

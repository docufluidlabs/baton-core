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

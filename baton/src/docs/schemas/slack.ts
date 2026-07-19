import { z } from 'zod';
import { registry } from '../registry';

const eventChannel = z.string().nullable().optional();

export const SlackChannelRouting = registry.register(
  'SlackChannelRouting',
  z.object({
    default: z.string().nullable(),
    workflow_failed: eventChannel,
    workflow_completed: eventChannel,
    workflow_launched: eventChannel,
    automation_failed: eventChannel,
    connection_degraded: eventChannel,
    execution_quota_warning: eventChannel,
    execution_quota_exceeded: eventChannel,
    webhook_failed: eventChannel,
  }),
);

export const SlackConfigInput = registry.register(
  'SlackConfigInput',
  z.object({
    enabled: z.boolean(),
    channelRouting: SlackChannelRouting,
  }),
);

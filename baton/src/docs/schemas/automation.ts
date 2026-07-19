import { z } from 'zod';
import { registry } from '../registry';
import { IsoDate, PlatformSlug } from './common';

export const RuleStatusEnum = z.enum(['active', 'paused', 'error', 'disabled']);
export const RetryStrategyEnum = z.enum(['linear', 'exponential']);

export const AutomationSchema = registry.register(
  'Automation',
  z.object({
    id: z.string().uuid(),
    orgId: z.string(),
    name: z.string(),
    connectionId: z.string().uuid().optional(),
    appId: z.string().uuid().optional(),
    appSlug: z.string().optional(),
    sourcePlatform: PlatformSlug,
    eventType: z.string(),
    eventLabel: z.string(),
    conditions: z.record(z.any()).optional(),
    conditionsDisplay: z.string().optional(),
    actionType: z.string(),
    targetWorkflowId: z.string().uuid().optional(),
    actionConfig: z.record(z.any()).optional(),
    webhookKey: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    status: RuleStatusEnum,
    retryMaxAttempts: z.number().int(),
    retryStrategy: RetryStrategyEnum,
    retryIntervalSec: z.number().int(),
    triggerCount: z.number().int().optional(),
    failureCount: z.number().int().optional(),
    successRate: z.number().optional(),
    lastError: z.string().optional(),
    lastTriggeredAt: IsoDate.optional(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    createdBy: z.string().optional(),
  }),
);

export const CreateAutomationInput = registry.register(
  'CreateAutomationInput',
  z.object({
    name: z.string().min(1).max(200),
    connectionId: z.string().uuid().optional(),
    appId: z.string().uuid().optional(),
    appSlug: z.string().min(1).optional(),
    sourcePlatform: PlatformSlug,
    eventType: z.string().min(1),
    eventLabel: z.string().min(1),
    conditions: z.record(z.any()).optional(),
    conditionsDisplay: z.string().optional(),
    targetWorkflowId: z.string().uuid(),
    actionConfig: z.record(z.any()).optional(),
    retryMaxAttempts: z.number().int().min(0).max(10).optional(),
    retryStrategy: RetryStrategyEnum.optional(),
    retryIntervalSec: z.number().int().min(10).max(3600).optional(),
    webhookKey: z.string().length(64).optional().openapi({
      description: 'Optional pre-generated key from POST /api/automations/preflight.',
    }),
  }).refine(
    (data) => data.connectionId || data.appId || data.appSlug,
    { message: 'Either connectionId, appId, or appSlug must be provided' },
  ).refine(
    (data) => !(data.connectionId && data.appId),
    { message: 'Cannot specify both connectionId and appId' },
  ).openapi({
    example: {
      name: 'Salesforce Opportunity → DocuSign',
      appSlug: 'salesforce',
      sourcePlatform: 'salesforce',
      eventType: 'opportunity.closed_won',
      eventLabel: 'Opportunity Closed Won',
      targetWorkflowId: '11111111-2222-3333-4444-555555555555',
      retryMaxAttempts: 3,
      retryStrategy: 'exponential',
      retryIntervalSec: 60,
    },
  }),
);

export const UpdateAutomationInput = registry.register(
  'UpdateAutomationInput',
  z.object({
    name: z.string().min(1).max(200).optional(),
    eventType: z.string().min(1).optional(),
    eventLabel: z.string().min(1).optional(),
    conditions: z.record(z.any()).optional(),
    conditionsDisplay: z.string().optional(),
    targetWorkflowId: z.string().uuid().optional(),
    actionConfig: z.record(z.any()).optional(),
    retryMaxAttempts: z.number().int().min(0).max(10).optional(),
    retryStrategy: RetryStrategyEnum.optional(),
    retryIntervalSec: z.number().int().min(10).max(3600).optional(),
  }),
);

export const PreflightInput = registry.register(
  'AutomationPreflightInput',
  z.object({
    sourcePlatform: z.string().optional(),
  }),
);

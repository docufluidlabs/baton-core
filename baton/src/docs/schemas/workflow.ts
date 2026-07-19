import { z } from 'zod';
import { registry } from '../registry';
import { IsoDate, MaestroStatusEnum, PlatformSlug, TriggerTypeEnum } from './common';

export const WorkflowSchema = registry.register(
  'Workflow',
  z.object({
    id: z.string().uuid(),
    orgId: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    maestroWorkflowId: z.string().optional(),
    maestroStatus: MaestroStatusEnum,
    triggerType: TriggerTypeEnum,
    triggerInputSchema: z.record(z.any()).optional(),
    stepCount: z.number().int().nonnegative(),
    stepsConfig: z.record(z.any()).optional(),
    platform: PlatformSlug,
    connectionId: z.string().uuid().optional(),
    objectTypes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    launchCount: z.number().int().nonnegative(),
    lastLaunchedAt: IsoDate.optional(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    maestroUpdatedAt: IsoDate.optional(),
    createdBy: z.string().optional(),
    maestroUrl: z.string().url().optional().openapi({ description: 'Deep link to the Workflow Builder editor for this workflow' }),
    maestroInstancesUrl: z.string().url().optional().openapi({ description: 'Deep link to the Workflow Builder instances list for this workflow' }),
  }),
);

export const CreateWorkflowInput = registry.register(
  'CreateWorkflowInput',
  z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    maestroWorkflowId: z.string().optional(),
    connectionId: z.string().uuid().optional(),
    triggerInputSchema: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
  }).openapi({
    example: {
      name: 'New customer onboarding',
      description: 'Sends welcome envelope when a new account is opened.',
      tags: ['onboarding'],
    },
  }),
);

export const UpdateWorkflowInput = registry.register(
  'UpdateWorkflowInput',
  z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
    connectionId: z.string().uuid().optional(),
    triggerInputSchema: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
  }),
);

export const SyncWorkflowsInput = registry.register(
  'SyncWorkflowsInput',
  z.object({
    connectionId: z.string().uuid().optional().openapi({
      description: 'If omitted, the org\'s healthy DocuSign connection is used.',
    }),
  }),
);

export const LaunchWorkflowInput = registry.register(
  'LaunchWorkflowInput',
  z.object({
    instanceName: z.string().min(1).max(200),
    triggerInputs: z.record(z.any()).optional().default({}),
  }).openapi({
    example: {
      instanceName: 'Manual run - Acme Corp',
      triggerInputs: { customerEmail: 'jane@acme.com', amount: 5000 },
    },
  }),
);

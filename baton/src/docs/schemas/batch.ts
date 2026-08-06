import { z } from 'zod';
import { registry } from '../registry';

// ─── Bulk Upload (batch processors) ──────────────────────────

/** paramName → source spec. Params the user left as "- not set -" are omitted. */
export const BatchMappingEntry = z.union([
  z.object({ type: z.literal('column'), column: z.string().min(1) }),
  z.object({ type: z.literal('fixed'), value: z.string() }),
]);

export const BatchMappingInput = z.record(BatchMappingEntry);

export const BatchRowSelectionInput = z.union([
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('range'),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  }).refine((v) => v.from <= v.to, { message: 'from must be less than or equal to to' }),
]);

export const BatchRunSettingsInput = z.object({
  releaseCount: z.number().int().min(1).max(100),
  intervalMinutes: z.number().int().min(1).max(1440),
  stopAfterFailures: z.number().int().min(1).max(100),
});

export const CreateBatchProcessorInput = registry.register(
  'CreateBatchProcessorInput',
  z.object({
    name: z.string().min(1).max(200),
    targetWorkflowId: z.string().uuid(),
    sourcePlatform: z.string().min(1).optional(),
    throttleReleaseCount: z.number().int().min(1).max(100).optional(),
    throttleIntervalMinutes: z.number().int().min(1).max(1440).optional(),
    stopAfterConsecutiveFailures: z.number().int().min(1).max(100).optional(),
  }),
);

export const UpdateBatchProcessorInput = registry.register(
  'UpdateBatchProcessorInput',
  z.object({
    name: z.string().min(1).max(200).optional(),
    targetWorkflowId: z.string().uuid().optional(),
    sourcePlatform: z.string().min(1).nullable().optional(),
    throttleReleaseCount: z.number().int().min(1).max(100).optional(),
    throttleIntervalMinutes: z.number().int().min(1).max(1440).optional(),
    stopAfterConsecutiveFailures: z.number().int().min(1).max(100).optional(),
  }),
);

export const BatchPreflightInput = registry.register(
  'BatchPreflightInput',
  z.object({
    mapping: BatchMappingInput,
    rowSelection: BatchRowSelectionInput,
    settings: BatchRunSettingsInput,
  }),
);

export const BatchStartInput = registry.register(
  'BatchStartInput',
  z.object({
    mapping: BatchMappingInput,
    rowSelection: BatchRowSelectionInput,
    settings: BatchRunSettingsInput,
    skipProblemRows: z.boolean(),
  }),
);

export const BatchCancelInput = registry.register(
  'BatchCancelInput',
  z.object({
    scope: z.enum(['queued', 'all']),
  }),
);

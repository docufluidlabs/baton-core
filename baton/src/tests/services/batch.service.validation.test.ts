/**
 * Bulk Upload mapping + validation helper tests — batch.service
 * buildRowInputs (column/fixed sources), parseTriggerSchemaFields,
 * validateRowData (required/empty/email/scientific notation) and
 * validateRunRows (selection, unmappedRequired, ready/problem counts).
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: vi.fn() })),
  TableNames: {
    BATCH_PROCESSORS: 'batch-processors',
    BATCH_RUNS: 'batch-runs',
    BATCH_ROWS: 'batch-rows',
    WORKFLOW_INSTANCES: 'instances',
  },
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  buildRowInputs,
  parseTriggerSchemaFields,
  validateRowData,
  validateRunRows,
  isRowSelected,
  buildRowName,
  CORRUPTED_NUMBER_PROBLEM,
} from '../../services/batch.service';
import { BatchMapping, BatchRow, BatchRun } from '../../lib/types';

// ─── Fixtures ───────────────────────────────────────────────

const jsonSchema = {
  type: 'object',
  properties: {
    customerName: { type: 'string' },
    customerEmail: { type: 'string' },
    amount: { type: 'string' },
  },
  required: ['customerName', 'customerEmail'],
};

const mapping: BatchMapping = {
  customerName: { type: 'column', column: 'Name' },
  customerEmail: { type: 'column', column: 'Email' },
  amount: { type: 'fixed', value: '100' },
};

function makeRow(rowNumber: number, data: Record<string, string>): BatchRow {
  return {
    runId: 'run-1',
    rowNumber,
    orgId: 'org-1',
    batchProcessorId: 'bp-1',
    data,
    included: true,
    problems: [],
    status: 'staged',
  };
}

// ─── buildRowInputs ─────────────────────────────────────────

describe('buildRowInputs', () => {
  it('resolves column sources from row data and fixed values verbatim', () => {
    const inputs = buildRowInputs(mapping, { Name: 'Alice', Email: 'a@x.com' });
    expect(inputs).toEqual({ customerName: 'Alice', customerEmail: 'a@x.com', amount: '100' });
  });

  it('maps a missing column to an empty string', () => {
    const inputs = buildRowInputs(mapping, { Name: 'Alice' });
    expect(inputs.customerEmail).toBe('');
  });

  it('returns an empty object without a mapping', () => {
    expect(buildRowInputs(undefined, { Name: 'Alice' })).toEqual({});
  });
});

// ─── parseTriggerSchemaFields ───────────────────────────────

describe('parseTriggerSchemaFields', () => {
  it('parses JSON Schema format with required flags', () => {
    const fields = parseTriggerSchemaFields(jsonSchema);
    expect(fields).toEqual([
      { key: 'customerName', required: true },
      { key: 'customerEmail', required: true },
      { key: 'amount', required: false },
    ]);
  });

  it('parses Workflow Builder array format (never required)', () => {
    const fields = parseTriggerSchemaFields([
      { field_name: 'projectId', field_data_type: 'String' },
      { field_name: 'signers', field_data_type: 'Participants' },
      { field_name: 'startDate', field_data_type: 'DateTime' },
    ] as any);
    expect(fields).toEqual([{ key: 'projectId', required: false }]);
  });

  it('returns [] for missing or empty schemas', () => {
    expect(parseTriggerSchemaFields(undefined)).toEqual([]);
    expect(parseTriggerSchemaFields({ type: 'object', properties: {} })).toEqual([]);
  });
});

// ─── validateRowData ────────────────────────────────────────

describe('validateRowData', () => {
  const fields = parseTriggerSchemaFields(jsonSchema);

  it('accepts a fully valid row', () => {
    expect(validateRowData(fields, mapping, { Name: 'Alice', Email: 'alice@example.com' })).toEqual([]);
  });

  it('flags a required mapped field that is empty for this row', () => {
    const problems = validateRowData(fields, mapping, { Name: '', Email: 'a@x.com' });
    expect(problems).toEqual(['required field "customerName" is empty']);
  });

  it('flags an invalid email in a field whose name contains "email"', () => {
    const problems = validateRowData(fields, mapping, { Name: 'Alice', Email: 'not-an-email' });
    expect(problems).toEqual(['"customerEmail" is not a valid email address']);
  });

  it('validates a fixed value too (fixed email must match the regex)', () => {
    const fixedMapping: BatchMapping = {
      customerName: { type: 'column', column: 'Name' },
      customerEmail: { type: 'fixed', value: 'oops' },
    };
    const problems = validateRowData(fields, fixedMapping, { Name: 'Alice' });
    expect(problems).toEqual(['"customerEmail" is not a valid email address']);
  });

  it('warns when a mapped column value is in scientific notation', () => {
    const problems = validateRowData(fields, mapping, {
      Name: '1.23457E+12',
      Email: 'alice@example.com',
    });
    expect(problems).toEqual([CORRUPTED_NUMBER_PROBLEM]);
  });

  it('does not flag unmapped required fields per row (reported run-level)', () => {
    const partialMapping: BatchMapping = { customerEmail: { type: 'column', column: 'Email' } };
    expect(validateRowData(fields, partialMapping, { Email: 'a@x.com' })).toEqual([]);
  });
});

// ─── isRowSelected ──────────────────────────────────────────

describe('isRowSelected', () => {
  it('selects everything in mode all (or without a selection)', () => {
    expect(isRowSelected(1, { mode: 'all' })).toBe(true);
    expect(isRowSelected(99, undefined)).toBe(true);
  });

  it('selects only rows inside the range (inclusive)', () => {
    const range = { mode: 'range' as const, from: 2, to: 4 };
    expect(isRowSelected(1, range)).toBe(false);
    expect(isRowSelected(2, range)).toBe(true);
    expect(isRowSelected(4, range)).toBe(true);
    expect(isRowSelected(5, range)).toBe(false);
  });
});

// ─── validateRunRows ────────────────────────────────────────

describe('validateRunRows', () => {
  it('splits selected rows into ready and problem rows, reports unmappedRequired', () => {
    const rows = [
      makeRow(1, { Name: 'Alice', Email: 'alice@example.com' }),
      makeRow(2, { Name: 'Bob', Email: 'broken' }),
      makeRow(3, { Name: 'Cara', Email: 'cara@example.com' }),
    ];
    const partialMapping: BatchMapping = {
      customerEmail: { type: 'column', column: 'Email' },
    };

    const result = validateRunRows(rows, jsonSchema, partialMapping, { mode: 'all' });

    expect(result.unmappedRequired).toEqual(['customerName']);
    expect(result.readyRows).toBe(2);
    expect(result.problemRows).toEqual([
      { rowNumber: 2, problems: ['"customerEmail" is not a valid email address'] },
    ]);
    expect(result.selectedCount).toBe(3);
    expect(result.rows.map((r) => r.included)).toEqual([true, true, true]);
  });

  it('marks rows outside the range as not included and skips their validation', () => {
    const rows = [
      makeRow(1, { Name: 'Alice', Email: 'broken' }),
      makeRow(2, { Name: 'Bob', Email: 'bob@example.com' }),
    ];

    const result = validateRunRows(rows, jsonSchema, mapping, { mode: 'range', from: 2, to: 2 });

    expect(result.selectedCount).toBe(1);
    expect(result.readyRows).toBe(1);
    expect(result.problemRows).toEqual([]);
    expect(result.rows[0].included).toBe(false);
    expect(result.rows[0].problems).toEqual([]);
    expect(result.rows[1].included).toBe(true);
  });
});

// ─── buildRowName ───────────────────────────────────────────

describe('buildRowName', () => {
  const run = {
    id: 'run-1',
    mapping,
    columns: ['Name', 'Email'],
  } as unknown as BatchRun;

  it('uses "{seq} · {first mapped column value} · row {rowNumber}"', () => {
    const row = { ...makeRow(7, { Name: 'Alice', Email: 'a@x.com' }), seq: 3 };
    expect(buildRowName(run, row)).toBe('3 · Alice · row 7');
  });

  it('falls back to the first non-empty column when the mapped value is empty', () => {
    const row = { ...makeRow(2, { Name: '', Email: 'b@x.com' }), seq: 1 };
    expect(buildRowName(run, row)).toBe('1 · b@x.com · row 2');
  });
});

/**
 * InstancesSidebar — unit tests
 *
 * Tests for:
 *  - normalizeKey          — key normalization for schema field matching
 *  - resolveDisplayInputs  — resolves what params to show in "View Params"
 */
import { describe, it, expect } from 'vitest';
import { normalizeKey, resolveDisplayInputs } from './InstancesSidebar';
import type { TriggerInputSchema } from '@/hooks/useApi';

// ─── normalizeKey ────────────────────────────────────────────

describe('normalizeKey', () => {
  it('lowercases the key', () => {
    expect(normalizeKey('EventId')).toBe('eventid');
  });

  it('strips underscores', () => {
    expect(normalizeKey('event_id')).toBe('eventid');
  });

  it('strips hyphens', () => {
    expect(normalizeKey('event-id')).toBe('eventid');
  });

  it('strips spaces', () => {
    expect(normalizeKey('event id')).toBe('eventid');
  });

  it('handles mixed separators', () => {
    expect(normalizeKey('Some_Event-ID value')).toBe('someeventidvalue');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeKey('')).toBe('');
  });
});

// ─── resolveDisplayInputs ────────────────────────────────────

describe('resolveDisplayInputs — no __rawPayload (manual mapping)', () => {
  it('returns inputData as-is when no __rawPayload', () => {
    const inputData = { project_id: '123', title: 'Hello' };
    const result = resolveDisplayInputs(inputData, undefined);
    expect(result).toEqual({ project_id: '123', title: 'Hello' });
  });

  it('returns inputData as-is even when schema is provided', () => {
    const schema: TriggerInputSchema = [
      { field_name: 'project_id', field_data_type: 'String', default_value: '' },
    ];
    const inputData = { project_id: '123', extra_field: 'ignored' };
    const result = resolveDisplayInputs(inputData, schema);
    expect(result).toEqual({ project_id: '123', extra_field: 'ignored' });
  });
});

describe('resolveDisplayInputs — __rawPayload, no schema', () => {
  it('unwraps object __rawPayload and returns it when no schema', () => {
    const inputData = {
      __rawPayload: { eventId: 123, occurredAt: 1776446246894, subscriptionType: 'contact.creation' },
    };
    const result = resolveDisplayInputs(inputData, undefined);
    expect(result).toEqual({ eventId: 123, occurredAt: 1776446246894, subscriptionType: 'contact.creation' });
  });

  it('unwraps array __rawPayload (takes first element) when no schema', () => {
    const inputData = {
      __rawPayload: [{ eventId: 42, changeFlag: 'CREATED' }],
    };
    const result = resolveDisplayInputs(inputData, undefined);
    expect(result).toEqual({ eventId: 42, changeFlag: 'CREATED' });
  });

  it('returns empty object when __rawPayload is empty array', () => {
    const inputData = { __rawPayload: [] };
    const result = resolveDisplayInputs(inputData, undefined);
    expect(result).toEqual({});
  });

  it('returns empty object when __rawPayload is empty object', () => {
    const inputData = { __rawPayload: {} };
    const result = resolveDisplayInputs(inputData, undefined);
    expect(result).toEqual({});
  });
});

describe('resolveDisplayInputs — __rawPayload + Maestro array schema', () => {
  const schema: TriggerInputSchema = [
    { field_name: 'eventId', field_data_type: 'String', default_value: '' },
    { field_name: 'occurredAt', field_data_type: 'String', default_value: '' },
    { field_name: 'subscriptionType', field_data_type: 'String', default_value: '' },
    { field_name: 'changeFlag', field_data_type: 'String', default_value: '' },
  ];

  it('filters to only schema fields from raw payload', () => {
    const inputData = {
      __rawPayload: {
        attemptNumber: 0,
        sourceId: 'userId:89643182',
        eventId: 3762531434,
        changeSource: 'CRM_UI',
        occurredAt: 1776446246894,
        subscriptionType: 'contact.creation',
        portalId: 148041090,
        appId: 36783427,
        changeFlag: 'CREATED',
        subscriptionId: 6231495,
      },
    };

    const result = resolveDisplayInputs(inputData, schema);

    expect(Object.keys(result)).toEqual(['eventId', 'occurredAt', 'subscriptionType', 'changeFlag']);
    expect(result.eventId).toBe(3762531434);
    expect(result.occurredAt).toBe(1776446246894);
    expect(result.subscriptionType).toBe('contact.creation');
    expect(result.changeFlag).toBe('CREATED');
    expect(result).not.toHaveProperty('portalId');
    expect(result).not.toHaveProperty('attemptNumber');
  });

  it('matches schema fields case-insensitively (normalized)', () => {
    const caseSchema: TriggerInputSchema = [
      { field_name: 'eventid', field_data_type: 'String', default_value: '' },
    ];
    const inputData = {
      __rawPayload: { EventId: 999, other: 'skip' },
    };
    const result = resolveDisplayInputs(inputData, caseSchema);
    expect(result.eventid).toBe(999);
  });

  it('handles array __rawPayload with schema', () => {
    const inputData = {
      __rawPayload: [{ eventId: 1, occurredAt: 2, subscriptionType: 'x', changeFlag: 'Y', extra: 'no' }],
    };
    const result = resolveDisplayInputs(inputData, schema);
    expect(Object.keys(result)).toEqual(['eventId', 'occurredAt', 'subscriptionType', 'changeFlag']);
  });

  it('sets schema fields to null when not present in payload', () => {
    const inputData = {
      __rawPayload: { eventId: 1 },
    };
    const result = resolveDisplayInputs(inputData, schema);
    expect(result.eventId).toBe(1);
    expect(result.occurredAt).toBeNull();
    expect(result.subscriptionType).toBeNull();
    expect(result.changeFlag).toBeNull();
  });
});

describe('resolveDisplayInputs — nested payloads (mirrors backend autoMapFromSchema)', () => {
  // Regression: BambooHR webhook nests fields under `data.*` and the schema lists
  // them at the top level. The backend resolves `employeeId` ← `data.employeeId`,
  // but View Params used to only check top-level keys and showed `null`.
  it('matches schema field against last segment of nested payload key', () => {
    const schema: TriggerInputSchema = [
      { field_name: 'employeeId', field_data_type: 'String', default_value: '' },
      { field_name: 'companyId', field_data_type: 'String', default_value: '' },
    ];
    const inputData = {
      __rawPayload: {
        type: 'employee.updated',
        data: { companyId: '778076', employeeId: '86' },
        timestamp: '2026-04-29T21:04:05Z',
      },
    };
    const result = resolveDisplayInputs(inputData, schema);
    expect(result.employeeId).toBe('86');
    expect(result.companyId).toBe('778076');
  });

  it('prefers shallower path when the same field exists at multiple depths', () => {
    const schema: TriggerInputSchema = [
      { field_name: 'employeeId', field_data_type: 'String', default_value: '' },
    ];
    const inputData = {
      __rawPayload: {
        employeeId: 'top',
        data: { employeeId: 'nested' },
      },
    };
    const result = resolveDisplayInputs(inputData, schema);
    expect(result.employeeId).toBe('top');
  });

  it('still returns null when schema field is not present anywhere in payload', () => {
    const schema: TriggerInputSchema = [
      { field_name: 'employeeId', field_data_type: 'String', default_value: '' },
      { field_name: 'missingField', field_data_type: 'String', default_value: '' },
    ];
    const inputData = {
      __rawPayload: { data: { employeeId: '86' } },
    };
    const result = resolveDisplayInputs(inputData, schema);
    expect(result.employeeId).toBe('86');
    expect(result.missingField).toBeNull();
  });
});

describe('resolveDisplayInputs — __rawPayload + JSON Schema format', () => {
  const jsonSchema: TriggerInputSchema = {
    properties: {
      project_id: { type: 'string', title: 'Project ID' },
      amount: { type: 'number', title: 'Amount' },
    },
  };

  it('filters to JSON schema fields', () => {
    const inputData = {
      __rawPayload: { project_id: 'P-1', amount: 500, internal_ref: 'skip' },
    };
    const result = resolveDisplayInputs(inputData, jsonSchema);
    expect(result).toEqual({ project_id: 'P-1', amount: 500 });
    expect(result).not.toHaveProperty('internal_ref');
  });
});

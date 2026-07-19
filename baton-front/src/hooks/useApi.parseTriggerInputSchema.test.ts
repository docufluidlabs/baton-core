/**
 * Tests for parseTriggerInputSchema
 * Verifies: Maestro array format, JSON Schema format, system field filtering, null/empty handling.
 */
import { describe, it, expect } from 'vitest';
import { parseTriggerInputSchema, type MaestroSchemaField, type JsonSchemaFormat } from './useApi';

describe('parseTriggerInputSchema', () => {
  // ─── null / undefined / empty ────────────────────────────

  it('returns empty array for undefined', () => {
    expect(parseTriggerInputSchema(undefined)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(parseTriggerInputSchema(null)).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(parseTriggerInputSchema([])).toEqual([]);
  });

  // ─── Maestro array format ────────────────────────────────

  it('parses Maestro array format fields', () => {
    const schema: MaestroSchemaField[] = [
      { field_name: 'firstName', field_data_type: 'String' },
      { field_name: 'age', field_data_type: 'Float' },
    ];

    const result = parseTriggerInputSchema(schema);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      key: 'firstName',
      label: 'firstName',
      type: 'string',
      dataType: 'String',
      enum: undefined,
      required: false,
      defaultValue: undefined,
    });
    expect(result[1].type).toBe('number'); // Float → number
    expect(result[1].dataType).toBe('Float');
  });

  it('filters out Maestro system fields (startDate, workflowBuilder, etc.)', () => {
    const schema: MaestroSchemaField[] = [
      { field_name: 'startDate', field_data_type: 'Date' },
      { field_name: 'workflowBuilder', field_data_type: 'String' },
      { field_name: 'workflowPreparer', field_data_type: 'String' },
      { field_name: 'workflowSigner', field_data_type: 'String' },
      { field_name: 'validField', field_data_type: 'String' },
    ];

    const result = parseTriggerInputSchema(schema);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('validField');
  });

  it('filters out Participants data type', () => {
    const schema: MaestroSchemaField[] = [
      { field_name: 'signer1', field_data_type: 'Participants' },
      { field_name: 'email', field_data_type: 'String' },
    ];

    const result = parseTriggerInputSchema(schema);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('email');
  });

  it('includes default_value from Maestro fields', () => {
    const schema: MaestroSchemaField[] = [
      { field_name: 'region', field_data_type: 'String', default_value: 'US' },
    ];

    expect(parseTriggerInputSchema(schema)[0].defaultValue).toBe('US');
  });

  // ─── JSON Schema format ──────────────────────────────────

  it('parses JSON Schema format with properties', () => {
    const schema: JsonSchemaFormat = {
      properties: {
        name: { type: 'string', title: 'Full Name' },
        count: { type: 'integer', description: 'Item count' },
      },
      required: ['name'],
    };

    const result = parseTriggerInputSchema(schema);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      key: 'name',
      label: 'Full Name',
      type: 'string',
      dataType: 'string',
      enum: undefined,
      required: true,
      defaultValue: undefined,
    });
    expect(result[1].label).toBe('Item count');
    expect(result[1].required).toBe(false);
  });

  it('filters system fields from JSON Schema', () => {
    const schema: JsonSchemaFormat = {
      properties: {
        startDate: { type: 'string' },
        workflowBuilder: { type: 'string' },
        email: { type: 'string' },
      },
    };

    const result = parseTriggerInputSchema(schema);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('email');
  });

  it('handles JSON Schema with enum values', () => {
    const schema: JsonSchemaFormat = {
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'disabled'] },
      },
    };

    const result = parseTriggerInputSchema(schema);
    expect(result[0].enum).toEqual(['active', 'paused', 'disabled']);
  });

  it('uses key as label when no title or description in JSON Schema', () => {
    const schema: JsonSchemaFormat = {
      properties: {
        myField: { type: 'string' },
      },
    };

    expect(parseTriggerInputSchema(schema)[0].label).toBe('myField');
  });

  it('handles JSON Schema without required array', () => {
    const schema: JsonSchemaFormat = {
      properties: {
        name: { type: 'string' },
      },
    };

    expect(parseTriggerInputSchema(schema)[0].required).toBe(false);
  });
});

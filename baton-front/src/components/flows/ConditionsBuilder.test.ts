import { describe, it, expect } from 'vitest';
import { toApiConditions, fromApiConditions, type Condition } from './ConditionsBuilder';

// ─── toApiConditions ────────────────────────────────────────

describe('toApiConditions', () => {
  it('empty array returns empty object', () => {
    expect(toApiConditions([])).toEqual({});
  });

  it('eq condition adds $. prefix', () => {
    const conditions: Condition[] = [
      { id: '1', field: 'status', operator: 'eq', value: 'active' },
    ];
    expect(toApiConditions(conditions)).toEqual({
      '$.status': { operator: 'eq', value: 'active' },
    });
  });

  it('preserves existing $. prefix', () => {
    const conditions: Condition[] = [
      { id: '1', field: '$.data.id', operator: 'eq', value: '5' },
    ];
    expect(toApiConditions(conditions)).toEqual({
      '$.data.id': { operator: 'eq', value: '5' },
    });
  });

  it('exists operator omits value', () => {
    const conditions: Condition[] = [
      { id: '1', field: 'name', operator: 'exists', value: '' },
    ];
    expect(toApiConditions(conditions)).toEqual({
      '$.name': { operator: 'exists' },
    });
  });

  it('not_exists operator omits value', () => {
    const conditions: Condition[] = [
      { id: '1', field: 'name', operator: 'not_exists', value: '' },
    ];
    expect(toApiConditions(conditions)).toEqual({
      '$.name': { operator: 'not_exists' },
    });
  });

  it('in operator splits comma-separated string', () => {
    const conditions: Condition[] = [
      { id: '1', field: 'status', operator: 'in', value: 'a, b, c' },
    ];
    expect(toApiConditions(conditions)).toEqual({
      '$.status': { operator: 'in', value: ['a', 'b', 'c'] },
    });
  });

  it('skips conditions with empty field', () => {
    const conditions: Condition[] = [
      { id: '1', field: '', operator: 'eq', value: 'test' },
      { id: '2', field: 'name', operator: 'eq', value: 'ok' },
    ];
    const result = toApiConditions(conditions);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['$.name']).toBeDefined();
  });

  it('multiple conditions', () => {
    const conditions: Condition[] = [
      { id: '1', field: 'a', operator: 'eq', value: '1' },
      { id: '2', field: 'b', operator: 'gt', value: '5' },
    ];
    const result = toApiConditions(conditions);
    expect(result['$.a']).toEqual({ operator: 'eq', value: '1' });
    expect(result['$.b']).toEqual({ operator: 'gt', value: '5' });
  });
});

// ─── fromApiConditions ──────────────────────────────────────

describe('fromApiConditions', () => {
  it('undefined returns empty array', () => {
    expect(fromApiConditions(undefined)).toEqual([]);
  });

  it('empty object returns empty array', () => {
    expect(fromApiConditions({})).toEqual([]);
  });

  it('parses operator spec', () => {
    const result = fromApiConditions({
      '$.status': { operator: 'eq', value: 'active' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('$.status');
    expect(result[0].operator).toBe('eq');
    expect(result[0].value).toBe('active');
  });

  it('array value joined with comma', () => {
    const result = fromApiConditions({
      '$.tags': { operator: 'in', value: ['a', 'b'] },
    });
    expect(result[0].value).toBe('a, b');
  });

  it('exists: value is empty string', () => {
    const result = fromApiConditions({
      '$.name': { operator: 'exists' },
    });
    expect(result[0].operator).toBe('exists');
    expect(result[0].value).toBe('');
  });

  it('raw string spec treated as eq', () => {
    const result = fromApiConditions({
      '$.field': 'some-value',
    });
    expect(result[0].operator).toBe('eq');
    expect(result[0].value).toBe('some-value');
  });

  it('each entry gets a unique id', () => {
    const result = fromApiConditions({
      '$.a': { operator: 'eq', value: '1' },
      '$.b': { operator: 'eq', value: '2' },
    });
    expect(result[0].id).toBeTruthy();
    expect(result[1].id).toBeTruthy();
    expect(result[0].id).not.toBe(result[1].id);
  });
});

// ─── Round-trip ─────────────────────────────────────────────

describe('toApiConditions -> fromApiConditions round-trip', () => {
  it('eq condition survives round-trip', () => {
    const original: Condition[] = [
      { id: '1', field: 'status', operator: 'eq', value: 'active' },
    ];
    const api = toApiConditions(original);
    const restored = fromApiConditions(api);
    expect(restored[0].field).toBe('$.status');
    expect(restored[0].operator).toBe('eq');
    expect(restored[0].value).toBe('active');
  });

  it('in condition survives round-trip', () => {
    const original: Condition[] = [
      { id: '1', field: 'tags', operator: 'in', value: 'a, b, c' },
    ];
    const api = toApiConditions(original);
    const restored = fromApiConditions(api);
    expect(restored[0].operator).toBe('in');
    expect(restored[0].value).toBe('a, b, c');
  });

  it('exists condition survives round-trip', () => {
    const original: Condition[] = [
      { id: '1', field: 'name', operator: 'exists', value: '' },
    ];
    const api = toApiConditions(original);
    const restored = fromApiConditions(api);
    expect(restored[0].operator).toBe('exists');
  });
});

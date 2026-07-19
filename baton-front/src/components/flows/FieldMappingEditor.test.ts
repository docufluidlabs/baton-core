import { describe, it, expect } from 'vitest';
import { toApiFieldMapping, fromApiFieldMapping, type FieldMapping } from './FieldMappingEditor';

// ─── toApiFieldMapping ──────────────────────────────────────

describe('toApiFieldMapping', () => {
  it('empty array returns empty object', () => {
    expect(toApiFieldMapping([])).toEqual({});
  });

  it('path mapping adds $. prefix', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: 'data.name', targetField: 'name', type: 'path' },
    ];
    expect(toApiFieldMapping(mappings)).toEqual({ name: '$.data.name' });
  });

  it('path mapping preserves existing $. prefix', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: '$.data.name', targetField: 'name', type: 'path' },
    ];
    expect(toApiFieldMapping(mappings)).toEqual({ name: '$.data.name' });
  });

  it('static mapping', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: '', targetField: 'env', type: 'static', value: 'production' },
    ];
    expect(toApiFieldMapping(mappings)).toEqual({
      env: { type: 'static', value: 'production' },
    });
  });

  it('static mapping uses sourceField as fallback', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: 'fallback-value', targetField: 'env', type: 'static' },
    ];
    expect(toApiFieldMapping(mappings)).toEqual({
      env: { type: 'static', value: 'fallback-value' },
    });
  });

  it('template mapping', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: 'Project {{id}}', targetField: 'title', type: 'template' },
    ];
    expect(toApiFieldMapping(mappings)).toEqual({
      title: { type: 'template', template: 'Project {{id}}' },
    });
  });

  it('skips entries with empty targetField', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: 'data.name', targetField: '', type: 'path' },
      { id: '2', sourceField: 'data.id', targetField: 'id', type: 'path' },
    ];
    const result = toApiFieldMapping(mappings);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.id).toBe('$.data.id');
  });

  it('mixed types in one array', () => {
    const mappings: FieldMapping[] = [
      { id: '1', sourceField: 'data.name', targetField: 'name', type: 'path' },
      { id: '2', sourceField: '', targetField: 'env', type: 'static', value: 'prod' },
      { id: '3', sourceField: '{{id}}', targetField: 'label', type: 'template' },
    ];
    const result = toApiFieldMapping(mappings);
    expect(result.name).toBe('$.data.name');
    expect(result.env).toEqual({ type: 'static', value: 'prod' });
    expect(result.label).toEqual({ type: 'template', template: '{{id}}' });
  });
});

// ─── fromApiFieldMapping ────────────────────────────────────

describe('fromApiFieldMapping', () => {
  it('undefined returns empty array', () => {
    expect(fromApiFieldMapping(undefined)).toEqual([]);
  });

  it('string spec maps to path type', () => {
    const result = fromApiFieldMapping({ name: '$.data.name' });
    expect(result).toHaveLength(1);
    expect(result[0].sourceField).toBe('$.data.name');
    expect(result[0].targetField).toBe('name');
    expect(result[0].type).toBe('path');
  });

  it('static object spec', () => {
    const result = fromApiFieldMapping({ env: { type: 'static', value: 'prod' } });
    expect(result[0].type).toBe('static');
    expect(result[0].value).toBe('prod');
    expect(result[0].sourceField).toBe('prod');
  });

  it('template object spec', () => {
    const result = fromApiFieldMapping({ title: { type: 'template', template: '{{name}}' } });
    expect(result[0].type).toBe('template');
    expect(result[0].sourceField).toBe('{{name}}');
  });

  it('unknown object type falls back to path', () => {
    const result = fromApiFieldMapping({ x: { type: 'unknown', foo: 'bar' } });
    expect(result[0].type).toBe('path');
  });
});

// ─── Round-trip ─────────────────────────────────────────────

describe('toApiFieldMapping -> fromApiFieldMapping round-trip', () => {
  it('path mappings survive round-trip', () => {
    const original: FieldMapping[] = [
      { id: '1', sourceField: 'data.name', targetField: 'name', type: 'path' },
    ];
    const api = toApiFieldMapping(original);
    const restored = fromApiFieldMapping(api);
    expect(restored[0].type).toBe('path');
    expect(restored[0].sourceField).toBe('$.data.name');
    expect(restored[0].targetField).toBe('name');
  });

  it('static mappings survive round-trip', () => {
    const original: FieldMapping[] = [
      { id: '1', sourceField: '', targetField: 'env', type: 'static', value: 'prod' },
    ];
    const api = toApiFieldMapping(original);
    const restored = fromApiFieldMapping(api);
    expect(restored[0].type).toBe('static');
    expect(restored[0].value).toBe('prod');
  });

  it('template mappings survive round-trip', () => {
    const original: FieldMapping[] = [
      { id: '1', sourceField: 'Project {{id}}', targetField: 'title', type: 'template' },
    ];
    const api = toApiFieldMapping(original);
    const restored = fromApiFieldMapping(api);
    expect(restored[0].type).toBe('template');
    expect(restored[0].sourceField).toBe('Project {{id}}');
  });
});

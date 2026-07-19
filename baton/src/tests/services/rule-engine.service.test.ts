import { describe, it, expect, vi } from 'vitest';
import { _testExports } from '../../services/rule-engine.service';

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(),
  TableNames: {},
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: {},
}));

const {
  getNestedValue,
  matchEventType,
  evaluateSingleCondition,
  evaluateConditions,
  resolveTemplate,
  mapFieldsToTriggerInputs,
  generateInstanceName,
} = _testExports;

// ─── getNestedValue ─────────────────────────────────────────

describe('getNestedValue', () => {
  it('returns top-level value', () => {
    expect(getNestedValue({ a: 1 }, 'a')).toBe(1);
  });

  it('returns deeply nested value', () => {
    expect(getNestedValue({ a: { b: { c: 3 } } }, 'a.b.c')).toBe(3);
  });

  it('returns undefined for missing key', () => {
    expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns undefined for null object', () => {
    expect(getNestedValue(null, 'a')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(getNestedValue({ a: 1 }, '')).toBeUndefined();
  });

  it('returns undefined when null in chain', () => {
    expect(getNestedValue({ a: { b: null } }, 'a.b.c')).toBeUndefined();
  });
});

// ─── matchEventType ─────────────────────────────────────────

describe('matchEventType', () => {
  it('matches exact event type', () => {
    expect(matchEventType('vendor.created', 'vendor.created')).toBe(true);
  });

  it('does not match different event type', () => {
    expect(matchEventType('vendor.created', 'vendor.updated')).toBe(false);
  });

  it('wildcard * matches anything', () => {
    expect(matchEventType('*', 'anything.here')).toBe(true);
  });

  it('prefix wildcard vendor.* matches vendor.created', () => {
    expect(matchEventType('vendor.*', 'vendor.created')).toBe(true);
  });

  it('prefix wildcard vendor.* matches vendor.updated', () => {
    expect(matchEventType('vendor.*', 'vendor.updated')).toBe(true);
  });

  it('prefix wildcard vendor.* does not match project.created', () => {
    expect(matchEventType('vendor.*', 'project.created')).toBe(false);
  });

  it('prefix wildcard vendor.* does not match bare vendor', () => {
    expect(matchEventType('vendor.*', 'vendor')).toBe(false);
  });

  it('nested wildcard a.b.* matches a.b.c', () => {
    expect(matchEventType('a.b.*', 'a.b.c')).toBe(true);
  });
});

// ─── evaluateSingleCondition ────────────────────────────────

describe('evaluateSingleCondition', () => {
  // Equality
  it('eq: string match', () => {
    expect(evaluateSingleCondition('hello', 'eq', 'hello')).toBe(true);
  });

  it('eq: string mismatch', () => {
    expect(evaluateSingleCondition('hello', 'eq', 'world')).toBe(false);
  });

  it('eq: number coerced to string', () => {
    expect(evaluateSingleCondition(123, 'eq', '123')).toBe(true);
  });

  it('equals alias', () => {
    expect(evaluateSingleCondition('a', 'equals', 'a')).toBe(true);
  });

  it('neq: mismatch returns true', () => {
    expect(evaluateSingleCondition('a', 'neq', 'b')).toBe(true);
  });

  it('neq: match returns false', () => {
    expect(evaluateSingleCondition('a', 'neq', 'a')).toBe(false);
  });

  it('not_equals alias', () => {
    expect(evaluateSingleCondition('a', 'not_equals', 'b')).toBe(true);
  });

  // Numeric comparisons
  it('gt: 10 > 5', () => {
    expect(evaluateSingleCondition(10, 'gt', 5)).toBe(true);
  });

  it('gt: 5 > 10 is false', () => {
    expect(evaluateSingleCondition(5, 'gt', 10)).toBe(false);
  });

  it('gt: equal returns false', () => {
    expect(evaluateSingleCondition(5, 'gt', 5)).toBe(false);
  });

  it('greater_than alias', () => {
    expect(evaluateSingleCondition(10, 'greater_than', 5)).toBe(true);
  });

  it('gte: equal returns true', () => {
    expect(evaluateSingleCondition(5, 'gte', 5)).toBe(true);
  });

  it('gte: greater returns true', () => {
    expect(evaluateSingleCondition(6, 'gte', 5)).toBe(true);
  });

  it('gte: less returns false', () => {
    expect(evaluateSingleCondition(4, 'gte', 5)).toBe(false);
  });

  it('lt: less returns true', () => {
    expect(evaluateSingleCondition(3, 'lt', 5)).toBe(true);
  });

  it('lt: greater returns false', () => {
    expect(evaluateSingleCondition(7, 'lt', 5)).toBe(false);
  });

  it('lte: equal returns true', () => {
    expect(evaluateSingleCondition(5, 'lte', 5)).toBe(true);
  });

  it('lte: less returns true', () => {
    expect(evaluateSingleCondition(4, 'lte', 5)).toBe(true);
  });

  it('string numeric comparison', () => {
    expect(evaluateSingleCondition('10', 'gt', '5')).toBe(true);
  });

  // Collection operators
  it('in: value in array', () => {
    expect(evaluateSingleCondition('a', 'in', ['a', 'b', 'c'])).toBe(true);
  });

  it('in: value not in array', () => {
    expect(evaluateSingleCondition('d', 'in', ['a', 'b', 'c'])).toBe(false);
  });

  it('in: numeric coercion', () => {
    expect(evaluateSingleCondition(1, 'in', ['1', '2'])).toBe(true);
  });

  it('in: non-array target returns false', () => {
    expect(evaluateSingleCondition('a', 'in', 'not-array')).toBe(false);
  });

  it('one_of alias', () => {
    expect(evaluateSingleCondition('b', 'one_of', ['a', 'b'])).toBe(true);
  });

  it('not_in: value absent', () => {
    expect(evaluateSingleCondition('d', 'not_in', ['a', 'b'])).toBe(true);
  });

  it('not_in: value present', () => {
    expect(evaluateSingleCondition('a', 'not_in', ['a', 'b'])).toBe(false);
  });

  // String operators
  it('contains: substring present', () => {
    expect(evaluateSingleCondition('hello world', 'contains', 'world')).toBe(true);
  });

  it('contains: case insensitive', () => {
    expect(evaluateSingleCondition('Hello', 'contains', 'hello')).toBe(true);
  });

  it('contains: absent', () => {
    expect(evaluateSingleCondition('hello', 'contains', 'xyz')).toBe(false);
  });

  it('not_contains: absent returns true', () => {
    expect(evaluateSingleCondition('hello', 'not_contains', 'xyz')).toBe(true);
  });

  it('not_contains: present returns false', () => {
    expect(evaluateSingleCondition('hello', 'not_contains', 'ell')).toBe(false);
  });

  it('starts_with: match', () => {
    expect(evaluateSingleCondition('hello', 'starts_with', 'hel')).toBe(true);
  });

  it('starts_with: case insensitive', () => {
    expect(evaluateSingleCondition('Hello', 'starts_with', 'hel')).toBe(true);
  });

  it('starts_with: no match', () => {
    expect(evaluateSingleCondition('hello', 'starts_with', 'world')).toBe(false);
  });

  it('ends_with: match', () => {
    expect(evaluateSingleCondition('hello', 'ends_with', 'llo')).toBe(true);
  });

  it('ends_with: no match', () => {
    expect(evaluateSingleCondition('hello', 'ends_with', 'xyz')).toBe(false);
  });

  // Existence operators
  it('exists: value present', () => {
    expect(evaluateSingleCondition('something', 'exists', null)).toBe(true);
  });

  it('exists: undefined returns false', () => {
    expect(evaluateSingleCondition(undefined, 'exists', null)).toBe(false);
  });

  it('exists: null returns false', () => {
    expect(evaluateSingleCondition(null, 'exists', null)).toBe(false);
  });

  it('not_exists: undefined returns true', () => {
    expect(evaluateSingleCondition(undefined, 'not_exists', null)).toBe(true);
  });

  it('not_exists: null returns true', () => {
    expect(evaluateSingleCondition(null, 'not_exists', null)).toBe(true);
  });

  it('not_exists: value present returns false', () => {
    expect(evaluateSingleCondition('x', 'not_exists', null)).toBe(false);
  });

  // Regex
  it('regex: match', () => {
    expect(evaluateSingleCondition('abc-123', 'regex', '^abc-\\d+$')).toBe(true);
  });

  it('regex: no match', () => {
    expect(evaluateSingleCondition('xyz', 'regex', '^abc')).toBe(false);
  });

  it('regex: invalid pattern returns false gracefully', () => {
    expect(evaluateSingleCondition('abc', 'regex', '[invalid')).toBe(false);
  });

  // Unknown operator
  it('unknown operator returns false', () => {
    expect(evaluateSingleCondition('a', 'bogus', 'b')).toBe(false);
  });
});

// ─── evaluateConditions ─────────────────────────────────────

describe('evaluateConditions', () => {
  it('no conditions returns matched', () => {
    expect(evaluateConditions(undefined, {}).matched).toBe(true);
  });

  it('empty conditions object returns matched', () => {
    expect(evaluateConditions({}, {}).matched).toBe(true);
  });

  it('empty rules array returns matched', () => {
    expect(evaluateConditions({ rules: [] }, {}).matched).toBe(true);
  });

  it('AND: all pass returns matched', () => {
    const conditions = {
      operator: 'and',
      rules: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'count', operator: 'gt', value: 0 },
      ],
    };
    const payload = { status: 'active', count: 5 };
    expect(evaluateConditions(conditions, payload).matched).toBe(true);
  });

  it('AND: one fails returns not matched with reason', () => {
    const conditions = {
      operator: 'and',
      rules: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'count', operator: 'gt', value: 10 },
      ],
    };
    const payload = { status: 'active', count: 5 };
    const result = evaluateConditions(conditions, payload);
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('count');
  });

  it('OR: one passes returns matched', () => {
    const conditions = {
      operator: 'or',
      rules: [
        { field: 'status', operator: 'eq', value: 'wrong' },
        { field: 'status', operator: 'eq', value: 'active' },
      ],
    };
    const payload = { status: 'active' };
    expect(evaluateConditions(conditions, payload).matched).toBe(true);
  });

  it('OR: none pass returns not matched', () => {
    const conditions = {
      operator: 'or',
      rules: [
        { field: 'status', operator: 'eq', value: 'a' },
        { field: 'status', operator: 'eq', value: 'b' },
      ],
    };
    const payload = { status: 'c' };
    const result = evaluateConditions(conditions, payload);
    expect(result.matched).toBe(false);
  });

  it('nested field access', () => {
    const conditions = {
      rules: [{ field: 'data.project.id', operator: 'eq', value: '42' }],
    };
    const payload = { data: { project: { id: 42 } } };
    expect(evaluateConditions(conditions, payload).matched).toBe(true);
  });

  it('default operator is AND', () => {
    const conditions = {
      rules: [
        { field: 'a', operator: 'eq', value: '1' },
        { field: 'b', operator: 'eq', value: '2' },
      ],
    };
    const payload = { a: '1', b: 'wrong' };
    expect(evaluateConditions(conditions, payload).matched).toBe(false);
  });
});

// ─── resolveTemplate ────────────────────────────────────────

describe('resolveTemplate', () => {
  it('simple replacement', () => {
    expect(resolveTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('multiple replacements', () => {
    expect(resolveTemplate('{{a}} and {{b}}', { a: 'x', b: 'y' })).toBe('x and y');
  });

  it('nested path', () => {
    expect(resolveTemplate('{{data.id}}', { data: { id: 42 } })).toBe('42');
  });

  it('missing variable becomes empty string', () => {
    expect(resolveTemplate('{{missing}}', {})).toBe('');
  });

  it('no variables returns plain text', () => {
    expect(resolveTemplate('plain text', {})).toBe('plain text');
  });
});

// ─── mapFieldsToTriggerInputs ───────────────────────────────

describe('mapFieldsToTriggerInputs', () => {
  it('no actionConfig passes the raw payload through as __rawPayload for auto-mapping', () => {
    const payload = { project_id: 'p-1' };
    expect(mapFieldsToTriggerInputs(undefined, payload)).toEqual({ __rawPayload: payload });
  });

  it('no fieldMapping key passes the raw payload through as __rawPayload for auto-mapping', () => {
    const payload = { deal: 42 };
    expect(mapFieldsToTriggerInputs({}, payload)).toEqual({ __rawPayload: payload });
  });

  it('path mapping with $. prefix', () => {
    const config = { fieldMapping: { name: '$.data.name' } };
    const payload = { data: { name: 'Test' } };
    expect(mapFieldsToTriggerInputs(config, payload)).toEqual({ name: 'Test' });
  });

  it('path mapping without $. prefix', () => {
    const config = { fieldMapping: { name: 'data.name' } };
    const payload = { data: { name: 'Test' } };
    expect(mapFieldsToTriggerInputs(config, payload)).toEqual({ name: 'Test' });
  });

  it('static mapping', () => {
    const config = { fieldMapping: { env: { type: 'static', value: 'production' } } };
    expect(mapFieldsToTriggerInputs(config, {})).toEqual({ env: 'production' });
  });

  it('template mapping', () => {
    const config = { fieldMapping: { title: { type: 'template', template: 'Project {{id}}' } } };
    const payload = { id: 42 };
    expect(mapFieldsToTriggerInputs(config, payload)).toEqual({ title: 'Project 42' });
  });

  it('mixed mappings', () => {
    const config = {
      fieldMapping: {
        name: '$.data.name',
        env: { type: 'static', value: 'prod' },
        label: { type: 'template', template: '{{type}} item' },
      },
    };
    const payload = { data: { name: 'Test' }, type: 'New' };
    const result = mapFieldsToTriggerInputs(config, payload);
    expect(result).toEqual({ name: 'Test', env: 'prod', label: 'New item' });
  });

  it('missing source field returns undefined', () => {
    const config = { fieldMapping: { name: '$.nonexistent' } };
    expect(mapFieldsToTriggerInputs(config, {})).toEqual({ name: undefined });
  });
});

// ─── generateInstanceName ───────────────────────────────────

describe('generateInstanceName', () => {
  it('includes rule name', () => {
    const result = generateInstanceName('My Rule', { eventType: 'test', eventLabel: 'Test' });
    expect(result).toContain('My Rule');
  });

  it('includes record ID when present', () => {
    const result = generateInstanceName('Rule', { eventType: 'test', eventLabel: 'Test', recordId: 'abc123' });
    expect(result).toContain('#abc123');
  });

  it('omits record ID when absent', () => {
    const result = generateInstanceName('Rule', { eventType: 'test', eventLabel: 'Test' });
    expect(result).not.toContain('#');
  });

  it('includes timestamp', () => {
    const result = generateInstanceName('Rule', { eventType: 'test', eventLabel: 'Test' });
    // Should contain date-like pattern: YYYY-MM-DD HH:MM:SS
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

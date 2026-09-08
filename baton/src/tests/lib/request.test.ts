import { describe, it, expect } from 'vitest';
import { headerString, queryString } from '../../lib/request';

describe('headerString', () => {
  it('passes plain strings through', () => {
    expect(headerString('sha256=abc')).toBe('sha256=abc');
  });

  it('joins multi-valued headers with a comma, matching String(array)', () => {
    expect(headerString(['a', 'b'])).toBe(String(['a', 'b']));
    expect(headerString(['a', 'b'])).toBe('a,b');
  });

  it('collapses absent values to an empty string', () => {
    expect(headerString(undefined)).toBe('');
  });
});

describe('queryString', () => {
  it('returns plain string values', () => {
    expect(queryString({ state: 'abc.def' }, 'state')).toBe('abc.def');
  });

  it('rejects arrays and objects instead of coercing them', () => {
    expect(queryString({ state: ['a', 'b'] }, 'state')).toBeUndefined();
    expect(queryString({ state: { nested: 'x' } }, 'state')).toBeUndefined();
  });

  it('returns undefined for missing keys', () => {
    expect(queryString({}, 'code')).toBeUndefined();
  });
});

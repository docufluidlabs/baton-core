import { describe, it, expect } from 'vitest';
import { headerString, queryString, rawBodyOf, parseWebhookBody, stringList } from '../../lib/request';

describe('rawBodyOf', () => {
  it('returns the buffer express.raw() captured', () => {
    const body = Buffer.from('{"a":1}');
    expect(rawBodyOf({ body })).toBe(body);
  });

  it('returns an empty buffer as a buffer', () => {
    expect(rawBodyOf({ body: Buffer.alloc(0) })).toBeInstanceOf(Buffer);
  });

  it('refuses a body that arrived parsed', () => {
    // What express.urlencoded / express.json leave behind when express.raw did not run.
    expect(rawBodyOf({ body: { module: 'Deals' } })).toBeNull();
    expect(rawBodyOf({ body: {} })).toBeNull();
  });

  it('refuses strings, arrays and missing bodies', () => {
    expect(rawBodyOf({ body: 'text' })).toBeNull();
    expect(rawBodyOf({ body: [1, 2] })).toBeNull();
    expect(rawBodyOf({ body: undefined })).toBeNull();
    expect(rawBodyOf({})).toBeNull();
  });
});

describe('parseWebhookBody', () => {
  it('parses JSON by default', () => {
    expect(parseWebhookBody(Buffer.from('{"event":"deal.created","id":7}'), 'application/json'))
      .toEqual({ event: 'deal.created', id: 7 });
    expect(parseWebhookBody(Buffer.from('[{"eventId":1}]'), undefined)).toEqual([{ eventId: 1 }]);
  });

  it('parses a form post into a flat object of strings', () => {
    const body = Buffer.from('module=Deals&operation=insert&ids=1%2C2&name=Acme+Corp');
    expect(parseWebhookBody(body, 'application/x-www-form-urlencoded'))
      .toEqual({ module: 'Deals', operation: 'insert', ids: '1,2', name: 'Acme Corp' });
  });

  it('recognises the form content type with a charset and in any case', () => {
    const body = Buffer.from('a=1');
    expect(parseWebhookBody(body, 'Application/X-WWW-Form-Urlencoded; charset=UTF-8')).toEqual({ a: '1' });
    expect(parseWebhookBody(body, ['application/x-www-form-urlencoded'])).toEqual({ a: '1' });
  });

  it('throws on a body that is not JSON', () => {
    expect(() => parseWebhookBody(Buffer.from('[object Object]'), 'application/json')).toThrow();
    expect(() => parseWebhookBody(Buffer.from(''), undefined)).toThrow();
  });
});

describe('stringList', () => {
  it('passes arrays through as strings', () => {
    expect(stringList(['a', 'b'])).toEqual(['a', 'b']);
    expect(stringList([1, 2])).toEqual(['1', '2']);
  });

  it('splits the comma-separated form-post spelling', () => {
    expect(stringList('123,456')).toEqual(['123', '456']);
    expect(stringList(' 123 , 456 ,')).toEqual(['123', '456']);
    expect(stringList('123')).toEqual(['123']);
  });

  it('returns an empty list for anything else', () => {
    expect(stringList(undefined)).toEqual([]);
    expect(stringList(null)).toEqual([]);
    expect(stringList('')).toEqual([]);
    expect(stringList({ a: 1 })).toEqual([]);
  });

  it('does not return the array it was given', () => {
    const ids = ['b', 'a'];
    stringList(ids).sort();
    expect(ids).toEqual(['b', 'a']);
  });
});

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

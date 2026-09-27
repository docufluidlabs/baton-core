import { describe, it, expect } from 'vitest';
import { safeEqual, verifyBasicAuth, credentialHeadersOf } from '../../lib/webhook-auth';

const basic = (username: string, password: string) =>
  'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

describe('safeEqual', () => {
  it('accepts identical strings', () => {
    expect(safeEqual('a-long-shared-token', 'a-long-shared-token')).toBe(true);
  });

  it('rejects different strings of the same length', () => {
    expect(safeEqual('token-aaaa', 'token-aaab')).toBe(false);
  });

  it('rejects strings of different length without throwing', () => {
    expect(safeEqual('short', 'a-much-longer-expected-value')).toBe(false);
    expect(safeEqual('', 'expected')).toBe(false);
  });

  it('compares multi-byte characters by value', () => {
    expect(safeEqual('pässwörd', 'pässwörd')).toBe(true);
    expect(safeEqual('pässwörd', 'password')).toBe(false);
  });
});

describe('verifyBasicAuth', () => {
  const stored = 'baton-zoho:s3cret-passw0rd';

  it('accepts the stored username and password', () => {
    expect(verifyBasicAuth(basic('baton-zoho', 's3cret-passw0rd'), stored)).toEqual({ ok: true });
  });

  it('supports colons in the password', () => {
    expect(verifyBasicAuth(basic('user', 'pa:ss:word'), 'user:pa:ss:word')).toEqual({ ok: true });
  });

  it('rejects a missing header with 401', () => {
    expect(verifyBasicAuth(undefined, stored)).toEqual({
      ok: false, status: 401, error: 'Missing Authorization header', reason: 'missing',
    });
    expect(verifyBasicAuth('', stored)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('rejects another scheme with 401', () => {
    expect(verifyBasicAuth('Bearer abc', stored)).toEqual({
      ok: false, status: 401, error: 'Invalid authorization scheme', reason: 'scheme',
    });
  });

  it('rejects credentials without a colon with 401', () => {
    const header = 'Basic ' + Buffer.from('no-colon-here').toString('base64');
    expect(verifyBasicAuth(header, stored)).toEqual({
      ok: false, status: 401, error: 'Malformed Authorization header', reason: 'malformed',
    });
  });

  it('rejects a wrong password and a wrong username alike', () => {
    const mismatch = { ok: false, status: 401, error: 'Invalid credentials', reason: 'mismatch' };
    expect(verifyBasicAuth(basic('baton-zoho', 'wrong'), stored)).toEqual(mismatch);
    expect(verifyBasicAuth(basic('someone-else', 's3cret-passw0rd'), stored)).toEqual(mismatch);
  });

  it('does not accept the username and password swapped or joined differently', () => {
    expect(verifyBasicAuth(basic('s3cret-passw0rd', 'baton-zoho'), stored)).toMatchObject({ ok: false });
    // "a:b" + "c" must not equal "a" + "b:c"
    expect(verifyBasicAuth(basic('a:b', 'c'), 'a:b:c')).toEqual({ ok: true });
    expect(verifyBasicAuth(basic('a', 'b:c'), 'a:b:c')).toEqual({ ok: true });
    expect(verifyBasicAuth(basic('a', 'b'), 'a:b:c')).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it('reports a stored secret that is not username:password as a 500', () => {
    expect(verifyBasicAuth(basic('user', 'pass'), 'just-a-token')).toEqual({
      ok: false, status: 500, error: 'Internal configuration error', reason: 'misconfigured',
    });
  });
});

describe('credentialHeadersOf', () => {
  it('names the header of a static token template', () => {
    expect(credentialHeadersOf({ type: 'static_token', headerName: 'X-Baton-Token' })).toEqual(['X-Baton-Token']);
  });

  it('names nothing for signature-based methods', () => {
    expect(credentialHeadersOf({ type: 'hmac_sha256', headerName: 'x-salesforce-signature' })).toEqual([]);
    expect(credentialHeadersOf({ type: 'basic_auth' })).toEqual([]);
    expect(credentialHeadersOf({ type: 'none' })).toEqual([]);
  });
});

describe('safeEqual - edge cases', () => {
  it('treats two empty strings as equal and an empty string as different from anything else', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('x', '')).toBe(false);
  });

  it('rejects a value that only shares a prefix with, or extends, the expected one', () => {
    expect(safeEqual('shared-token', 'shared-token-and-more')).toBe(false);
    expect(safeEqual('shared-token-and-more', 'shared-token')).toBe(false);
  });

  it('compares by bytes, so equal-length strings of different byte length differ', () => {
    // 'é' is one character and two bytes.
    expect(safeEqual('café', 'cafe')).toBe(false);
  });
});

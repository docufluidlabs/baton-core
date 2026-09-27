import { describe, it, expect } from 'vitest';
import { redactUrl, redactHeaders, REDACTED } from '../../lib/redact';

describe('redactUrl', () => {
  it('masks the OAuth code and state on a connection callback', () => {
    expect(redactUrl('/api/connections/docusign/callback?code=abc123&state=deadbeef'))
      .toBe(`/api/connections/docusign/callback?code=${REDACTED}&state=${REDACTED}`);
  });

  it('masks the Salesforce bootstrap token on a rule webhook URL', () => {
    expect(redactUrl('/api/webhooks/rule/' + 'k'.repeat(64) + '?bootstrap=one-time-token'))
      .toBe('/api/webhooks/rule/' + 'k'.repeat(64) + `?bootstrap=${REDACTED}`);
  });

  it('keeps parameters that are not credentials', () => {
    expect(redactUrl('/api/instances?limit=50&status=running&cursor=abc'))
      .toBe('/api/instances?limit=50&status=running&cursor=abc');
  });

  it('masks only the sensitive values in a mixed query, preserving order', () => {
    expect(redactUrl('/x?limit=10&access_token=t0k3n&status=ok&client_secret=s3cr3t'))
      .toBe(`/x?limit=10&access_token=${REDACTED}&status=ok&client_secret=${REDACTED}`);
  });

  it.each([
    'token', 'access_token', 'refresh_token', 'id_token', 'baton_token',
    'key', 'api_key', 'apikey', 'hapikey', 'secret', 'client_secret',
    'password', 'signature', 'sig', 'code', 'state', 'bootstrap',
  ])('treats "%s" as sensitive', (name) => {
    expect(redactUrl(`/p?${name}=value`)).toBe(`/p?${name}=${REDACTED}`);
  });

  it('matches names case-insensitively and after URL decoding', () => {
    expect(redactUrl('/p?Access_Token=a')).toBe(`/p?Access_Token=${REDACTED}`);
    // %74oken decodes to "token"
    expect(redactUrl('/p?%74oken=a')).toBe(`/p?%74oken=${REDACTED}`);
  });

  it('treats array-style names as the parameter they address', () => {
    expect(redactUrl('/p?token[]=a&token[0]=b')).toBe(`/p?token[]=${REDACTED}&token[0]=${REDACTED}`);
  });

  it('handles full URLs and leaves the origin and path alone', () => {
    expect(redactUrl('https://baton.example.com/api/cb?code=abc&next=/flows'))
      .toBe(`https://baton.example.com/api/cb?code=${REDACTED}&next=/flows`);
  });

  it('masks credentials carried in the fragment', () => {
    expect(redactUrl('/cb#access_token=abc&expires_in=3600'))
      .toBe(`/cb#access_token=${REDACTED}&expires_in=3600`);
  });

  it('leaves a plain fragment and a path without a query untouched', () => {
    expect(redactUrl('/docs/setup#step-2')).toBe('/docs/setup#step-2');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });

  it('keeps valueless and empty parameters as they were', () => {
    expect(redactUrl('/p?flag&token=')).toBe(`/p?flag&token=${REDACTED}`);
    expect(redactUrl('/p?')).toBe('/p?');
  });

  it('never throws on malformed escapes or missing input', () => {
    expect(redactUrl('/p?%E0%A4%A=1&token=x')).toBe(`/p?%E0%A4%A=1&token=${REDACTED}`);
    expect(redactUrl(undefined)).toBe('');
    expect(redactUrl(null)).toBe('');
    expect(redactUrl('')).toBe('');
  });

  it('does not leak the value anywhere in the output', () => {
    const out = redactUrl('/cb?code=SUPERSECRETCODE&state=SUPERSECRETSTATE');
    expect(out).not.toContain('SUPERSECRET');
  });
});

describe('redactHeaders', () => {
  it('masks credentials and keeps the authorization scheme', () => {
    const out = redactHeaders({
      authorization: 'Basic dXNlcjpwYXNz',
      'proxy-authorization': 'Bearer abc.def.ghi',
      cookie: 'baton_session=xyz',
    });
    expect(out).toEqual({
      authorization: `Basic ${REDACTED}`,
      'proxy-authorization': `Bearer ${REDACTED}`,
      cookie: REDACTED,
    });
  });

  it('masks an authorization header that has no scheme', () => {
    expect(redactHeaders({ authorization: 'rawtokenvalue' })).toEqual({ authorization: REDACTED });
  });

  it('masks token, secret and api-key headers by name', () => {
    const out = redactHeaders({
      'x-api-key': 'k',
      'x-baton-token': 't',
      'x-zoho-webhook-token': 'z',
      'x-client-secret': 's',
      'x-apikey': 'a',
    });
    expect(Object.values(out!)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it('keeps signatures, timestamps and descriptive headers', () => {
    const headers = {
      'x-hubspot-signature-v3': 'c2lnbmF0dXJl',
      'x-zendesk-webhook-signature': 'sig',
      'x-bamboohr-timestamp': '1700000000',
      'content-type': 'application/json',
      'user-agent': 'Zendesk Webhook',
      'x-baton-sf-org-id': '00D000000000001',
    };
    expect(redactHeaders(headers)).toEqual(headers);
  });

  it('masks headers named by the caller, whatever they are called', () => {
    const out = redactHeaders({ 'X-Shared-Value': 'abc', 'content-type': 'application/json' }, ['x-shared-value']);
    expect(out).toEqual({ 'X-Shared-Value': REDACTED, 'content-type': 'application/json' });
  });

  it('redacts credentials inside URL-valued headers', () => {
    const out = redactHeaders({
      'x-baton-request-uri': 'https://baton.example.com/api/webhooks/hubspot?token=abc',
      referer: 'https://app.example.com/cb?code=xyz',
    });
    expect(out).toEqual({
      'x-baton-request-uri': `https://baton.example.com/api/webhooks/hubspot?token=${REDACTED}`,
      referer: `https://app.example.com/cb?code=${REDACTED}`,
    });
  });

  it('returns a copy and leaves the input untouched', () => {
    const headers = { authorization: 'Basic abc' };
    const out = redactHeaders(headers);
    expect(out).not.toBe(headers);
    expect(headers.authorization).toBe('Basic abc');
  });

  it('passes undefined through', () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });
});

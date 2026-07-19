import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    SMARTSHEET_CLIENT_ID: 'test-id',
    SMARTSHEET_CLIENT_SECRET: 'test-secret',
    SMARTSHEET_REDIRECT_URI: 'http://localhost:3001/api/connections/smartsheet/callback',
    API_URL: 'http://localhost:3001',
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { SmartsheetConnector } from '../../services/connectors/smartsheet.connector';

let connector: SmartsheetConnector;

beforeEach(() => {
  mockFetch.mockReset();
  connector = new SmartsheetConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('normalizes objectType and eventType to lowercase dot notation', () => {
    const payload = {
      webhookId: 'wh-100',
      scope: 'sheet',
      scopeObjectId: 'sheet-200',
      events: [
        { objectType: 'sheet', eventType: 'updated', id: 'evt-1', userId: 'user-5', rowId: 'row-10', columnId: 'col-20' },
      ],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('sheet.updated');
    expect(result.eventLabel).toContain('Sheet');
    expect(result.eventLabel).toContain('Updated');
    expect(result.recordId).toBe('evt-1');
    expect(result.actingUserId).toBe('user-5');
    expect(result.rawEventType).toBe('sheet.updated');
  });

  it('returns unknown when events array is empty', () => {
    const payload = { webhookId: 'wh-100', scope: 'sheet', events: [] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown');
    expect(result.eventLabel).toContain('Unknown');
  });

  it('returns unknown when events key is missing', () => {
    const result = connector.extractEventInfo({ webhookId: 'wh-100' });

    expect(result.eventType).toBe('unknown');
  });

  it('includes webhookId, scope, rowId, and columnId in metadata', () => {
    const payload = {
      webhookId: 'wh-300',
      scope: 'sheet',
      scopeObjectId: 'sheet-400',
      events: [
        { objectType: 'row', eventType: 'created', id: 'r-1', userId: 'u-1', rowId: 'row-55', columnId: 'col-66' },
      ],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.metadata?.webhookId).toBe('wh-300');
    expect(result.metadata?.scope).toBe('sheet');
    expect(result.metadata?.scopeObjectId).toBe('sheet-400');
    expect(result.metadata?.rowId).toBe('row-55');
    expect(result.metadata?.columnId).toBe('col-66');
  });

  it('extracts actingUserId from event.userId', () => {
    const payload = {
      webhookId: 'wh-500',
      events: [{ objectType: 'comment', eventType: 'created', id: 'c-1', userId: 'user-99' }],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.actingUserId).toBe('user-99');
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'smartsheet-webhook-secret';

  function computeHmac(body: Buffer, key: string): string {
    return crypto
      .createHmac('sha256', key)
      .update(body)
      .digest('base64');
  }

  it('accepts a valid signature via smartsheet-hmac-sha256 header', () => {
    const body = Buffer.from('{"events":[]}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'smartsheet-hmac-sha256': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('accepts a valid signature via Smartsheet-Hmac-SHA256 header', () => {
    const body = Buffer.from('{"events":[{"objectType":"row"}]}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'Smartsheet-Hmac-SHA256': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('accepts a valid signature via smartsheet-hmac-sha-256 header', () => {
    const body = Buffer.from('{"data":"test"}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'smartsheet-hmac-sha-256': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('rejects an invalid signature', () => {
    const body = Buffer.from('{"events":[]}');
    // Compute a valid-length base64 string that does not match
    const wrongSig = computeHmac(Buffer.from('different-body'), secret);

    const result = connector.verifyWebhookSignature(body, {
      'smartsheet-hmac-sha256': wrongSig,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('returns invalid when signature header is missing', () => {
    const body = Buffer.from('test');

    const result = connector.verifyWebhookSignature(body, {}, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns 11 event types with required properties', () => {
    const types = connector.getSupportedEventTypes();

    expect(types).toHaveLength(11);
    for (const t of types) {
      expect(t).toHaveProperty('eventType');
      expect(t).toHaveProperty('label');
      expect(t).toHaveProperty('description');
      expect(typeof t.eventType).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(typeof t.description).toBe('string');
    }
  });
});

// ─── authorize ───────────────────────────────────────────────

describe('authorize', () => {
  it('returns a redirectUrl pointing to Smartsheet and a state string', async () => {
    const result = await connector.authorize('org-1', 'user-1');

    expect(result).toHaveProperty('redirectUrl');
    expect(result).toHaveProperty('state');
    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    expect(result.redirectUrl).toContain('app.smartsheet.com/b/authorize');
    expect(result.redirectUrl).toContain('client_id=test-id');
    expect(result.redirectUrl).toContain('redirect_uri=');
  });
});

// ─── handleCallback ──────────────────────────────────────────

describe('handleCallback', () => {
  it('exchanges code for tokens and fetches user info', async () => {
    // First call: token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'ss-access-abc',
        refresh_token: 'ss-refresh-xyz',
        expires_in: 604800,
        token_type: 'Bearer',
        scope: 'READ_SHEETS WRITE_SHEETS',
      }),
    });
    // Second call: fetch current user (/users/me)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 12345,
        firstName: 'Test',
        lastName: 'User',
        email: 'test@smartsheet.com',
      }),
    });

    const result = await connector.handleCallback({ code: 'auth-code-ss', state: 'state-val' });

    expect(result.accessToken).toBe('ss-access-abc');
    expect(result.refreshToken).toBe('ss-refresh-xyz');
    expect(result.expiresIn).toBe(604800);
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw?.userInfo).toBeDefined();
    expect(result.raw?.userInfo.email).toBe('test@smartsheet.com');

    // Verify token exchange was called with token URL
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toContain('api.smartsheet.com/2.0/token');

    // Verify the code hash was included in the request body
    const bodyStr = tokenCall[1].body;
    expect(bodyStr).toContain('hash=');
  });

  it('throws on failed token exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      connector.handleCallback({ code: 'bad-code', state: 'state-val' }),
    ).rejects.toThrow('Smartsheet OAuth Error');
  });
});

// ─── refreshToken ────────────────────────────────────────────

describe('refreshToken', () => {
  it('returns new tokens on successful refresh with hash of secret|refreshToken', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-ss-access',
        refresh_token: 'new-ss-refresh',
        expires_in: 604800,
        token_type: 'Bearer',
        scope: 'READ_SHEETS',
      }),
    });

    const result = await connector.refreshToken('old-ss-refresh');

    expect(result.accessToken).toBe('new-ss-access');
    expect(result.refreshToken).toBe('new-ss-refresh');
    expect(result.expiresIn).toBe(604800);
    expect(result.createdAt).toBeGreaterThan(0);

    // Verify hash was included
    const fetchCall = mockFetch.mock.calls[0];
    const bodyStr = fetchCall[1].body;
    expect(bodyStr).toContain('hash=');

    // Verify the hash is SHA256 of clientSecret|refreshToken
    const expectedHash = crypto
      .createHash('sha256')
      .update('test-secret|old-ss-refresh')
      .digest('hex');
    expect(bodyStr).toContain(`hash=${expectedHash}`);
  });

  it('throws on failed refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'token_expired',
    });

    await expect(connector.refreshToken('expired-token')).rejects.toThrow(
      'Smartsheet Refresh Error',
    );
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('returns healthy with user info when /users/me responds OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      }),
    });

    const result = await connector.testConnection('valid-token');

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('Jane');
    expect(result.message).toContain('Doe');
    expect(result.details?.email).toBe('jane@example.com');
    expect(result.details?.firstName).toBe('Jane');
    expect(result.details?.lastName).toBe('Doe');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when API returns an error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await connector.testConnection('bad-token');

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('403');
  });
});

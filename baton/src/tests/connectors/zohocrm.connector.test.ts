import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    ZOHO_CLIENT_ID: 'test-id',
    ZOHO_CLIENT_SECRET: 'test-secret',
    ZOHO_REDIRECT_URI: 'http://localhost:3001/api/connections/zohocrm/callback',
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

import { ZohoCRMConnector } from '../../services/connectors/zohocrm.connector';

let connector: ZohoCRMConnector;

beforeEach(() => {
  mockFetch.mockReset();
  connector = new ZohoCRMConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('normalizes "insert" operation to "created"', () => {
    const payload = { module: 'Deals', operation: 'insert', ids: ['id-1'] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('deals.created');
    expect(result.eventLabel).toContain('Deals');
    expect(result.eventLabel).toContain('Created');
  });

  it('normalizes "update" operation to "updated"', () => {
    const payload = { module: 'Contacts', operation: 'update', ids: ['id-2'] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('contacts.updated');
  });

  it('normalizes "delete" operation to "deleted"', () => {
    const payload = { module: 'Leads', operation: 'delete', ids: ['id-3'] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('leads.deleted');
  });

  it('normalizes "convert" operation to "converted"', () => {
    const payload = { module: 'Leads', operation: 'convert', ids: ['id-4'] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('leads.converted');
  });

  it('handles v2 format with query_params and body', () => {
    const payload = {
      query_params: { module: 'Accounts', operation: 'insert' },
      body: { ids: ['acc-1', 'acc-2'] },
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('accounts.created');
    expect(result.recordId).toBe('acc-1');
    expect(result.summary).toContain('2 record(s)');
  });

  it('sets recordId from the first id in the array', () => {
    const payload = { module: 'Deals', operation: 'insert', ids: ['first-id', 'second-id', 'third-id'] };

    const result = connector.extractEventInfo(payload);

    expect(result.recordId).toBe('first-id');
  });

  it('includes module, operation, and recordIds in metadata', () => {
    const payload = { module: 'Vendors', operation: 'update', ids: ['v-1', 'v-2'] };

    const result = connector.extractEventInfo(payload);

    expect(result.metadata?.module).toBe('vendors');
    expect(result.metadata?.operation).toBe('update');
    expect(result.metadata?.recordIds).toEqual(['v-1', 'v-2']);
  });

  it('handles missing ids gracefully', () => {
    const payload = { module: 'Deals', operation: 'insert' };

    const result = connector.extractEventInfo(payload);

    expect(result.recordId).toBeUndefined();
    expect(result.summary).toContain('0 record(s)');
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  it('always returns { valid: true } since Zoho has no HMAC verification', () => {
    const body = Buffer.from('any-payload');

    const result = connector.verifyWebhookSignature(body, {}, '');

    expect(result).toEqual({ valid: true });
  });

  it('returns valid regardless of headers or secret values', () => {
    const body = Buffer.from('{"module":"Deals"}');

    const result = connector.verifyWebhookSignature(body, {
      'x-some-header': 'value',
    }, 'any-secret');

    expect(result.valid).toBe(true);
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns 15 event types with required properties', () => {
    const types = connector.getSupportedEventTypes();

    expect(types).toHaveLength(15);
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
  it('returns a redirectUrl containing access_type=offline and prompt=consent', async () => {
    const result = await connector.authorize('org-1', 'user-1');

    expect(result).toHaveProperty('redirectUrl');
    expect(result).toHaveProperty('state');
    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    expect(result.redirectUrl).toContain('accounts.zoho.com/oauth/v2/auth');
    expect(result.redirectUrl).toContain('access_type=offline');
    expect(result.redirectUrl).toContain('prompt=consent');
    expect(result.redirectUrl).toContain('client_id=test-id');
  });
});

// ─── handleCallback ──────────────────────────────────────────

describe('handleCallback', () => {
  it('exchanges code for tokens and fetches current user', async () => {
    // First call: token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'zoho-access-abc',
        refresh_token: 'zoho-refresh-xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'ZohoCRM.modules.ALL',
        api_domain: 'https://www.zohoapis.com',
      }),
    });
    // Second call: fetch current user
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        users: [{
          full_name: 'Test User',
          email: 'test@zoho.com',
          role: { name: 'Admin' },
          profile: { name: 'Administrator' },
        }],
      }),
    });

    const result = await connector.handleCallback({ code: 'auth-code-zoho', state: 'state-val' });

    expect(result.accessToken).toBe('zoho-access-abc');
    expect(result.refreshToken).toBe('zoho-refresh-xyz');
    expect(result.expiresIn).toBe(3600);
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw?.userInfo).toBeDefined();
    expect(result.raw?.userInfo.email).toBe('test@zoho.com');
    expect(result.raw?.api_domain).toBe('https://www.zohoapis.com');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toContain('accounts.zoho.com/oauth/v2/token');
  });

  it('throws when response contains data.error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: 'invalid_code',
      }),
    });

    await expect(
      connector.handleCallback({ code: 'bad-code', state: 'state-val' }),
    ).rejects.toThrow('Zoho CRM OAuth Error: invalid_code');
  });

  it('throws on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(
      connector.handleCallback({ code: 'bad-code', state: 'state-val' }),
    ).rejects.toThrow('Zoho CRM OAuth Error');
  });
});

// ─── refreshToken ────────────────────────────────────────────

describe('refreshToken', () => {
  it('returns new access token while keeping the same refresh token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-zoho-access',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const result = await connector.refreshToken('original-refresh-token');

    expect(result.accessToken).toBe('new-zoho-access');
    // Zoho does NOT return a new refresh_token, so the original is preserved
    expect(result.refreshToken).toBe('original-refresh-token');
    expect(result.expiresIn).toBe(3600);
    expect(result.createdAt).toBeGreaterThan(0);
  });

  it('throws when response contains data.error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: 'invalid_refresh_token',
      }),
    });

    await expect(connector.refreshToken('bad-refresh')).rejects.toThrow(
      'Zoho CRM Refresh Error: invalid_refresh_token',
    );
  });

  it('throws on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(connector.refreshToken('expired-token')).rejects.toThrow(
      'Zoho CRM Refresh Error',
    );
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('returns healthy with user info when API responds OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        users: [{
          full_name: 'Jane Zoho',
          email: 'jane@zoho.com',
          role: { name: 'CEO' },
          profile: { name: 'Administrator' },
        }],
      }),
    });

    const result = await connector.testConnection('valid-token');

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('Jane Zoho');
    expect(result.details?.fullName).toBe('Jane Zoho');
    expect(result.details?.email).toBe('jane@zoho.com');
    expect(result.details?.role).toBe('CEO');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when API returns an error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await connector.testConnection('bad-token');

    expect(result.healthy).toBe(false);
    expect(result.message).toContain('401');
  });
});

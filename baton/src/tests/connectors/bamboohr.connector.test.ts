import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    BAMBOOHR_CLIENT_ID: 'test-id',
    BAMBOOHR_CLIENT_SECRET: 'test-secret',
    BAMBOOHR_REDIRECT_URI: 'http://localhost:3001/api/connections/bamboohr/callback',
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

import { BambooHRConnector } from '../../services/connectors/bamboohr.connector';

let connector: BambooHRConnector;

beforeEach(() => {
  mockFetch.mockReset();
  connector = new BambooHRConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('returns employee.changed when changedFields is non-empty', () => {
    const payload = {
      employees: [{ id: 101, changedFields: ['firstName', 'lastName'] }],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('employee.changed');
    expect(result.eventLabel).toBe('Employee Changed');
    expect(result.recordId).toBe('101');
    expect(result.summary).toContain('firstName');
    expect(result.summary).toContain('lastName');
  });

  it('returns employee.created when changedFields is empty', () => {
    const payload = {
      employees: [{ id: 202, changedFields: [] }],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('employee.created');
    expect(result.eventLabel).toBe('Employee Created');
    expect(result.recordId).toBe('202');
    expect(result.summary).toContain('New employee created');
  });

  it('returns unknown when employees array is empty', () => {
    const payload = { employees: [] };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown');
    expect(result.eventLabel).toContain('Unknown');
  });

  it('returns unknown when employees key is missing', () => {
    const result = connector.extractEventInfo({});

    expect(result.eventType).toBe('unknown');
  });

  it('truncates changedFields with "..." when more than 3 fields', () => {
    const payload = {
      employees: [{ id: 303, changedFields: ['firstName', 'lastName', 'email', 'phone'] }],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.summary).toContain('firstName');
    expect(result.summary).toContain('lastName');
    expect(result.summary).toContain('email');
    expect(result.summary).toContain('...');
    expect(result.summary).not.toContain('phone');
  });

  it('does not truncate when exactly 3 fields', () => {
    const payload = {
      employees: [{ id: 404, changedFields: ['firstName', 'lastName', 'email'] }],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.summary).toContain('firstName');
    expect(result.summary).toContain('email');
    expect(result.summary).not.toContain('...');
  });

  it('includes employeeCount in metadata', () => {
    const payload = {
      employees: [
        { id: 1, changedFields: ['firstName'] },
        { id: 2, changedFields: ['lastName'] },
      ],
    };

    const result = connector.extractEventInfo(payload);

    expect(result.metadata?.employeeCount).toBe(2);
  });

  // ─── Новий формат (type + data) ────────────────────────────

  describe('новий формат workflow payload (type + data)', () => {
    it('розпізнає employee.updated з changedFields', () => {
      const payload = {
        type: 'employee.updated',
        data: {
          employeeId: 123,
          companyId: 'acme',
          changedFields: ['firstName', 'lastName'],
        },
        timestamp: '2025-04-24T10:00:00Z',
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('employee.updated');
      expect(result.eventLabel).toBe('Employee Updated');
      expect(result.recordId).toBe('123');
      expect(result.rawEventType).toBe('employee.updated');
      expect(result.summary).toContain('firstName');
      expect(result.summary).toContain('lastName');
      expect(result.metadata?.employeeId).toBe('123');
      expect(result.metadata?.companyId).toBe('acme');
      expect(result.metadata?.changedFields).toEqual(['firstName', 'lastName']);
    });

    it('розпізнає employee.created без changedFields', () => {
      const payload = {
        type: 'employee.created',
        data: { employeeId: 456, companyId: 'acme', changedFields: [] },
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('employee.created');
      expect(result.eventLabel).toBe('Employee Created');
      expect(result.recordId).toBe('456');
      expect(result.summary).toContain('456');
    });

    it('розпізнає employee.deleted', () => {
      const payload = {
        type: 'employee.deleted',
        data: { employeeId: 789, companyId: 'acme', changedFields: [] },
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('employee.deleted');
      expect(result.eventLabel).toBe('Employee Deleted');
      expect(result.recordId).toBe('789');
    });

    it('обрізає changedFields до 3 полів з "..."', () => {
      const payload = {
        type: 'employee.updated',
        data: {
          employeeId: 100,
          changedFields: ['firstName', 'lastName', 'email', 'phone'],
        },
      };

      const result = connector.extractEventInfo(payload);

      expect(result.summary).toContain('firstName');
      expect(result.summary).toContain('email');
      expect(result.summary).toContain('...');
      expect(result.summary).not.toContain('phone');
    });

    it('не обрізає при рівно 3 полях', () => {
      const payload = {
        type: 'employee.updated',
        data: {
          employeeId: 100,
          changedFields: ['firstName', 'lastName', 'email'],
        },
      };

      const result = connector.extractEventInfo(payload);

      expect(result.summary).toContain('email');
      expect(result.summary).not.toContain('...');
    });

    it('використовує type як eventLabel для невідомого типу', () => {
      const payload = {
        type: 'employee.transferred',
        data: { employeeId: 555, changedFields: [] },
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('employee.transferred');
      expect(result.eventLabel).toBe('employee.transferred');
    });

    it('новий формат має пріоритет над legacy при наявності обох', () => {
      const payload = {
        type: 'employee.updated',
        data: { employeeId: 11, changedFields: ['email'] },
        employees: [{ id: 99, changedFields: ['phone'] }],
      };

      const result = connector.extractEventInfo(payload);

      expect(result.recordId).toBe('11');
      expect(result.summary).toContain('email');
      expect(result.summary).not.toContain('phone');
    });
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'bamboo-webhook-secret';

  function computeHmac(body: string, timestamp: string, key: string): string {
    return crypto
      .createHmac('sha256', key)
      .update(body + timestamp)
      .digest('hex');
  }

  it('accepts a valid HMAC signature', () => {
    const bodyStr = '{"employees":[{"id":1}]}';
    const body = Buffer.from(bodyStr);
    const timestamp = '1700000000';
    const signature = computeHmac(bodyStr, timestamp, secret);

    const result = connector.verifyWebhookSignature(body, {
      'x-bamboohr-timestamp': timestamp,
      'x-bamboohr-signature': signature,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('rejects an invalid signature', () => {
    const body = Buffer.from('{"test":true}');
    const timestamp = '1700000000';

    const result = connector.verifyWebhookSignature(body, {
      'x-bamboohr-timestamp': timestamp,
      'x-bamboohr-signature': 'invalid-hex-signature-value-that-is-64-chars-long-aaaaaaaaaaaaaaaa',
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('returns invalid when required headers are missing', () => {
    const body = Buffer.from('test');

    const result = connector.verifyWebhookSignature(body, {}, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('returns invalid when secret is not configured', () => {
    const body = Buffer.from('test');

    const result = connector.verifyWebhookSignature(body, {
      'x-bamboohr-timestamp': '1700000000',
      'x-bamboohr-signature': 'some-sig',
    }, '');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not configured');
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns event types with required properties', () => {
    const types = connector.getSupportedEventTypes();

    expect(types.length).toBeGreaterThan(0);
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
  it('encodes companyDomain in state as base64url JSON', async () => {
    const result = await connector.authorize('org-1', 'user-1', 'mycompany');

    expect(result).toHaveProperty('redirectUrl');
    expect(result).toHaveProperty('state');
    expect(result.redirectUrl).toContain('mycompany.bamboohr.com');
    expect(result.redirectUrl).toContain('client_id=test-id');

    // Decode state and verify domain is embedded
    const statePayload = JSON.parse(Buffer.from(result.state, 'base64url').toString());
    expect(statePayload.domain).toBe('mycompany');
    expect(statePayload.nonce).toBeDefined();
  });

  it('defaults domain to "app" when companyDomain is not provided', async () => {
    const result = await connector.authorize('org-1', 'user-1');

    expect(result.redirectUrl).toContain('app.bamboohr.com');

    const statePayload = JSON.parse(Buffer.from(result.state, 'base64url').toString());
    expect(statePayload.domain).toBe('app');
  });
});

// ─── handleCallback ──────────────────────────────────────────

describe('handleCallback', () => {
  it('extracts companyDomain from state and exchanges code for tokens', async () => {
    const statePayload = { nonce: 'abc123', domain: 'acme' };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid offline_access',
      }),
    });

    const result = await connector.handleCallback({ code: 'auth-code', state });

    expect(result.accessToken).toBe('access-123');
    expect(result.refreshToken).toBe('refresh-456');
    expect(result.expiresIn).toBe(3600);
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw?.companyDomain).toBe('acme');

    // Verify fetch was called with acme domain
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('acme.bamboohr.com');
  });

  it('falls back to default domain when state JSON is invalid', async () => {
    const invalidState = Buffer.from('not-valid-json!!!').toString('base64url');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-fallback',
        refresh_token: 'refresh-fallback',
        expires_in: 3600,
      }),
    });

    const result = await connector.handleCallback({ code: 'auth-code', state: invalidState });

    expect(result.accessToken).toBe('access-fallback');
    expect(result.raw?.companyDomain).toBe('app');

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('app.bamboohr.com');
  });
});

// ─── refreshToken ────────────────────────────────────────────

describe('refreshToken', () => {
  it('returns new tokens on successful refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200,
        token_type: 'Bearer',
      }),
    });

    const result = await connector.refreshToken('old-refresh', 'mycompany');

    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBe('new-refresh');
    expect(result.expiresIn).toBe(7200);
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw?.companyDomain).toBe('mycompany');

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('mycompany.bamboohr.com');
  });

  it('throws on failed refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid_refresh_token',
    });

    await expect(connector.refreshToken('bad-token')).rejects.toThrow(
      'BambooHR Refresh Error',
    );
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('returns healthy when meta/fields API responds OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([{ id: 1, name: 'First Name' }]),
    });

    const result = await connector.testConnection('valid-token', 'acme');

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('acme.bamboohr.com');
    expect(result.details?.companyDomain).toBe('acme');
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    DOCUSIGN_INTEGRATION_KEY: 'test-integration-key',
    DOCUSIGN_SECRET_KEY: 'test-secret-key',
    DOCUSIGN_OAUTH_BASE: 'https://account-d.docusign.com',
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

import { DocuSignConnector, docusignConnector } from '../../services/connectors/docusign.connector';

// Fresh instance for tests (singleton is also exported but we can use our own)
let connector: DocuSignConnector;

beforeEach(() => {
  mockFetch.mockReset();
  connector = new DocuSignConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('extracts basic envelope event fields', () => {
    const payload = {
      event: 'envelope-sent',
      data: {
        envelopeId: 'env-123',
        envelopeSummary: {
          status: 'sent',
          emailSubject: 'Test',
          sender: { email: 'user@example.com' },
        },
      },
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('envelope.sent');
    expect(result.eventLabel).toContain('Envelope sent');
    expect(result.recordId).toBe('env-123');
    expect(result.rawEventType).toBe('envelope-sent');
  });

  it('normalizes dash to dot in event type', () => {
    const payload = { event: 'recipient-completed', data: { envelopeId: 'env-456' } };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('recipient.completed');
  });

  it('handles missing data fields gracefully', () => {
    const payload = { event: 'envelope-sent' };

    const result = connector.extractEventInfo(payload);

    expect(result.recordId).toBe('');
    expect(result.metadata?.envelopeId).toBe('');
  });

  it('extracts sender email from envelopeSummary', () => {
    const payload = {
      event: 'envelope-sent',
      data: {
        envelopeId: 'env-789',
        envelopeSummary: {
          status: 'sent',
          emailSubject: 'Please sign',
          sender: { email: 'sender@example.com' },
        },
      },
    };

    const result = connector.extractEventInfo(payload);

    expect(result.actingUserEmail).toBe('sender@example.com');
  });

  it('populates metadata with envelopeId, status, and subject', () => {
    const payload = {
      event: 'envelope-completed',
      data: {
        envelopeId: 'env-meta',
        envelopeSummary: {
          status: 'completed',
          emailSubject: 'Contract Review',
          sender: { email: 'admin@co.com' },
        },
      },
    };

    const result = connector.extractEventInfo(payload);

    expect(result.metadata).toEqual({
      envelopeId: 'env-meta',
      status: 'completed',
      subject: 'Contract Review',
    });
  });

  it('handles empty payload', () => {
    const result = connector.extractEventInfo({});

    expect(result.eventType).toBe('');
    expect(result.eventLabel).toBe('');
    expect(result.recordId).toBe('');
    expect(result.rawEventType).toBe('');
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'webhook-secret-key';

  function computeHmac(body: Buffer, key: string): string {
    return crypto
      .createHmac('sha256', Buffer.from(key, 'utf8'))
      .update(body)
      .digest('base64');
  }

  it('accepts a valid signature in x-docusign-signature-1', () => {
    const body = Buffer.from('{"event":"envelope-sent"}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'x-docusign-signature-1': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('rejects an invalid signature', () => {
    const body = Buffer.from('{"event":"envelope-sent"}');

    const result = connector.verifyWebhookSignature(body, {
      'x-docusign-signature-1': 'dGhpcyBpcyBub3QgdmFsaWQ=',
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('returns invalid when all signature headers are missing', () => {
    const body = Buffer.from('{"event":"test"}');

    const result = connector.verifyWebhookSignature(body, {}, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('accepts a valid signature in x-docusign-signature-2', () => {
    const body = Buffer.from('{"data":"second-header"}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'x-docusign-signature-2': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('accepts a valid signature in x-docusign-signature-3', () => {
    const body = Buffer.from('{"data":"third-header"}');
    const validSig = computeHmac(body, secret);

    const result = connector.verifyWebhookSignature(body, {
      'x-docusign-signature-3': validSig,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('handles length mismatch gracefully without throwing', () => {
    const body = Buffer.from('test');

    // Provide a signature whose base64 decoded length differs from the computed HMAC
    const result = connector.verifyWebhookSignature(body, {
      'x-docusign-signature-1': 'c2hvcnQ=',  // "short" in base64, different length than SHA-256
    }, secret);

    expect(result.valid).toBe(false);
  });
});

// ─── isTokenExpired (from BasePlatformConnector) ─────────────

describe('isTokenExpired', () => {
  it('returns true when token is expired', () => {
    const now = Math.floor(Date.now() / 1000);
    // Created 2 hours ago, expires in 1 hour (3600s) → expired 1 hour ago
    const createdAt = now - 7200;
    const expiresIn = 3600;

    expect(connector.isTokenExpired(createdAt, expiresIn)).toBe(true);
  });

  it('returns false when token is still valid', () => {
    const now = Math.floor(Date.now() / 1000);
    // Created just now, expires in 1 hour
    const createdAt = now;
    const expiresIn = 3600;

    expect(connector.isTokenExpired(createdAt, expiresIn)).toBe(false);
  });

  it('returns true when token is within the 5-minute buffer', () => {
    const now = Math.floor(Date.now() / 1000);
    // Token expires in 4 minutes (240s) — inside the 300s buffer
    const createdAt = now - 3600 + 240;
    const expiresIn = 3600;

    expect(connector.isTokenExpired(createdAt, expiresIn)).toBe(true);
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns 7 event types with required properties', () => {
    const types = connector.getSupportedEventTypes();

    expect(types).toHaveLength(7);
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
  it('returns a redirectUrl with oauth/auth and client_id, plus a state string', async () => {
    const result = await connector.authorize('org-1', 'user-1');

    expect(result).toHaveProperty('redirectUrl');
    expect(result).toHaveProperty('state');
    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    expect(result.redirectUrl).toContain('oauth/auth');
    expect(result.redirectUrl).toContain('client_id=test-integration-key');
    expect(result.redirectUrl).toContain('redirect_uri=');
  });
});

// ─── handleCallback ──────────────────────────────────────────

describe('handleCallback', () => {
  it('exchanges code for tokens and fetches userinfo', async () => {
    // First call: token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-abc',
        refresh_token: 'refresh-xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'signature extended',
      }),
    });
    // Second call: userinfo
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sub: 'user-sub-123',
        name: 'Test User',
        email: 'test@example.com',
        accounts: [{ account_id: 'acct-1' }],
      }),
    });

    const result = await connector.handleCallback({ code: 'auth-code-123', state: 'state-val' });

    expect(result.accessToken).toBe('access-abc');
    expect(result.refreshToken).toBe('refresh-xyz');
    expect(result.expiresIn).toBe(3600);
    expect(result.tokenType).toBe('Bearer');
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw?.userInfo).toBeDefined();
    expect(result.raw?.userInfo.email).toBe('test@example.com');

    // Verify token exchange was called with correct URL
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toContain('/oauth/token');
  });

  it('throws on failed token exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      connector.handleCallback({ code: 'bad-code', state: 'state-val' }),
    ).rejects.toThrow('DocuSign OAuth Error');
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

    const result = await connector.refreshToken('old-refresh-token');

    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBe('new-refresh');
    expect(result.expiresIn).toBe(7200);
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.raw).toBeDefined();

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/oauth/token');
  });

  it('throws on failed refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'token_expired',
    });

    await expect(connector.refreshToken('expired-token')).rejects.toThrow(
      'DocuSign Refresh Error',
    );
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('returns healthy when userinfo API responds OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'Test', email: 'test@test.com', sub: 'sub-1' }),
    });

    const result = await connector.testConnection('valid-token');

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('Test');
    expect(result.details).toEqual({ name: 'Test', email: 'test@test.com', sub: 'sub-1' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

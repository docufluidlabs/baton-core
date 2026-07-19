import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    PROCORE_CLIENT_ID: 'test-client-id',
    PROCORE_CLIENT_SECRET: 'test-secret',
    PROCORE_REDIRECT_URI: 'http://localhost:3001/api/connections/procore/callback',
    PROCORE_AUTH_URL: 'https://login.procore.com',
  },
}));
vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ProcoreConnector } from '../../services/connectors/procore.connector';

describe('ProcoreConnector', () => {
  let connector: ProcoreConnector;

  beforeEach(() => {
    connector = new ProcoreConnector();
    vi.clearAllMocks();
  });

  // ─── extractEventInfo ────────────────────────────────────────

  describe('extractEventInfo', () => {
    it('should extract event info from a standard Procore payload', () => {
      const payload = {
        resource_name: 'vendors',
        event_type: 'create',
        resource_id: '123',
        project_id: 'p1',
        company_id: 'c1',
        user_id: 'u1',
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('vendors.create');
      expect(result.eventLabel).toBe('Vendors Create');
      expect(result.recordId).toBe('123');
      expect(result.actingUserId).toBe('u1');
      expect(result.summary).toContain('Vendors');
      expect(result.summary).toContain('p1');
      expect(result.metadata).toEqual({
        projectId: 'p1',
        companyId: 'c1',
        resourceName: 'vendors',
        apiVersion: undefined,
      });
    });

    it('should default to "unknown" when resource_name and event_type are missing', () => {
      const payload = {};

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('unknown.unknown');
    });

    it('should convert resource_id to string for recordId', () => {
      const payload = {
        resource_name: 'projects',
        event_type: 'update',
        resource_id: 456,
      };

      const result = connector.extractEventInfo(payload);

      expect(result.recordId).toBe('456');
    });

    it('should extract actingUserId from user_id', () => {
      const payload = {
        resource_name: 'rfis',
        event_type: 'create',
        user_id: 'user-789',
      };

      const result = connector.extractEventInfo(payload);

      expect(result.actingUserId).toBe('user-789');
    });

    it('should include apiVersion in metadata when provided', () => {
      const payload = {
        resource_name: 'projects',
        event_type: 'create',
        api_version: 'v3',
      };

      const result = connector.extractEventInfo(payload);

      expect(result.metadata?.apiVersion).toBe('v3');
    });
  });

  // ─── verifyWebhookSignature ──────────────────────────────────

  describe('verifyWebhookSignature', () => {
    it('should return valid when x-procore-webhook-secret header matches the secret', () => {
      const secret = 'my-webhook-secret';
      const headers = { 'x-procore-webhook-secret': secret };
      const rawBody = Buffer.from('{}');

      const result = connector.verifyWebhookSignature(rawBody, headers, secret);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return valid when X-Procore-Webhook-Secret header (capitalized) matches', () => {
      const secret = 'my-webhook-secret';
      const headers = { 'X-Procore-Webhook-Secret': secret };
      const rawBody = Buffer.from('{}');

      const result = connector.verifyWebhookSignature(rawBody, headers, secret);

      expect(result.valid).toBe(true);
    });

    it('should return invalid when the secret does not match', () => {
      const secret = 'correct-secret-1';
      // Same byte length but different content
      const headers = { 'x-procore-webhook-secret': 'wrong---secret-1' };
      const rawBody = Buffer.from('{}');

      const result = connector.verifyWebhookSignature(rawBody, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Secret mismatch');
    });

    it('should return invalid with "Missing" reason when header is absent', () => {
      const secret = 'my-secret';
      const headers = {};
      const rawBody = Buffer.from('{}');

      const result = connector.verifyWebhookSignature(rawBody, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing');
    });

    it('should catch length mismatch between header and secret via timingSafeEqual', () => {
      const secret = 'short';
      const headers = { 'x-procore-webhook-secret': 'much-longer-secret-value' };
      const rawBody = Buffer.from('{}');

      // timingSafeEqual throws when buffers have different lengths;
      // the connector does not wrap this in a try-catch, so it throws
      expect(() =>
        connector.verifyWebhookSignature(rawBody, headers, secret),
      ).toThrow();
    });
  });

  // ─── getSupportedEventTypes ──────────────────────────────────

  describe('getSupportedEventTypes', () => {
    it('should return 11 supported event types', () => {
      const events = connector.getSupportedEventTypes();

      expect(events).toHaveLength(11);
      expect(events.every((e) => e.eventType && e.label && e.description)).toBe(true);
    });
  });

  // ─── authorize ───────────────────────────────────────────────

  describe('authorize', () => {
    it('should return a redirectUrl containing client_id and state', async () => {
      const result = await connector.authorize('org-1', 'user-1');

      expect(result.redirectUrl).toContain('client_id=test-client-id');
      expect(result.redirectUrl).toContain('state=');
      expect(result.redirectUrl).toContain('login.procore.com');
      expect(result.state).toBeDefined();
      expect(typeof result.state).toBe('string');
      expect(result.state.length).toBeGreaterThan(0);
    });
  });

  // ─── handleCallback ──────────────────────────────────────────

  describe('handleCallback', () => {
    it('should exchange code for tokens on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          expires_in: 7200,
          created_at: 1700000000,
          token_type: 'Bearer',
        }),
      });

      const result = await connector.handleCallback({
        code: 'auth-code',
        state: 'state-value',
      });

      expect(result.accessToken).toBe('access-123');
      expect(result.refreshToken).toBe('refresh-456');
      expect(result.expiresIn).toBe(7200);
      expect(result.createdAt).toBe(1700000000);
      expect(result.tokenType).toBe('Bearer');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should throw when the token exchange returns an error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(
        connector.handleCallback({ code: 'bad-code', state: 's' }),
      ).rejects.toThrow('Procore OAuth Error: 400 - Bad Request');
    });

    it('should throw when code is missing', async () => {
      await expect(
        connector.handleCallback({ code: '', state: 'state-value' }),
      ).rejects.toThrow('Authorization code is required');
    });
  });

  // ─── refreshToken ────────────────────────────────────────────

  describe('refreshToken', () => {
    it('should refresh tokens successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 7200,
          created_at: 1700001000,
          token_type: 'Bearer',
        }),
      });

      const result = await connector.refreshToken('old-refresh-token');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should throw when token refresh returns an error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        connector.refreshToken('expired-token'),
      ).rejects.toThrow('Procore Refresh Error: 401 - Unauthorized');
    });

    it('should throw when refresh token is empty', async () => {
      await expect(connector.refreshToken('')).rejects.toThrow(
        'Refresh token is required',
      );
    });
  });

  // ─── testConnection ──────────────────────────────────────────

  describe('testConnection', () => {
    it('should return healthy when API responds with 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: 'john@example.com', id: 42 }),
      });

      const result = await connector.testConnection('valid-token');

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('john@example.com');
      expect(result.details).toEqual({ login: 'john@example.com', id: 42 });
      expect(result.latencyMs).toBeDefined();
    });

    it('should return unhealthy when API responds with an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({}),
      });

      const result = await connector.testConnection('bad-token');

      expect(result.healthy).toBe(false);
      expect(result.message).toContain('403');
    });
  });
});

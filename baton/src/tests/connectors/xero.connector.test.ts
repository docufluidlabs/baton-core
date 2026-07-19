import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

vi.mock('../../env', () => ({
  default: {
    XERO_CLIENT_ID: 'test-xero-id',
    XERO_CLIENT_SECRET: 'test-xero-secret',
    XERO_REDIRECT_URI: 'http://localhost:3001/api/connections/xero/callback',
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

import { XeroConnector } from '../../services/connectors/xero.connector';

describe('XeroConnector', () => {
  let connector: XeroConnector;

  beforeEach(() => {
    connector = new XeroConnector();
    vi.clearAllMocks();
  });

  // ─── extractEventInfo ────────────────────────────────────────

  describe('extractEventInfo', () => {
    it('should extract and normalize event info from a standard Xero payload', () => {
      const payload = {
        events: [
          {
            resourceUrl: 'https://api.xero.com/api.xro/2.0/Invoices/inv-1',
            resourceId: 'inv-1',
            eventDateUtc: '2024-01-15T10:30:00Z',
            eventType: 'CREATE',
            eventCategory: 'INVOICE',
            tenantId: 'tenant-abc',
          },
        ],
        lastEventSequence: 5,
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('invoice.created');
      expect(result.eventLabel).toBe('Invoice Created');
      expect(result.recordId).toBe('inv-1');
      expect(result.metadata?.tenantId).toBe('tenant-abc');
    });

    it('should return "unknown" event when events array is empty', () => {
      const payload = { events: [] };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('unknown');
      expect(result.eventLabel).toBe('Unknown Xero Event');
      expect(result.summary).toBe('Empty Xero webhook payload');
    });

    it('should normalize UPDATE event type to "updated"', () => {
      const payload = {
        events: [
          {
            resourceId: 'c-1',
            eventType: 'UPDATE',
            eventCategory: 'CONTACT',
            tenantId: 't-1',
          },
        ],
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('contact.updated');
    });

    it('should normalize DELETE event type to "deleted"', () => {
      const payload = {
        events: [
          {
            resourceId: 'inv-2',
            eventType: 'DELETE',
            eventCategory: 'INVOICE',
            tenantId: 't-1',
          },
        ],
      };

      const result = connector.extractEventInfo(payload);

      expect(result.eventType).toBe('invoice.deleted');
    });

    it('should include tenantId, resourceUrl, and eventDateUtc in metadata', () => {
      const payload = {
        events: [
          {
            resourceUrl: 'https://api.xero.com/api.xro/2.0/Contacts/c-1',
            resourceId: 'c-1',
            eventDateUtc: '2024-03-01T08:00:00Z',
            eventType: 'CREATE',
            eventCategory: 'CONTACT',
            tenantId: 'tenant-xyz',
          },
        ],
        lastEventSequence: 12,
      };

      const result = connector.extractEventInfo(payload);

      expect(result.metadata).toEqual({
        tenantId: 'tenant-xyz',
        resourceUrl: 'https://api.xero.com/api.xro/2.0/Contacts/c-1',
        eventDateUtc: '2024-03-01T08:00:00Z',
        eventSequence: 12,
      });
    });

    it('should only process the first event when multiple events are present', () => {
      const payload = {
        events: [
          {
            resourceId: 'first-1',
            eventType: 'CREATE',
            eventCategory: 'INVOICE',
            tenantId: 't-1',
          },
          {
            resourceId: 'second-2',
            eventType: 'UPDATE',
            eventCategory: 'CONTACT',
            tenantId: 't-1',
          },
        ],
      };

      const result = connector.extractEventInfo(payload);

      expect(result.recordId).toBe('first-1');
      expect(result.eventType).toBe('invoice.created');
    });

    it('should preserve original case in rawEventType', () => {
      const payload = {
        events: [
          {
            resourceId: 'inv-3',
            eventType: 'CREATE',
            eventCategory: 'INVOICE',
            tenantId: 't-1',
          },
        ],
      };

      const result = connector.extractEventInfo(payload);

      expect(result.rawEventType).toBe('INVOICE.CREATE');
    });
  });

  // ─── verifyWebhookSignature ──────────────────────────────────

  describe('verifyWebhookSignature', () => {
    it('should return valid for a correct HMAC-SHA256 base64 signature', () => {
      const secret = 'xero-webhook-key';
      const body = Buffer.from('{"events":[]}');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64');

      const headers = { 'x-xero-signature': expectedSignature };

      const result = connector.verifyWebhookSignature(body, headers, secret);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return invalid when the signature does not match', () => {
      const secret = 'xero-webhook-key';
      const body = Buffer.from('{"events":[]}');
      // Compute a valid-format signature with a different secret to ensure same length
      const wrongSignature = crypto
        .createHmac('sha256', 'different-secret')
        .update(body)
        .digest('base64');
      const headers = { 'x-xero-signature': wrongSignature };

      const result = connector.verifyWebhookSignature(body, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature mismatch');
    });

    it('should return invalid when x-xero-signature header is missing', () => {
      const secret = 'xero-webhook-key';
      const body = Buffer.from('{}');
      const headers = {};

      const result = connector.verifyWebhookSignature(body, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Missing x-xero-signature header');
    });

    it('should return invalid when secret is not configured', () => {
      const body = Buffer.from('{}');
      const headers = { 'x-xero-signature': 'some-sig' };

      const result = connector.verifyWebhookSignature(body, headers, '');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Xero webhook key not configured');
    });

    it('should catch length mismatch and return failure reason', () => {
      const secret = 'xero-key';
      const body = Buffer.from('test-body');
      // Provide a signature whose base64-decoded length differs from the expected HMAC
      const headers = { 'x-xero-signature': 'short' };

      const result = connector.verifyWebhookSignature(body, headers, secret);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Signature comparison failed (length mismatch)');
    });
  });

  // ─── getSupportedEventTypes ──────────────────────────────────

  describe('getSupportedEventTypes', () => {
    it('should return 8 supported event types', () => {
      const events = connector.getSupportedEventTypes();

      expect(events).toHaveLength(8);
      expect(events.every((e) => e.eventType && e.label && e.description)).toBe(true);
    });
  });

  // ─── authorize ───────────────────────────────────────────────

  describe('authorize', () => {
    it('should return codeVerifier and a redirectUrl with PKCE parameters', async () => {
      const result = await connector.authorize('org-1', 'user-1');

      expect(result.codeVerifier).toBeDefined();
      expect(typeof result.codeVerifier).toBe('string');
      expect(result.codeVerifier!.length).toBeGreaterThan(0);
      expect(result.redirectUrl).toContain('code_challenge=');
      expect(result.redirectUrl).toContain('code_challenge_method=S256');
      expect(result.redirectUrl).toContain('client_id=test-xero-id');
      expect(result.state).toBeDefined();
    });
  });

  // ─── handleCallback ──────────────────────────────────────────

  describe('handleCallback', () => {
    it('should exchange code for tokens with codeVerifier and include tenants in raw', async () => {
      // First call: token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'xero-access-123',
          refresh_token: 'xero-refresh-456',
          expires_in: 1800,
          token_type: 'Bearer',
          scope: 'openid profile email',
        }),
      });
      // Second call: fetch tenants
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { tenantId: 't-1', tenantName: 'Org A', tenantType: 'ORGANISATION' },
        ],
      });

      const result = await connector.handleCallback({
        code: 'auth-code',
        state: 'state-val',
        codeVerifier: 'verifier-xyz',
      });

      expect(result.accessToken).toBe('xero-access-123');
      expect(result.refreshToken).toBe('xero-refresh-456');
      expect(result.expiresIn).toBe(1800);
      expect(result.tokenType).toBe('Bearer');
      expect(result.raw?.tenants).toEqual([
        { tenantId: 't-1', tenantName: 'Org A', tenantType: 'ORGANISATION' },
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when codeVerifier is missing', async () => {
      await expect(
        connector.handleCallback({ code: 'code', state: 'state' }),
      ).rejects.toThrow('codeVerifier');
    });

    it('should still return tokens when tenant fetch fails', async () => {
      // Token exchange succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-ok',
          refresh_token: 'refresh-ok',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
      });
      // Tenant fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await connector.handleCallback({
        code: 'code',
        state: 'state',
        codeVerifier: 'verifier',
      });

      expect(result.accessToken).toBe('access-ok');
      expect(result.raw?.tenants).toEqual([]);
    });
  });

  // ─── refreshToken ────────────────────────────────────────────

  describe('refreshToken', () => {
    it('should refresh tokens successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-xero-access',
          refresh_token: 'new-xero-refresh',
          expires_in: 1800,
          token_type: 'Bearer',
          scope: 'openid profile',
        }),
      });

      const result = await connector.refreshToken('old-refresh');

      expect(result.accessToken).toBe('new-xero-access');
      expect(result.refreshToken).toBe('new-xero-refresh');
      expect(result.expiresIn).toBe(1800);
    });

    it('should throw re-authorization message on 400 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });

      await expect(connector.refreshToken('bad-token')).rejects.toThrow(
        'Re-authorization required',
      );
    });

    it('should throw re-authorization message on 401 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(connector.refreshToken('expired-token')).rejects.toThrow(
        'Re-authorization required',
      );
    });

    it('should throw a generic error for other failure statuses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(connector.refreshToken('some-token')).rejects.toThrow(
        'Xero Refresh Error: 500 - Internal Server Error',
      );
    });
  });

  // ─── testConnection ──────────────────────────────────────────

  describe('testConnection', () => {
    it('should call /connections when tenantId is not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { tenantId: 't-1', tenantName: 'Org A' },
          { tenantId: 't-2', tenantName: 'Org B' },
        ],
      });

      const result = await connector.testConnection('valid-token');

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('2 tenant(s)');
      expect(result.details).toEqual({ tenantCount: 2 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.xero.com/connections',
        expect.objectContaining({
          headers: { Authorization: 'Bearer valid-token' },
        }),
      );
    });

    it('should call /Organisation when tenantId is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Organisations: [
            {
              Name: 'Test Corp',
              ShortCode: 'TC',
              Version: 'AU',
              OrganisationType: 'COMPANY',
            },
          ],
        }),
      });

      const result = await connector.testConnection('valid-token', 'tenant-123');

      expect(result.healthy).toBe(true);
      expect(result.message).toContain('Test Corp');
      expect(result.details).toEqual({
        orgName: 'Test Corp',
        shortCode: 'TC',
        version: 'AU',
        organisationType: 'COMPANY',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.xero.com/api.xro/2.0/Organisation',
        expect.objectContaining({
          headers: expect.objectContaining({
            'xero-tenant-id': 'tenant-123',
          }),
        }),
      );
    });
  });

  // ─── fetchTenants ────────────────────────────────────────────

  describe('fetchTenants', () => {
    it('should return an array of tenants on success', async () => {
      const tenantData = [
        {
          id: '1',
          authEventId: 'ae-1',
          tenantId: 't-1',
          tenantType: 'ORGANISATION',
          tenantName: 'Alpha Co',
          createdDateUtc: '2024-01-01T00:00:00Z',
          updatedDateUtc: '2024-01-02T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => tenantData,
      });

      const result = await connector.fetchTenants('access-token');

      expect(result).toEqual(tenantData);
      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.xero.com/connections',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
          }),
        }),
      );
    });

    it('should throw when the tenants API returns an error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(connector.fetchTenants('bad-token')).rejects.toThrow(
        'Failed to fetch Xero tenants: 403',
      );
    });
  });
});

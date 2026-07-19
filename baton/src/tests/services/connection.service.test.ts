import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { PLATFORM_CONNECTIONS: 'platform-connections' },
}));
vi.mock('../../lib/encryption', () => ({
  encryptToken: vi.fn((token: string) => `enc:${token}`),
  decryptToken: vi.fn((enc: string) => enc.replace('enc:', '')),
}));
vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../../lib/types', () => ({}));
vi.mock('../../services/connectors', () => ({}));

// Mock uuid
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-1234') }));

import {
  createConnection,
  getConnection,
  getConnectionsByOrg,
  getConnectionByOrgAndPlatform,
  getConnectionByAccountId,
  getAccessToken,
  getRefreshToken,
  updateTokens,
  updateConnectionStatus,
  updateConnectionMetadata,
  updateConnectionAccountId,
  deleteConnection,
} from '../../services/connection.service';

describe('connection.service', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  // ─── createConnection ──────────────────────────────────────

  describe('createConnection', () => {
    const baseParams = {
      orgId: 'org-1',
      platform: 'docusign' as const,
      displayName: 'My DocuSign',
      tokens: {
        accessToken: 'my-token',
        refreshToken: 'my-refresh',
        expiresIn: 3600,
        createdAt: 1700000000,
        scope: 'signature impersonation',
      },
    };

    it('should return a connection with id, status healthy, and encrypted accessTokenEnc', async () => {
      mockSend.mockResolvedValue({});

      const result = await createConnection(baseParams);

      expect(result.id).toBe('test-uuid-1234');
      expect(result.status).toBe('healthy');
      expect(result.accessTokenEnc).toBe('enc:my-token');
      expect(result.refreshTokenEnc).toBe('enc:my-refresh');
      expect(result.orgId).toBe('org-1');
      expect(result.platform).toBe('docusign');
      expect(result.displayName).toBe('My DocuSign');
      expect(result.scopes).toEqual(['signature', 'impersonation']);
    });

    it('should call mockSend with PutCommand', async () => {
      mockSend.mockResolvedValue({});

      await createConnection(baseParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('PutCommand');
      expect(call.input.TableName).toBe('platform-connections');
      expect(call.input.Item.id).toBe('test-uuid-1234');
    });

    it('should omit refreshTokenEnc when refreshToken is not provided', async () => {
      mockSend.mockResolvedValue({});

      const params = {
        ...baseParams,
        tokens: {
          accessToken: 'my-token',
          expiresIn: 3600,
          createdAt: 1700000000,
        },
      };

      const result = await createConnection(params);

      expect(result.refreshTokenEnc).toBeUndefined();
    });
  });

  // ─── getConnection ─────────────────────────────────────────

  describe('getConnection', () => {
    it('should return the Item as PlatformConnection when found', async () => {
      mockSend.mockResolvedValue({ Item: { id: 'conn-1', platform: 'docusign' } });

      const result = await getConnection('conn-1');

      expect(result).toEqual({ id: 'conn-1', platform: 'docusign' });
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({});

      const result = await getConnection('non-existent');

      expect(result).toBeNull();
    });
  });

  // ─── getConnectionsByOrg ───────────────────────────────────

  describe('getConnectionsByOrg', () => {
    it('should return Items array', async () => {
      const items = [
        { id: 'conn-1', orgId: 'org-1' },
        { id: 'conn-2', orgId: 'org-1' },
      ];
      mockSend.mockResolvedValue({ Items: items });

      const result = await getConnectionsByOrg('org-1');

      expect(result).toEqual(items);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await getConnectionsByOrg('org-1');

      expect(result).toEqual([]);
    });
  });

  // ─── getConnectionByOrgAndPlatform ─────────────────────────

  describe('getConnectionByOrgAndPlatform', () => {
    it('should return first Item', async () => {
      mockSend.mockResolvedValue({
        Items: [{ id: 'conn-1', orgId: 'org-1', platform: 'docusign' }],
      });

      const result = await getConnectionByOrgAndPlatform('org-1', 'docusign');

      expect(result).toEqual({ id: 'conn-1', orgId: 'org-1', platform: 'docusign' });
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getConnectionByOrgAndPlatform('org-1', 'docusign');

      expect(result).toBeNull();
    });
  });

  // ─── getConnectionByAccountId ──────────────────────────────

  describe('getConnectionByAccountId', () => {
    it('should return first Item from query', async () => {
      mockSend.mockResolvedValue({
        Items: [{ id: 'conn-1', accountId: 'acct-123' }],
      });

      const result = await getConnectionByAccountId('acct-123');

      expect(result).toEqual({ id: 'conn-1', accountId: 'acct-123' });
    });
  });

  // ─── getAccessToken ────────────────────────────────────────

  describe('getAccessToken', () => {
    it('should return decrypted access token', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { id: 'conn-1', accessTokenEnc: 'enc:access-123' },
      });

      const result = await getAccessToken('conn-1');

      expect(result).toBe('access-123');
    });

    it('should throw when connection not found', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(getAccessToken('non-existent')).rejects.toThrow(
        'No access token for connection non-existent',
      );
    });
  });

  // ─── getRefreshToken ───────────────────────────────────────

  describe('getRefreshToken', () => {
    it('should return decrypted refresh token', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { id: 'conn-1', refreshTokenEnc: 'enc:refresh-456' },
      });

      const result = await getRefreshToken('conn-1');

      expect(result).toBe('refresh-456');
    });

    it('should throw when no refreshTokenEnc', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { id: 'conn-1' },
      });

      await expect(getRefreshToken('conn-1')).rejects.toThrow(
        'No refresh token for connection conn-1',
      );
    });
  });

  // ─── updateTokens ─────────────────────────────────────────

  describe('updateTokens', () => {
    it('should call UpdateCommand with encrypted accessToken and status healthy', async () => {
      mockSend.mockResolvedValue({});

      await updateTokens('conn-1', {
        accessToken: 'new-access',
        expiresIn: 3600,
        createdAt: 1700000000,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('UpdateCommand');
      expect(call.input.Key).toEqual({ id: 'conn-1' });
      expect(call.input.ExpressionAttributeValues[':accessToken']).toBe('enc:new-access');
      expect(call.input.ExpressionAttributeValues[':status']).toBe('healthy');
      // refreshToken not included
      expect(call.input.UpdateExpression).not.toContain('refreshTokenEnc');
    });

    it('should include refreshTokenEnc when tokens.refreshToken is provided', async () => {
      mockSend.mockResolvedValue({});

      await updateTokens('conn-1', {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 3600,
        createdAt: 1700000000,
      });

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('refreshTokenEnc');
      expect(call.input.ExpressionAttributeValues[':refreshToken']).toBe('enc:new-refresh');
    });
  });

  // ─── updateConnectionStatus ────────────────────────────────

  describe('updateConnectionStatus', () => {
    it('should update status and updatedAt', async () => {
      mockSend.mockResolvedValue({});

      await updateConnectionStatus('conn-1', 'error');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('UpdateCommand');
      expect(call.input.ExpressionAttributeValues[':status']).toBe('error');
      expect(call.input.ExpressionAttributeValues[':updatedAt']).toBeDefined();
      expect(call.input.UpdateExpression).not.toContain('lastError');
    });

    it('should include lastError when error is provided', async () => {
      mockSend.mockResolvedValue({});

      await updateConnectionStatus('conn-1', 'error', 'Token expired');

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('lastError');
      expect(call.input.ExpressionAttributeValues[':error']).toBe('Token expired');
    });
  });

  // ─── updateConnectionMetadata ──────────────────────────────

  describe('updateConnectionMetadata', () => {
    it('should call UpdateCommand with metadata', async () => {
      mockSend.mockResolvedValue({});

      await updateConnectionMetadata('conn-1', { foo: 'bar' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('UpdateCommand');
      expect(call.input.ExpressionAttributeValues[':metadata']).toEqual({ foo: 'bar' });
    });
  });

  // ─── updateConnectionAccountId ─────────────────────────────

  describe('updateConnectionAccountId', () => {
    it('should call UpdateCommand with accountId', async () => {
      mockSend.mockResolvedValue({});

      await updateConnectionAccountId('conn-1', 'acct-999');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('UpdateCommand');
      expect(call.input.ExpressionAttributeValues[':accountId']).toBe('acct-999');
    });
  });

  // ─── deleteConnection ──────────────────────────────────────

  describe('deleteConnection', () => {
    it('should call mockSend with DeleteCommand', async () => {
      mockSend.mockResolvedValue({});

      await deleteConnection('conn-1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.constructor.name).toBe('DeleteCommand');
      expect(call.input.Key).toEqual({ id: 'conn-1' });
    });
  });
});

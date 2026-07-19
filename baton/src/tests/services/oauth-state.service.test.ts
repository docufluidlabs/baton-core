import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { OAUTH_STATES: 'baton-oauth-states' },
}));
vi.mock('../../lib/logger', () => ({ logDebug: vi.fn(), logError: vi.fn() }));
vi.mock('../../lib/types', () => ({}));

import { storeOAuthState, retrieveOAuthState } from '../../services/oauth-state.service';

beforeEach(() => {
  mockSend.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('storeOAuthState', () => {
  it('stores with ttl = now + 600', async () => {
    mockSend.mockResolvedValueOnce({});

    await storeOAuthState('state-abc', {
      orgId: 'org-1',
      userId: 'user-1',
      platform: 'docusign' as any,
    });

    const call = mockSend.mock.calls[0][0];
    const item = call.input.Item;
    const nowSec = Math.floor(new Date('2025-06-15T12:00:00Z').getTime() / 1000);
    expect(item.ttl).toBe(nowSec + 600);
    expect(item.state).toBe('state-abc');
    expect(item.orgId).toBe('org-1');
    expect(item.userId).toBe('user-1');
    expect(item.platform).toBe('docusign');
  });

  it('includes codeVerifier when present', async () => {
    mockSend.mockResolvedValueOnce({});

    await storeOAuthState('state-def', {
      orgId: 'org-1',
      userId: 'user-1',
      platform: 'xero' as any,
      codeVerifier: 'verifier-123',
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Item.codeVerifier).toBe('verifier-123');
  });

  it('throws on DB error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    await expect(
      storeOAuthState('state-fail', {
        orgId: 'org-1',
        userId: 'user-1',
        platform: 'procore' as any,
      }),
    ).rejects.toThrow('Failed to initiate OAuth flow. Please try again.');
  });
});

describe('retrieveOAuthState', () => {
  it('returns data and deletes state', async () => {
    const nowSec = Math.floor(new Date('2025-06-15T12:00:00Z').getTime() / 1000);
    mockSend
      .mockResolvedValueOnce({
        Item: {
          state: 'state-abc',
          orgId: 'org-1',
          userId: 'user-1',
          platform: 'docusign',
          codeVerifier: 'cv-123',
          createdAt: nowSec - 60,
          ttl: nowSec + 540,
        },
      })
      .mockResolvedValueOnce({}); // delete

    const result = await retrieveOAuthState('state-abc');

    expect(result).not.toBeNull();
    expect(result!.orgId).toBe('org-1');
    expect(result!.userId).toBe('user-1');
    expect(result!.platform).toBe('docusign');
    expect(result!.codeVerifier).toBe('cv-123');
    // Verify delete was called
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns null when state not found', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await retrieveOAuthState('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when expired (ttl < now)', async () => {
    const nowSec = Math.floor(new Date('2025-06-15T12:00:00Z').getTime() / 1000);
    mockSend
      .mockResolvedValueOnce({
        Item: {
          state: 'state-expired',
          orgId: 'org-1',
          userId: 'user-1',
          platform: 'xero',
          createdAt: nowSec - 700,
          ttl: nowSec - 100, // expired
        },
      })
      .mockResolvedValueOnce({}); // delete still happens

    const result = await retrieveOAuthState('state-expired');
    expect(result).toBeNull();
  });

  it('returns null on DB error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await retrieveOAuthState('state-error');
    expect(result).toBeNull();
  });
});

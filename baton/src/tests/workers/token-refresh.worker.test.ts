import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTokenRefreshJob } from '../../workers/token-refresh.worker';

// The worker uses createLogger() to build a child logger with bound context
// (worker, connectionId, orgId, platform); log lines go through that child.
const { mockLog, mockCreateLogger } = vi.hoisted(() => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockLog, mockCreateLogger: vi.fn(() => mockLog) };
});

vi.mock('../../lib/logger', () => ({
  createLogger: mockCreateLogger,
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../../lib/types', () => ({}));

const mockGetConnection = vi.fn();
const mockGetRefreshToken = vi.fn();
const mockUpdateTokens = vi.fn();
const mockUpdateConnectionStatus = vi.fn();
vi.mock('../../services/connection.service', () => ({
  getConnection: (...args: any[]) => mockGetConnection(...args),
  getRefreshToken: (...args: any[]) => mockGetRefreshToken(...args),
  updateTokens: (...args: any[]) => mockUpdateTokens(...args),
  updateConnectionStatus: (...args: any[]) => mockUpdateConnectionStatus(...args),
}));

const mockRefreshToken = vi.fn();
const mockHasConnector = vi.fn();
vi.mock('../../services/connectors', () => ({
  getConnector: vi.fn(() => ({ refreshToken: mockRefreshToken })),
  hasConnector: (...args: any[]) => mockHasConnector(...args),
}));

const mockGetOrgAdmin = vi.fn();
vi.mock('../../services/user.service', () => ({
  getOrgAdmin: (...args: any[]) => mockGetOrgAdmin(...args),
}));

const mockSendNotification = vi.fn();
const mockConnectionDisconnectedNotification = vi.fn((...args: any[]) => ({ kind: 'disconnected', args }));
vi.mock('../../services/notification.service', () => ({
  sendNotification: (...args: any[]) => mockSendNotification(...args),
  connectionDisconnectedNotification: (...args: any[]) => mockConnectionDisconnectedNotification(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────

function makeJob() {
  return {
    connectionId: 'conn-1',
    orgId: 'org-1',
    platform: 'procore' as const,
  };
}

function makeConnection(overrides: Record<string, any> = {}) {
  return {
    id: 'conn-1',
    orgId: 'org-1',
    platform: 'procore',
    displayName: 'Procore Main',
    status: 'healthy',
    refreshTokenEnc: 'enc-refresh-blob',
    tokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min from now
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgAdmin.mockResolvedValue(null);
  mockSendNotification.mockResolvedValue(undefined);
});

describe('processTokenRefreshJob', () => {
  it('returns early when no connector exists for platform', async () => {
    mockHasConnector.mockReturnValue(false);

    await processTokenRefreshJob(makeJob());

    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockRefreshToken).not.toHaveBeenCalled();
  });

  it('logs error and returns when connection is not found', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(null);

    await processTokenRefreshJob(makeJob());

    // connectionId is bound onto the child logger at creation
    expect(mockCreateLogger).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-1' }),
    );
    expect(mockLog.error).toHaveBeenCalledWith('Connection not found for token refresh');
    expect(mockRefreshToken).not.toHaveBeenCalled();
  });

  it('skips refresh when token is still valid (far in future)', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 60 min from now
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: farFuture }));

    await processTokenRefreshJob(makeJob());

    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();

    expect(mockLog.debug).toHaveBeenCalledWith('Token still valid, skipping refresh');
  });

  it('refreshes token when it is expired', async () => {
    const expired = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: expired }));
    mockGetRefreshToken.mockResolvedValue('refresh-token-abc');
    mockRefreshToken.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt', expiresAt: '2099-01-01' });
    mockUpdateTokens.mockResolvedValue(undefined);

    await processTokenRefreshJob(makeJob());

    expect(mockGetRefreshToken).toHaveBeenCalledWith('conn-1');
    expect(mockRefreshToken).toHaveBeenCalledWith('refresh-token-abc');
    expect(mockUpdateTokens).toHaveBeenCalledWith('conn-1', {
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt: '2099-01-01',
    });
  });

  it('marks connection as warning and notifies admin (without throwing) when no refresh token is stored', async () => {
    const expired = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: expired, refreshTokenEnc: undefined }));
    mockUpdateConnectionStatus.mockResolvedValue(undefined);
    mockGetOrgAdmin.mockResolvedValue('admin-1');

    // Permanent failure: must NOT throw (retrying won't help)
    await expect(processTokenRefreshJob(makeJob())).resolves.toBeUndefined();

    expect(mockUpdateConnectionStatus).toHaveBeenCalledWith(
      'conn-1',
      'warning',
      'No refresh token available. Please reconnect.',
    );
    expect(mockGetOrgAdmin).toHaveBeenCalledWith('org-1');
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockRefreshToken).not.toHaveBeenCalled();
  });

  it('updates status to warning and re-throws on refresh failure', async () => {
    const expired = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const error = new Error('OAuth provider unreachable');
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: expired }));
    mockGetRefreshToken.mockResolvedValue('refresh-token-abc');
    mockRefreshToken.mockRejectedValue(error);
    mockUpdateConnectionStatus.mockResolvedValue(undefined);

    await expect(processTokenRefreshJob(makeJob())).rejects.toThrow('OAuth provider unreachable');

    expect(mockUpdateConnectionStatus).toHaveBeenCalledWith(
      'conn-1',
      'warning',
      'OAuth provider unreachable',
    );
  });

  it('proceeds with refresh when tokenExpiresAt is undefined', async () => {
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: undefined }));
    mockGetRefreshToken.mockResolvedValue('refresh-token-abc');
    mockRefreshToken.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });
    mockUpdateTokens.mockResolvedValue(undefined);

    await processTokenRefreshJob(makeJob());

    expect(mockRefreshToken).toHaveBeenCalledWith('refresh-token-abc');
    expect(mockUpdateTokens).toHaveBeenCalledTimes(1);
  });

  it('refreshes when token expires within the 10-minute buffer (9 min left)', async () => {
    const nineMinFromNow = new Date(Date.now() + 9 * 60 * 1000).toISOString();
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: nineMinFromNow }));
    mockGetRefreshToken.mockResolvedValue('refresh-token-abc');
    mockRefreshToken.mockResolvedValue({ accessToken: 'new-at' });
    mockUpdateTokens.mockResolvedValue(undefined);

    await processTokenRefreshJob(makeJob());

    expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockUpdateTokens).toHaveBeenCalledTimes(1);
  });

  it('does NOT refresh when token expires in 11 minutes (outside buffer)', async () => {
    const elevenMinFromNow = new Date(Date.now() + 11 * 60 * 1000).toISOString();
    mockHasConnector.mockReturnValue(true);
    mockGetConnection.mockResolvedValue(makeConnection({ tokenExpiresAt: elevenMinFromNow }));

    await processTokenRefreshJob(makeJob());

    expect(mockRefreshToken).not.toHaveBeenCalled();
    expect(mockUpdateTokens).not.toHaveBeenCalled();
  });
});

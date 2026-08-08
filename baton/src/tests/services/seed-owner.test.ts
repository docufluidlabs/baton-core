import { describe, it, expect, vi, beforeEach } from 'vitest';

const { needsSetupMock, performSetupMock, envState } = vi.hoisted(() => ({
  needsSetupMock: vi.fn(),
  performSetupMock: vi.fn(),
  envState: {
    BATON_OWNER_EMAIL: '',
    BATON_OWNER_PASSWORD: '',
    BATON_OWNER_NAME: 'Owner',
    BATON_ORG_NAME: 'Baton',
  },
}));

vi.mock('../../services/local-auth.service', () => ({
  needsSetup: (...args: unknown[]) => needsSetupMock(...args),
  performSetup: (...args: unknown[]) => performSetupMock(...args),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../env', () => ({ default: envState }));

import { seedOwnerFromEnv } from '../../services/seed-owner';

beforeEach(() => {
  needsSetupMock.mockReset();
  performSetupMock.mockReset();
  envState.BATON_OWNER_EMAIL = '';
  envState.BATON_OWNER_PASSWORD = '';
  envState.BATON_OWNER_NAME = 'Owner';
  envState.BATON_ORG_NAME = 'Baton';
});

describe('seedOwnerFromEnv', () => {
  it('does nothing when the env vars are not set', async () => {
    await seedOwnerFromEnv();
    expect(needsSetupMock).not.toHaveBeenCalled();
    expect(performSetupMock).not.toHaveBeenCalled();
  });

  it('seeds org and owner when configured and no users exist', async () => {
    envState.BATON_OWNER_EMAIL = 'owner@example.com';
    envState.BATON_OWNER_PASSWORD = 'super-secret-pw';
    envState.BATON_ORG_NAME = 'Acme';
    envState.BATON_OWNER_NAME = 'Ada';
    needsSetupMock.mockResolvedValue(true);
    performSetupMock.mockResolvedValue({
      user: { email: 'owner@example.com' },
      org: { id: 'org-1', name: 'Acme' },
    });

    await seedOwnerFromEnv();

    expect(performSetupMock).toHaveBeenCalledWith({
      orgName: 'Acme',
      name: 'Ada',
      email: 'owner@example.com',
      password: 'super-secret-pw',
    });
  });

  it('skips when users already exist', async () => {
    envState.BATON_OWNER_EMAIL = 'owner@example.com';
    envState.BATON_OWNER_PASSWORD = 'super-secret-pw';
    needsSetupMock.mockResolvedValue(false);

    await seedOwnerFromEnv();

    expect(performSetupMock).not.toHaveBeenCalled();
  });

  it('refuses a short password without touching the database', async () => {
    envState.BATON_OWNER_EMAIL = 'owner@example.com';
    envState.BATON_OWNER_PASSWORD = 'short';

    await seedOwnerFromEnv();

    expect(needsSetupMock).not.toHaveBeenCalled();
    expect(performSetupMock).not.toHaveBeenCalled();
  });
});

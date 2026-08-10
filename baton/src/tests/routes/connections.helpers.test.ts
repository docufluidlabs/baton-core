import { describe, it, expect } from 'vitest';

// Need to mock dependencies that connections.ts imports
vi.mock('../../middleware/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('../../middleware/rbac', () => ({ requireAdmin: vi.fn(), requireViewer: vi.fn() }));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));
vi.mock('../../lib/types', () => ({}));
vi.mock('../../middleware/error-handler', () => ({ NotFoundError: class extends Error {}, ValidationError: class extends Error {} }));
vi.mock('../../services/connection.service', () => ({}));
vi.mock('../../services/connectors', () => ({ getConnector: vi.fn(), hasConnector: vi.fn(), getRegisteredPlatforms: vi.fn() }));
vi.mock('../../services/oauth-state.service', () => ({ storeOAuthState: vi.fn(), retrieveOAuthState: vi.fn() }));
vi.mock('../../services/audit.service', () => ({ logAudit: vi.fn() }));

import { _testExports } from '../../routes/connections';

const { stripSensitiveFields, extractAccountId, extractDisplayName } = _testExports;

// ─── stripSensitiveFields ─────────────────────────────────────

describe('stripSensitiveFields', () => {
  it('removes accessTokenEnc, refreshTokenEnc, webhookSecret from object', () => {
    const connection = {
      id: 'conn-1',
      orgId: 'org-1',
      platform: 'docusign',
      status: 'healthy',
      accessTokenEnc: 'encrypted-access',
      refreshTokenEnc: 'encrypted-refresh',
      webhookSecret: 'wh-secret-123',
    };
    const result = stripSensitiveFields(connection);
    expect(result).not.toHaveProperty('accessTokenEnc');
    expect(result).not.toHaveProperty('refreshTokenEnc');
    expect(result).not.toHaveProperty('webhookSecret');
  });

  it('adds hasAccessToken: true when accessTokenEnc exists', () => {
    const connection = { id: 'conn-1', accessTokenEnc: 'some-encrypted-token' };
    const result = stripSensitiveFields(connection);
    expect(result.hasAccessToken).toBe(true);
  });

  it('adds hasRefreshToken: false when refreshTokenEnc is missing/undefined', () => {
    const connection = { id: 'conn-1', accessTokenEnc: 'token' };
    const result = stripSensitiveFields(connection);
    expect(result.hasRefreshToken).toBe(false);
  });

  it('preserves all other fields (id, orgId, platform, status)', () => {
    const connection = {
      id: 'conn-1',
      orgId: 'org-1',
      platform: 'salesforce',
      status: 'healthy',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      webhookSecret: 'secret',
    };
    const result = stripSensitiveFields(connection);
    expect(result.id).toBe('conn-1');
    expect(result.orgId).toBe('org-1');
    expect(result.platform).toBe('salesforce');
    expect(result.status).toBe('healthy');
  });

  it('returns hasAccessToken: false and hasRefreshToken: false for empty object', () => {
    const result = stripSensitiveFields({});
    expect(result.hasAccessToken).toBe(false);
    expect(result.hasRefreshToken).toBe(false);
  });
});

// ─── extractAccountId ─────────────────────────────────────────

describe('extractAccountId', () => {
  it('docusign: returns tokens.raw.userInfo.accounts[0].account_id', () => {
    const tokens = { raw: { userInfo: { accounts: [{ account_id: 'ds-acct-123' }] } } };
    expect(extractAccountId('docusign', tokens)).toBe('ds-acct-123');
  });

  it('bamboohr: returns undefined', () => {
    const tokens = { raw: {} };
    expect(extractAccountId('bamboohr', tokens)).toBeUndefined();
  });

  it('zendesk: returns undefined (default branch)', () => {
    const tokens = { raw: {} };
    expect(extractAccountId('zendesk', tokens)).toBeUndefined();
  });

  it('zohocrm: returns undefined', () => {
    const tokens = { raw: {} };
    expect(extractAccountId('zohocrm', tokens)).toBeUndefined();
  });

  it('docusign with missing raw returns undefined', () => {
    const tokens = {};
    expect(extractAccountId('docusign', tokens)).toBeUndefined();
  });
});

// ─── extractDisplayName ───────────────────────────────────────

describe('extractDisplayName', () => {
  // Docusign connections are deliberately branded as 'Docusign' regardless of
  // the OAuth userInfo — stripSensitiveFields also normalizes legacy
  // 'Docusign' display names to 'Docusign', confirming the intent.
  it('docusign ignores tokens.raw.userInfo.name and returns the "Docusign" brand name', () => {
    const tokens = { raw: { userInfo: { name: 'Jane Doe' } } };
    expect(extractDisplayName('docusign', tokens)).toBe('Docusign');
  });

  it('docusign without userInfo name still returns "Docusign"', () => {
    const tokens = { raw: { userInfo: {} } };
    expect(extractDisplayName('docusign', tokens)).toBe('Docusign');
  });

  it('unknown platform returns "${platform} Connection"', () => {
    expect(extractDisplayName('bamboohr', {})).toBe('bamboohr Connection');
    expect(extractDisplayName('zendesk', {})).toBe('zendesk Connection');
  });
});

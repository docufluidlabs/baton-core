import { describe, it, expect, vi } from 'vitest';
import { _testExports } from '../../workers/workflow-launcher.worker';

vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(),
  TableNames: {},
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../services/maestro.service', () => ({}));
vi.mock('../../services/connection.service', () => ({}));
vi.mock('../../services/notification.service', () => ({
  sendNotification: vi.fn(),
  workflowFailedNotification: vi.fn(),
  rulePausedNotification: vi.fn(),
}));

const { categorizeError, categorizeUserMessage, isUserActionable } = _testExports;

// ─── categorizeError ────────────────────────────────────────

describe('categorizeError', () => {
  it('401 → auth', () => {
    expect(categorizeError('401 Unauthorized')).toBe('auth');
  });

  it('token expired → auth', () => {
    expect(categorizeError('token expired')).toBe('auth');
  });

  it('unauthorized → auth', () => {
    expect(categorizeError('unauthorized access')).toBe('auth');
  });

  it('400 → validation', () => {
    expect(categorizeError('400 Bad Request')).toBe('validation');
  });

  it('validation failed → validation', () => {
    expect(categorizeError('validation failed')).toBe('validation');
  });

  it('invalid input → validation', () => {
    expect(categorizeError('invalid input provided')).toBe('validation');
  });

  it('429 → rate_limit', () => {
    expect(categorizeError('429 Too Many Requests')).toBe('rate_limit');
  });

  it('rate limit → rate_limit', () => {
    expect(categorizeError('rate limit exceeded')).toBe('rate_limit');
  });

  it('502 → upstream', () => {
    expect(categorizeError('502 Bad Gateway')).toBe('upstream');
  });

  it('503 → upstream', () => {
    expect(categorizeError('503 Service Unavailable')).toBe('upstream');
  });

  it('timeout → upstream', () => {
    expect(categorizeError('Request timeout')).toBe('upstream');
  });

  it('random error → internal', () => {
    expect(categorizeError('something went wrong')).toBe('internal');
  });

  it('empty string → internal', () => {
    expect(categorizeError('')).toBe('internal');
  });
});

// ─── categorizeUserMessage ──────────────────────────────────

describe('categorizeUserMessage', () => {
  it('auth error mentions reconnect', () => {
    const msg = categorizeUserMessage('401 Unauthorized');
    expect(msg).toContain('reconnect');
  });

  it('validation error mentions field mapping', () => {
    const msg = categorizeUserMessage('validation failed');
    expect(msg).toContain('field mapping');
  });

  it('rate_limit error mentions retry', () => {
    const msg = categorizeUserMessage('429 rate limit');
    expect(msg).toContain('retry');
  });

  it('upstream error mentions unavailable', () => {
    const msg = categorizeUserMessage('503 error');
    expect(msg).toContain('unavailable');
  });

  it('internal error mentions unexpected', () => {
    const msg = categorizeUserMessage('random crash');
    expect(msg).toContain('unexpected');
  });
});

// ─── isUserActionable ───────────────────────────────────────

describe('isUserActionable', () => {
  it('auth error is actionable', () => {
    expect(isUserActionable('401 unauthorized')).toBe(true);
  });

  it('validation error is actionable', () => {
    expect(isUserActionable('invalid input')).toBe(true);
  });

  it('rate_limit is not actionable', () => {
    expect(isUserActionable('429 rate limit')).toBe(false);
  });

  it('upstream is not actionable', () => {
    expect(isUserActionable('502 bad gateway')).toBe(false);
  });

  it('internal is not actionable', () => {
    expect(isUserActionable('unknown error')).toBe(false);
  });
});

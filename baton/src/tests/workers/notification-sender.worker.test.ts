import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processNotificationJob } from '../../workers/notification-sender.worker';

vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));

const mockSendNotification = vi.fn();
vi.mock('../../services/notification.service', () => ({
  sendNotification: (...args: any[]) => mockSendNotification(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────

function makePayload() {
  return {
    orgId: 'org-1',
    recipientId: 'user-1',
    title: 'Workflow failed',
    body: 'Instance inst-42 failed with error: timeout',
    severity: 'error' as const,
    category: 'workflow_failed',
    metadata: { instanceId: 'inst-42' },
  };
}

function makeJob() {
  return {
    type: 'notification' as const,
    payload: makePayload(),
  };
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processNotificationJob', () => {
  it('calls sendNotification with payload and logs delivery on success', async () => {
    mockSendNotification.mockResolvedValue(undefined);

    await processNotificationJob(makeJob());

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith(makePayload());

    const { logInfo } = await import('../../lib/logger');
    expect(logInfo).toHaveBeenCalledWith(
      'Notification delivered',
      expect.objectContaining({
        recipientId: 'user-1',
        category: 'workflow_failed',
      }),
    );
  });

  it('does NOT re-throw when sendNotification fails', async () => {
    mockSendNotification.mockRejectedValue(new Error('Resend API down'));

    // Should NOT throw — notification failures are swallowed
    await expect(processNotificationJob(makeJob())).resolves.toBeUndefined();
  });

  it('forwards the exact payload to sendNotification', async () => {
    const customPayload = {
      orgId: 'org-99',
      recipientId: 'user-77',
      title: 'Connection degraded',
      body: 'Procore token refresh failed',
      severity: 'warning' as const,
      category: 'connection_error',
    };

    mockSendNotification.mockResolvedValue(undefined);

    await processNotificationJob({
      type: 'notification',
      payload: customPayload,
    });

    expect(mockSendNotification).toHaveBeenCalledWith(customPayload);
  });

  it('logs failure with recipientId and category when sendNotification throws', async () => {
    mockSendNotification.mockRejectedValue(new Error('Delivery timeout'));

    await processNotificationJob(makeJob());

    const { logError } = await import('../../lib/logger');
    expect(logError).toHaveBeenCalledWith(
      'Notification delivery failed (will not retry)',
      expect.any(Error),
      expect.objectContaining({
        recipientId: 'user-1',
        category: 'workflow_failed',
      }),
    );
  });

  it('logs success with recipientId and category after delivery', async () => {
    const payload = {
      orgId: 'org-5',
      recipientId: 'user-50',
      title: 'Rule paused',
      body: 'Auto-Assign rule was paused',
      severity: 'warning' as const,
      category: 'rule_paused',
    };

    mockSendNotification.mockResolvedValue(undefined);

    await processNotificationJob({ type: 'notification', payload });

    const { logInfo } = await import('../../lib/logger');
    expect(logInfo).toHaveBeenCalledWith(
      'Notification delivered',
      expect.objectContaining({
        recipientId: 'user-50',
        category: 'rule_paused',
      }),
    );
  });
});

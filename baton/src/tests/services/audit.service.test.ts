import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { AUDIT_LOG: 'baton-audit-log' },
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'audit-uuid-123') }));
vi.mock('../../lib/logger', () => ({ logError: vi.fn() }));
vi.mock('../../lib/types', () => ({}));

import { logAudit } from '../../services/audit.service';
import { logError as mockLogError } from '../../lib/logger';

beforeEach(() => {
  mockSend.mockReset();
  vi.mocked(mockLogError).mockReset();
});

describe('logAudit', () => {
  it('creates record with PutCommand including id, orgId, action, entityType, entityId, createdAt', async () => {
    mockSend.mockResolvedValueOnce({});

    await logAudit({
      orgId: 'org-1',
      userId: 'user-1',
      action: 'connection.created',
      resourceType: 'connection',
      resourceId: 'conn-1',
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0];
    const item = call.input.Item;
    expect(item.id).toBe('audit-uuid-123');
    expect(item.orgId).toBe('org-1');
    expect(item.action).toBe('connection.created');
    expect(item.entityType).toBe('connection');
    expect(item.entityId).toBe('conn-1');
    expect(item.createdAt).toBeDefined();
  });

  it('includes optional metadata', async () => {
    mockSend.mockResolvedValueOnce({});

    await logAudit({
      orgId: 'org-1',
      action: 'rule.updated',
      resourceType: 'rule',
      resourceId: 'rule-1',
      metadata: { platform: 'docusign', field: 'conditions' },
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Item.metadata).toEqual({ platform: 'docusign', field: 'conditions' });
  });

  it('DB error is logged but not thrown (fire-and-forget)', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    // Should not throw
    await expect(
      logAudit({
        orgId: 'org-1',
        action: 'workflow.launched',
        resourceType: 'workflow',
        resourceId: 'wf-1',
      }),
    ).resolves.toBeUndefined();

    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to write audit log',
      expect.any(Error),
      expect.objectContaining({ action: 'workflow.launched', resourceId: 'wf-1' }),
    );
  });

  it('includes userId when provided', async () => {
    mockSend.mockResolvedValueOnce({});

    await logAudit({
      orgId: 'org-1',
      userId: 'user-42',
      action: 'connection.deleted',
      resourceType: 'connection',
      resourceId: 'conn-2',
    });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Item.userId).toBe('user-42');
  });
});

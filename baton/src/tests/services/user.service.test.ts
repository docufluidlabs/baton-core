import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { USERS: 'users' },
}));

const mockLogError = vi.fn();
vi.mock('../../lib/logger', () => ({
  logError: (...args: any[]) => mockLogError(...args),
}));

// ─── Imports (after mocks) ───────────────────────────────────

import { getOrgAdmin, getOrgAdmins } from '../../services/user.service';

beforeEach(() => {
  mockSend.mockReset();
  mockLogError.mockReset();
});

// ─── getOrgAdmin ─────────────────────────────────────────────

describe('getOrgAdmin', () => {
  it('returns the first admin/owner id for an org', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ id: 'user-1', role: 'owner' }] });
    const id = await getOrgAdmin('org-1');
    expect(id).toBe('user-1');
  });

  it('queries USERS via orgId-index, filtering by admin/owner role with Limit:1', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ id: 'user-1' }] });
    await getOrgAdmin('org-1');
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('users');
    expect(cmd.input.IndexName).toBe('orgId-index');
    expect(cmd.input.KeyConditionExpression).toBe('orgId = :orgId');
    expect(cmd.input.FilterExpression).toBe('#r IN (:admin, :owner)');
    expect(cmd.input.ExpressionAttributeValues).toMatchObject({
      ':orgId': 'org-1',
      ':admin': 'admin',
      ':owner': 'owner',
    });
    expect(cmd.input.ExpressionAttributeNames).toEqual({ '#r': 'role' });
    expect(cmd.input.Limit).toBe(1);
  });

  it('returns null when no admins or owners exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    expect(await getOrgAdmin('org-empty')).toBeNull();
  });

  it('returns null and logs on DynamoDB error', async () => {
    const err = new Error('boom');
    mockSend.mockRejectedValueOnce(err);
    expect(await getOrgAdmin('org-err')).toBeNull();
    expect(mockLogError).toHaveBeenCalledWith('getOrgAdmin failed', err, { orgId: 'org-err' });
  });
});

// ─── getOrgAdmins ────────────────────────────────────────────

describe('getOrgAdmins', () => {
  it('returns all admin/owner ids for an org', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { id: 'user-1', role: 'owner' },
        { id: 'user-2', role: 'admin' },
        { id: 'user-3', role: 'admin' },
      ],
    });
    const ids = await getOrgAdmins('org-1');
    expect(ids).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('queries USERS via orgId-index without a Limit (returns all matches)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    await getOrgAdmins('org-1');
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.TableName).toBe('users');
    expect(cmd.input.IndexName).toBe('orgId-index');
    expect(cmd.input.KeyConditionExpression).toBe('orgId = :orgId');
    expect(cmd.input.FilterExpression).toBe('#r IN (:admin, :owner)');
    expect(cmd.input.ExpressionAttributeValues).toMatchObject({
      ':orgId': 'org-1',
      ':admin': 'admin',
      ':owner': 'owner',
    });
    expect(cmd.input.ExpressionAttributeNames).toEqual({ '#r': 'role' });
    expect(cmd.input.Limit).toBeUndefined();
  });

  it('returns an empty array when no admins or owners exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    expect(await getOrgAdmins('org-empty')).toEqual([]);
  });

  it('returns an empty array when Items is undefined', async () => {
    mockSend.mockResolvedValueOnce({});
    expect(await getOrgAdmins('org-undef')).toEqual([]);
  });

  it('filters out entries without an id', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { id: 'user-1', role: 'owner' },
        { role: 'admin' },
        { id: '', role: 'admin' },
        { id: 'user-2', role: 'admin' },
      ],
    });
    expect(await getOrgAdmins('org-1')).toEqual(['user-1', 'user-2']);
  });

  it('returns an empty array and logs on DynamoDB error', async () => {
    const err = new Error('dynamo down');
    mockSend.mockRejectedValueOnce(err);
    expect(await getOrgAdmins('org-err')).toEqual([]);
    expect(mockLogError).toHaveBeenCalledWith('getOrgAdmins failed', err, { orgId: 'org-err' });
  });
});

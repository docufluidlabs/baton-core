/**
 * User Service — Baton
 *
 * Shared user-related helpers used across workers and routes.
 * Centralises logic that was previously duplicated in 3+ files (#24).
 */
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logError } from '../lib/logger';

/**
 * Return the first admin or owner userId for an org.
 *
 * #24: Previously duplicated across workers and routes — each querying only
 * for 'admin' and missing the 'owner' role. This shared version includes both.
 */
export async function getOrgAdmin(orgId: string): Promise<string | null> {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.USERS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      // Include both 'admin' and 'owner' roles (#24)
      FilterExpression: '#r IN (:admin, :owner)',
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':admin': 'admin',
        ':owner': 'owner',
      },
      ExpressionAttributeNames: { '#r': 'role' },
      Limit: 1,
    }));
    return result.Items?.[0]?.id || null;
  } catch (err) {
    logError('getOrgAdmin failed', err, { orgId });
    return null;
  }
}

/**
 * Return all admin/owner userIds for an org. Used to fan out org-wide
 * notifications (e.g. automation-triggered workflow failures) so every
 * admin sees the alert in-app, not just the first one returned.
 */
export async function getOrgAdmins(orgId: string): Promise<string[]> {
  try {
    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.USERS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: '#r IN (:admin, :owner)',
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':admin': 'admin',
        ':owner': 'owner',
      },
      ExpressionAttributeNames: { '#r': 'role' },
    }));
    return (result.Items || []).map((u: any) => u.id).filter(Boolean);
  } catch (err) {
    logError('getOrgAdmins failed', err, { orgId });
    return [];
  }
}

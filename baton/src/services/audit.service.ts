/**
 * Audit Service — Baton
 *
 * Fire-and-forget audit logging to DynamoDB.
 * Every mutating action (create, update, delete, pause, resume, sync, launch, etc.)
 * should call logAudit() after the operation succeeds.
 *
 * Read path lives in routes/settings.ts (GET /api/settings/audit).
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { AuditLogEntry } from '../lib/types';
import { logError } from '../lib/logger';

export async function logAudit(params: {
  orgId: string;
  userId?: string;
  action: string;        // e.g., 'connection.created', 'rule.updated', 'workflow.launched'
  resourceType: string;  // e.g., 'connection', 'rule', 'workflow'
  resourceId: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const entry: AuditLogEntry = {
    id: uuidv4(),
    orgId: params.orgId,
    userId: params.userId,
    action: params.action,
    entityType: params.resourceType,
    entityId: params.resourceId,
    metadata: params.metadata,
    createdAt: new Date().toISOString(),
  };

  try {
    const doc = getDocClient();
    await doc.send(new PutCommand({
      TableName: TableNames.AUDIT_LOG,
      Item: entry,
    }));
  } catch (error: any) {
    // Fire-and-forget: log but don't propagate
    logError('Failed to write audit log', error, { action: params.action, resourceId: params.resourceId });
  }
}

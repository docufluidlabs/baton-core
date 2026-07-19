/**
 * Notifications Routes — Baton
 * In-app notifications + preferences
 */
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { NotFoundError } from '../middleware/error-handler';
import { logInfo } from '../lib/logger';

const router = Router();
router.use(requireAuth);

// ─── GET /api/notifications — List user notifications ────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const unreadOnly = req.query.unread === 'true';

    const docClient = getDocClient();

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.NOTIFICATIONS,
      IndexName: 'recipientId-createdAt-index',
      KeyConditionExpression: 'recipientId = :userId',
      ...(unreadOnly ? {
        FilterExpression: 'attribute_not_exists(readAt)',
      } : {}),
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: limit,
    }));

    const notifications = result.Items || [];
    const unreadCount = notifications.filter((n: any) => !n.readAt).length;

    res.json({ notifications, unreadCount });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/notifications/:id/read — Mark as read ────────

router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    await docClient.send(new UpdateCommand({
      TableName: TableNames.NOTIFICATIONS,
      Key: { id: req.params.id },
      UpdateExpression: 'SET readAt = :now',
      ConditionExpression: 'recipientId = :userId',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':userId': req.auth!.userId,
      },
    }));
    logInfo('Notification marked as read', { notificationId: req.params.id, userId: req.auth!.userId });
    res.json({ message: 'Marked as read', id: req.params.id });
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return next(new NotFoundError('Notification'));
    }
    next(error);
  }
});

// ─── POST /api/notifications/read-all — Mark all as read ─────

router.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const docClient = getDocClient();
    const now = new Date().toISOString();

    // Get unread notifications
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.NOTIFICATIONS,
      IndexName: 'recipientId-createdAt-index',
      KeyConditionExpression: 'recipientId = :userId',
      FilterExpression: 'attribute_not_exists(readAt)',
      ExpressionAttributeValues: { ':userId': userId },
    }));

    const unread = result.Items || [];

    // Update each (DynamoDB doesn't support batch update)
    await Promise.allSettled(
      unread.map((n: any) =>
        docClient.send(new UpdateCommand({
          TableName: TableNames.NOTIFICATIONS,
          Key: { id: n.id },
          UpdateExpression: 'SET readAt = :now',
          ExpressionAttributeValues: { ':now': now },
        }))
      )
    );

    logInfo('All notifications marked as read', { userId, count: unread.length });
    res.json({ message: 'All marked as read', count: unread.length });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/notifications/:id/dismiss — Dismiss ──────────

router.patch('/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    await docClient.send(new UpdateCommand({
      TableName: TableNames.NOTIFICATIONS,
      Key: { id: req.params.id },
      UpdateExpression: 'SET dismissedAt = :now, readAt = if_not_exists(readAt, :now)',
      ConditionExpression: 'recipientId = :userId',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':userId': req.auth!.userId,
      },
    }));
    res.json({ message: 'Dismissed', id: req.params.id });
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return next(new NotFoundError('Notification'));
    }
    next(error);
  }
});

// ─── GET /api/notifications/preferences — Get preferences ────

router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const orgId = req.auth!.orgId;

    // MVP: preferences are per-org, not per-user
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.NOTIFICATION_PREFERENCES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      Limit: 1,
    }));

    const DEFAULT_EVENTS: Record<string, any> = {
      workflow_failed:           { inApp: true,  email: true  },
      workflow_completed:        { inApp: true,  email: false },
      workflow_launched:         { inApp: true,  email: false },
      automation_failed:         { inApp: true,  email: true  },
      connection_degraded:       { inApp: true,  email: true  },
      execution_quota_warning:   { inApp: true,  email: true  },
      execution_quota_exceeded:  { inApp: true,  email: true  },
      webhook_failed:            { inApp: true,  email: true  },
    };

    const prefs = result.Items?.[0] || { events: DEFAULT_EVENTS };
    prefs.events = { ...DEFAULT_EVENTS, ...prefs.events };

    res.json({ preferences: prefs });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /api/notifications/preferences — Update preferences ─

router.put('/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const docClient = getDocClient();
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { v4: uuidv4 } = await import('uuid');
    const orgId = req.auth!.orgId;

    // MVP: preferences are per-org, not per-user
    const existing = await docClient.send(new QueryCommand({
      TableName: TableNames.NOTIFICATION_PREFERENCES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      Limit: 1,
    }));

    const id = existing.Items?.[0]?.id || uuidv4();

    await docClient.send(new PutCommand({
      TableName: TableNames.NOTIFICATION_PREFERENCES,
      Item: {
        id,
        orgId,
        updatedBy: req.auth!.userId,
        ...req.body,
        updatedAt: new Date().toISOString(),
      },
    }));

    logInfo('Notification preferences updated', { orgId, updatedBy: req.auth!.userId });
    res.json({ message: 'Preferences updated' });
  } catch (error) {
    next(error);
  }
});

export default router;

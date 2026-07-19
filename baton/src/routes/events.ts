/**
 * Events Routes — Baton
 * Trigger Pipeline — the event stream / activity log
 * 
 * Shows all events: inbound webhooks, rule matches, workflow launches, envelope updates
 */
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireViewer } from '../middleware/rbac';
import { TriggerPipelineEntry } from '../lib/types';

const router = Router();
router.use(requireAuth, requireViewer);

// ─── GET /api/events — List events for org (paginated) ──────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const includeUnmatched = req.query.include_unmatched === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const category = req.query.category as string; // inbound | rule_match | workflow | envelope
    const status = req.query.status as string;     // pending | running | completed | failed
    const platform = req.query.platform as string; // docusign | salesforce | hubspot | ...
    const cursor = req.query.cursor as string;     // base64-encoded LastEvaluatedKey

    const docClient = getDocClient();

    const buildQuery = (queryOrgId: string) => {
      const exprValues: Record<string, any> = { ':orgId': queryOrgId };
      const exprNames: Record<string, string> = {};
      const filters: string[] = [];

      if (category) {
        filters.push('eventType = :category');
        exprValues[':category'] = category;
      }

      if (status) {
        filters.push('#st = :status');
        exprValues[':status'] = status;
        exprNames['#st'] = 'status';
      }

      if (platform) {
        filters.push('sourcePlatform = :platform');
        exprValues[':platform'] = platform;
      }

      const filterExpression = filters.length > 0 ? filters.join(' AND ') : '';

      let exclusiveStartKey: Record<string, any> | undefined;
      if (cursor) {
        try {
          exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        } catch {
          // ignore invalid cursor
        }
      }

      return new QueryCommand({
        TableName: TableNames.TRIGGER_PIPELINE,
        IndexName: 'orgId-triggeredAt-index',
        KeyConditionExpression: 'orgId = :orgId',
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ExpressionAttributeValues: exprValues,
        ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
        ScanIndexForward: false, // Newest first
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      });
    };

    // Query org events + optionally unmatched events
    const queries = [docClient.send(buildQuery(orgId))];
    if (includeUnmatched) {
      queries.push(docClient.send(buildQuery('_unmatched')));
    }

    const results = await Promise.all(queries);

    // Merge and sort by triggeredAt descending
    let events = results.flatMap((r) => (r.Items as TriggerPipelineEntry[]) || []);
    if (includeUnmatched) {
      events.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
      events = events.slice(0, limit);
    }

    const nextCursor = results[0].LastEvaluatedKey
      ? Buffer.from(JSON.stringify(results[0].LastEvaluatedKey)).toString('base64url')
      : null;

    res.json({
      events,
      count: events.length,
      hasMore: !!results[0].LastEvaluatedKey,
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/events/user/:userId — Events attributed to user ─

router.get('/user/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const attributedTo = req.params.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const cursor = req.query.cursor as string;

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      } catch {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
    }

    const docClient = getDocClient();
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'attributedTo-triggeredAt-index',
      KeyConditionExpression: 'attributedTo = :user',
      FilterExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':user': attributedTo, ':orgId': orgId },
      ScanIndexForward: false,
      Limit: limit,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));

    const events = result.Items || [];
    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
      : null;

    res.json({ events, count: events.length, hasMore: !!result.LastEvaluatedKey, nextCursor });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/events/stats — Event statistics for dashboard ──

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // Get recent events (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'orgId-triggeredAt-index',
      KeyConditionExpression: 'orgId = :orgId AND triggeredAt >= :since',
      ExpressionAttributeValues: { ':orgId': orgId, ':since': since },
    }));

    const events = (result.Items as TriggerPipelineEntry[]) || [];

    const stats = {
      total24h: events.length,
      byCategory: {
        inbound: events.filter((e) => e.eventType === 'inbound').length,
        rule_match: events.filter((e) => e.eventType === 'rule_match').length,
        workflow: events.filter((e) => e.eventType === 'workflow').length,
        envelope: events.filter((e) => e.eventType === 'envelope').length,
      },
      byStatus: {
        completed: events.filter((e) => e.status === 'completed').length,
        failed: events.filter((e) => e.status === 'failed').length,
        pending: events.filter((e) => e.status === 'pending').length,
        running: events.filter((e) => e.status === 'running').length,
      },
      failureRate: events.length > 0
        ? Math.round((events.filter((e) => e.status === 'failed').length / events.length) * 100)
        : 0,
    };

    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

export default router;

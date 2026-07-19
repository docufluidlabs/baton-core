/**
 * User Activity Routes — Baton
 * /api/my/* — Personal activity endpoints
 */
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../middleware/auth';
import { getDocClient, TableNames } from '../db/client';

const router = Router();
router.use(requireAuth);

// ─── GET /api/my/instances — Instances launched by current user ─

router.get('/instances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string;
    const doc = getDocClient();

    const exprValues: Record<string, any> = { ':userId': userId };
    let filterExpr: string | undefined;

    if (status) {
      filterExpr = '#status = :status';
      exprValues[':status'] = status;
    }

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      IndexName: 'launchedBy-startedAt-index', // #06: was 'launchedBy-createdAt-index' (wrong GSI)
      KeyConditionExpression: 'launchedBy = :userId',
      ExpressionAttributeValues: exprValues,
      ...(filterExpr && {
        FilterExpression: filterExpr,
        ExpressionAttributeNames: { '#status': 'status' },
      }),
      ScanIndexForward: false,
      Limit: limit,
    }));

    res.json({ instances: result.Items || [], count: result.Count || 0 });
  } catch (e) { next(e); }
});

// ─── GET /api/my/events — Events attributed to current user ──

router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'attributedTo-triggeredAt-index',
      KeyConditionExpression: 'attributedTo = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: limit,
    }));

    res.json({ events: result.Items || [], count: result.Count || 0 });
  } catch (e) { next(e); }
});

// ─── GET /api/my/stats — Personal stats ──────────────────────

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth!.userId;
    const doc = getDocClient();

    // Get last 30 days of instances
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.WORKFLOW_INSTANCES,
      // #06: GSI sort key is 'startedAt', not 'createdAt'
      IndexName: 'launchedBy-startedAt-index',
      KeyConditionExpression: 'launchedBy = :userId AND startedAt >= :since',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':since': thirtyDaysAgo,
      },
    }));

    const instances = result.Items || [];
    const total = instances.length;
    const successful = instances.filter((i: any) => i.status === 'completed').length;
    const failed = instances.filter((i: any) => i.status === 'failed').length;
    const running = instances.filter((i: any) => i.status === 'running').length;

    // This month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = instances.filter((i: any) => new Date(i.startedAt) >= monthStart).length;

    res.json({
      totalLaunches: total,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 100,
      thisMonth,
      running,
      failed,
      userId,
    });
  } catch (e) { next(e); }
});

export default router;

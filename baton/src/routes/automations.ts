/**
 * Automations Routes — Baton
 * /api/automations — Pipeline metrics, delivery health, automation insights
 */
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireViewer } from '../middleware/rbac';

const router = Router();
router.use(requireAuth, requireViewer);

// ─── GET /api/automations/metrics — Pipeline performance ─────

router.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.TRIGGER_PIPELINE,
      IndexName: 'orgId-triggeredAt-index',
      KeyConditionExpression: 'orgId = :orgId AND triggeredAt >= :since',
      ExpressionAttributeValues: { ':orgId': orgId, ':since': since },
    }));

    const events = result.Items || [];
    const completed = events.filter((e: any) => e.status === 'completed');
    const durations = completed
      .map((e: any) => e.durationMs)
      .filter(Boolean) as number[];

    const avgLatency = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const p95Latency = durations.length > 0
      ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] || 0
      : 0;

    // Automation match rate: events that triggered at least one automation
    const matched = events.filter((e: any) => e.matchedRuleId || e.workflowInstanceId);

    res.json({
      events24h: events.length,
      completed: completed.length,
      failed: events.filter((e: any) => e.status === 'failed').length,
      pending: events.filter((e: any) => e.status === 'pending').length,
      automationMatchRate: events.length > 0 ? Math.round((matched.length / events.length) * 100) : 0,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
    });
  } catch (e) { next(e); }
});

// ─── GET /api/automations/delivery-health — Per-platform health ─

router.get('/delivery-health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    // Fetch connections
    const connectionsResult = await doc.send(new QueryCommand({
      TableName: TableNames.PLATFORM_CONNECTIONS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    // Fetch recent automations with stats
    const rulesResult = await doc.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const connections = connectionsResult.Items || [];
    const rules = rulesResult.Items || [];

    // Group automations by source platform
    const platforms = connections.map((conn: any) => {
      const platformRules = rules.filter((r: any) => r.sourcePlatform === conn.platform);
      const activeRules = platformRules.filter((r: any) => r.status === 'active');
      const totalTriggers = platformRules.reduce((s: number, r: any) => s + (r.triggerCount || 0), 0);
      const totalFailures = platformRules.reduce((s: number, r: any) => s + (r.failureCount || 0), 0);

      return {
        platform: conn.platform,
        displayName: conn.displayName,
        connectionStatus: conn.status,
        automationsTotal: platformRules.length,
        automationsActive: activeRules.length,
        automationsError: platformRules.filter((r: any) => r.status === 'error').length,
        totalTriggers,
        successRate: totalTriggers > 0
          ? Math.round(((totalTriggers - totalFailures) / totalTriggers) * 100)
          : 100,
        lastWebhookAt: conn.lastWebhookAt,
      };
    });

    res.json({ platforms });
  } catch (e) { next(e); }
});

// ─── GET /api/automations/rule-insights — Top/problematic automations ─

router.get('/rule-insights', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const rules = (result.Items || []).filter((r: any) => r.status !== 'disabled');

    // Top by trigger count
    const topAutomations = [...rules]
      .sort((a: any, b: any) => (b.triggerCount || 0) - (a.triggerCount || 0))
      .slice(0, 5)
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        platform: r.sourcePlatform,
        triggerCount: r.triggerCount || 0,
        successRate: r.successRate ?? 100,
        status: r.status,
      }));

    // Problem automations (error status or low success rate)
    const problemAutomations = rules
      .filter((r: any) => r.status === 'error' || (r.successRate !== undefined && r.successRate < 70))
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        platform: r.sourcePlatform,
        status: r.status,
        successRate: r.successRate ?? 100,
        lastError: r.lastError,
      }));

    res.json({ topAutomations, problemAutomations });
  } catch (e) { next(e); }
});

export default router;

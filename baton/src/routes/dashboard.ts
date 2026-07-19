/**
 * Dashboard Routes — Baton
 * Aggregated stats and overview data for the main dashboard
 */
import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireViewer } from '../middleware/rbac';

const router = Router();
router.use(requireAuth, requireViewer);

// ─── GET /api/dashboard — Main dashboard overview ────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    // Parallel queries for dashboard data
    const [connections, workflows, rules, recentEvents, recentInstances] = await Promise.all([
      // Connections
      docClient.send(new QueryCommand({
        TableName: TableNames.PLATFORM_CONNECTIONS,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        ExpressionAttributeValues: { ':orgId': orgId },
      })),

      // Workflows
      docClient.send(new QueryCommand({
        TableName: TableNames.WORKFLOWS,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        ExpressionAttributeValues: { ':orgId': orgId },
      })),

      // Active automations
      docClient.send(new QueryCommand({
        TableName: TableNames.AUTOMATION_RULES,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        FilterExpression: '#st <> :disabled',
        ExpressionAttributeValues: { ':orgId': orgId, ':disabled': 'disabled' },
        ExpressionAttributeNames: { '#st': 'status' },
      })),

      // Recent events (last 24h)
      docClient.send(new QueryCommand({
        TableName: TableNames.TRIGGER_PIPELINE,
        IndexName: 'orgId-triggeredAt-index',
        KeyConditionExpression: 'orgId = :orgId AND triggeredAt >= :since',
        ExpressionAttributeValues: {
          ':orgId': orgId,
          ':since': new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        ScanIndexForward: false,
        Limit: 10,
      })),

      // Recent instances
      docClient.send(new QueryCommand({
        TableName: TableNames.WORKFLOW_INSTANCES,
        IndexName: 'orgId-startedAt-index',
        KeyConditionExpression: 'orgId = :orgId',
        ExpressionAttributeValues: { ':orgId': orgId },
        ScanIndexForward: false,
        Limit: 5,
      })),
    ]);

    const allConnections = connections.Items || [];
    const allWorkflows = workflows.Items || [];
    const allRules = rules.Items || [];
    const events = recentEvents.Items || [];
    const instances = recentInstances.Items || [];

    // ─── Build Attention Items ──────────────────────────────
    const attentionItems: Array<{
      id: string;
      severity: 'critical' | 'warning' | 'info';
      title: string;
      description: string;
      platform?: string;
      timestamp: string;
      actionUrl?: string;
    }> = [];

    const now = Date.now();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    // 1. Connection issues: expired/expiring tokens, error/warning status
    for (const conn of allConnections as any[]) {
      const platformLabel = conn.displayName || conn.platform;

      if (conn.status === 'error') {
        attentionItems.push({
          id: `conn-error-${conn.id}`,
          severity: 'critical',
          title: 'OAuth token expired \u2014 reconnection needed',
          description: platformLabel,
          platform: conn.platform,
          timestamp: conn.updatedAt || conn.createdAt,
          actionUrl: '/connections',
        });
      } else if (conn.status === 'warning') {
        attentionItems.push({
          id: `conn-warn-${conn.id}`,
          severity: 'warning',
          title: 'Connection issue detected',
          description: platformLabel,
          platform: conn.platform,
          timestamp: conn.updatedAt || conn.createdAt,
          actionUrl: '/connections',
        });
      } else if (conn.tokenExpiresAt) {
        const expiresAt = new Date(conn.tokenExpiresAt).getTime();
        const timeLeft = expiresAt - now;
        if (timeLeft <= 0) {
          attentionItems.push({
            id: `conn-expired-${conn.id}`,
            severity: 'critical',
            title: 'OAuth token expired \u2014 reconnection needed',
            description: platformLabel,
            platform: conn.platform,
            timestamp: conn.tokenExpiresAt,
            actionUrl: '/connections',
          });
        } else if (timeLeft <= TWO_DAYS) {
          const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
          const label = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} day(s)` : `${hoursLeft} hour(s)`;
          attentionItems.push({
            id: `conn-expiring-${conn.id}`,
            severity: 'warning',
            title: `Token expiring in ${label} \u2014 refresh required`,
            description: platformLabel,
            platform: conn.platform,
            timestamp: conn.tokenExpiresAt,
            actionUrl: '/connections',
          });
        }
      }
    }

    // 2. Automations in error state or auto-paused due to failures
    for (const rule of allRules as any[]) {
      if (rule.status === 'error') {
        const errorMsg = rule.lastError?.message || 'Multiple consecutive failures';
        attentionItems.push({
          id: `rule-error-${rule.id}`,
          severity: 'critical',
          title: `Automation '${rule.name}' is in error state`,
          description: errorMsg,
          platform: rule.sourcePlatform,
          timestamp: rule.updatedAt || rule.createdAt,
          actionUrl: '/automations',
        });
      } else if (rule.status === 'paused' && rule.failureCount > 0) {
        attentionItems.push({
          id: `rule-paused-${rule.id}`,
          severity: 'warning',
          title: `Automation '${rule.name}' auto-paused after failures`,
          description: `${rule.failureCount} failure(s) \u2014 review and resume`,
          platform: rule.sourcePlatform,
          timestamp: rule.updatedAt || rule.createdAt,
          actionUrl: '/automations',
        });
      }
    }

    // 3. Failed workflow instances (last 24h)
    for (const inst of instances as any[]) {
      if (inst.status === 'failed') {
        const stepInfo = inst.errorStep ? ` on step ${inst.errorStep}` : '';
        attentionItems.push({
          id: `inst-failed-${inst.id}`,
          severity: 'critical',
          title: `Workflow '${inst.instanceName}' failed${stepInfo}`,
          description: inst.errorMessage || 'Unknown error',
          platform: undefined,
          timestamp: inst.completedAt || inst.startedAt,
        });
      }
    }

    // 4. Failed pipeline events with user-actionable messages (last 24h)
    for (const evt of events as any[]) {
      if (evt.status === 'failed' && evt.userActionable && evt.userMessage) {
        attentionItems.push({
          id: `event-failed-${evt.id}`,
          severity: evt.errorCategory === 'auth' ? 'critical' : 'warning',
          title: evt.userMessage,
          description: evt.eventSummary || evt.actionDescription || '',
          platform: evt.sourcePlatform,
          timestamp: evt.triggeredAt,
          actionUrl: '/events',
        });
      }
    }

    // Sort by severity (critical first), then by timestamp (newest first)
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    attentionItems.sort((a, b) => {
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      if (sev !== 0) return sev;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    res.json({
      overview: {
        connections: {
          total: allConnections.length,
          healthy: allConnections.filter((c: any) => c.status === 'healthy').length,
          warning: allConnections.filter((c: any) => c.status === 'warning').length,
          error: allConnections.filter((c: any) => c.status === 'error').length,
        },
        workflows: {
          total: allWorkflows.filter((w: any) => w.maestroStatus === 'active').length,
          active: allWorkflows.filter((w: any) => w.maestroStatus === 'active').length,
          totalLaunches: allWorkflows.filter((w: any) => w.maestroStatus === 'active').reduce((sum: number, w: any) => sum + (w.launchCount || 0), 0),
        },
        automations: {
          total: allRules.length,
          active: allRules.filter((r: any) => r.status === 'active').length,
          paused: allRules.filter((r: any) => r.status === 'paused').length,
          error: allRules.filter((r: any) => r.status === 'error').length,
        },
        events24h: {
          total: events.length,
          failed: events.filter((e: any) => e.status === 'failed').length,
        },
      },
      attentionItems,
      recentEvents: events.slice(0, 10),
      recentInstances: instances,
      connections: allConnections.map((c: any) => {
        const { accessTokenEnc, refreshTokenEnc, webhookSecret, ...safe } = c;
        return safe;
      }),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

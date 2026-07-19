/**
 * Platforms Routes — Baton
 *
 * Manages installed platforms (webhook-key based integrations, no OAuth).
 * Only superuser/owner can install or delete platforms; all authenticated
 * users can view installed platforms and the catalog.
 *
 * API:
 *   GET  /api/platforms/catalog     — full AppTemplate list (authenticated)
 *   POST /api/platforms/preflight   — generate a webhookKey ahead of installation
 *   GET  /api/platforms/:id         — get single installed platform
 *   GET  /api/platforms             — list installed platforms for org (viewer+)
 *   POST /api/platforms             — install a platform (superuser/owner only)
 *   DELETE /api/platforms/:id       — soft-delete platform (superuser/owner only)
 */
import * as crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  PutCommand, QueryCommand, UpdateCommand, GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  PlatformPreflightInput,
  InstallPlatformInput,
  UpdatePlatformSecretInput,
} from '../docs/schemas/platform';
import { getDocClient, TableNames } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin, requireViewer } from '../middleware/rbac';
import { logInfo, logWarn } from '../lib/logger';
import { logAudit } from '../services/audit.service';
import { ValidationError, NotFoundError, ConflictError } from '../middleware/error-handler';
import { getAllAppTemplates, getAppTemplate } from '../lib/app-catalog';
import { encryptToken } from '../lib/encryption';
import { OrgApp } from '../lib/types';
import env from '../env';

const router = Router();
router.use(requireAuth);

// ─── Helpers ─────────────────────────────────────────────────

/** Build the full public webhook URL — always uses APP_URL from env */
function webhookUrl(webhookKey: string): string {
  return `${env.APP_URL}/api/webhooks/app/${webhookKey}`;
}

/** Strip secretKeyEnc — never expose the encrypted secret in responses */
function safeApp(app: OrgApp): Omit<OrgApp, 'secretKeyEnc'> & { webhookUrl: string } {
  const { secretKeyEnc: _omit, ...safe } = app as any;
  return { ...safe, webhookUrl: webhookUrl(app.webhookKey) };
}

/** Generate a 64-char hex capability token */
function generateWebhookKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── GET /api/platforms/catalog ────────────────────────────────────

router.get('/catalog', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = getAllAppTemplates().map(({ ...t }) => {
      // Never expose internal verification details in the catalog response
      const { verificationMethod: _vm, ...safe } = t;
      return safe;
    });
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/platforms/preflight ─────────────────────────────────
// Step 1 of the install wizard: generate a webhookKey so the URL can be
// displayed *before* the user has entered the secret key.
// Does NOT persist anything — just returns a pre-generated key.

router.post('/preflight', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appSlug } = PlatformPreflightInput.parse(req.body);

    const template = getAppTemplate(appSlug);
    if (!template) {
      throw new ValidationError(`Unknown platform slug: ${appSlug}`);
    }

    const webhookKey = generateWebhookKey();
    res.json({
      webhookKey,
      webhookUrl: webhookUrl(webhookKey),
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/platforms/:id — Get single installed platform ────────────

router.get('/:id', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const docClient = getDocClient();

    const appResult = await docClient.send(new GetCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: req.params.id },
    }));

    const app = appResult.Item as OrgApp | undefined;
    if (!app || app.orgId !== orgId) {
      throw new NotFoundError('Platform');
    }

    const template = getAppTemplate(app.appSlug);
    res.json({
      platform: {
        ...safeApp(app),
        name: template?.name || app.appSlug,
        logoUrl: template?.logoUrl,
        icon: template?.icon,
        category: template?.category,
        supportedEvents: template?.supportedEvents || [],
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/platforms ────────────────────────────────────────────

router.get('/', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const statusFilter = (req.query.status as string) || 'active';
    const docClient = getDocClient();

    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.ORG_APPS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: '#st = :status',
      ExpressionAttributeValues: { ':orgId': orgId, ':status': statusFilter },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    const apps = (result.Items as OrgApp[] || []).map((app) => {
      const template = getAppTemplate(app.appSlug);
      return {
        ...safeApp(app),
        name: template?.name || app.appSlug,
        logoUrl: template?.logoUrl,
        icon: template?.icon,
        category: template?.category,
        supportedEvents: template?.supportedEvents || [],
      };
    });

    res.json({ platforms: apps });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/platforms ───────────────────────────────────────────

router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appSlug, secretKey, displayName, webhookKey: providedKey } = InstallPlatformInput.parse(req.body);
    const orgId = req.auth!.orgId;

    const template = getAppTemplate(appSlug);
    if (!template) {
      throw new ValidationError(`Unknown platform: ${appSlug}`);
    }

    const docClient = getDocClient();

    // Check for duplicate active installation
    const existing = await docClient.send(new QueryCommand({
      TableName: TableNames.ORG_APPS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: 'appSlug = :slug AND #st = :active',
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':slug': appSlug,
        ':active': 'active',
      },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    if (existing.Items && existing.Items.length > 0) {
      throw new ConflictError(
        `${template.name} is already installed. Remove it first to reinstall with a new secret.`,
      );
    }

    const webhookKey = providedKey || generateWebhookKey();
    const secretKeyEnc = secretKey ? encryptToken(secretKey) : undefined;

    const app: OrgApp = {
      id: uuidv4(),
      orgId,
      appSlug: appSlug as OrgApp['appSlug'],
      webhookKey,
      secretKeyEnc,
      displayName: displayName || template.name,
      status: 'active',
      addedAt: new Date().toISOString(),
      addedBy: req.auth!.userId,
      webhookCount: 0,
    };

    await docClient.send(new PutCommand({
      TableName: TableNames.ORG_APPS,
      Item: app,
    }));

    logInfo('Platform installed', { appSlug, orgId, appId: app.id });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'platform.installed',
      resourceType: 'platform',
      resourceId: app.id,
      metadata: { appSlug, displayName: app.displayName },
    });

    res.status(201).json({ platform: safeApp(app) });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/platforms/:id ─────────────────────────────────────

router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const appId = req.params.id as string;
    const docClient = getDocClient();

    const appResult = await docClient.send(new GetCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: appId },
    }));

    const app = appResult.Item as OrgApp | undefined;
    if (!app || app.orgId !== orgId || app.status !== 'active') {
      throw new NotFoundError('Platform');
    }

    // Reject if active automations reference this platform
    const rulesResult = await docClient.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: '(appId = :appId OR appSlug = :slug) AND #st = :active',
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':appId': appId,
        ':slug': app.appSlug,
        ':active': 'active',
      },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    if (rulesResult.Items && rulesResult.Items.length > 0) {
      const ruleNames = rulesResult.Items.map((r: any) => r.name).join(', ');
      throw new ConflictError(
        `Cannot remove platform - ${rulesResult.Items.length} active automation(s) use it: ${ruleNames}. Pause or delete those automations first.`,
      );
    }

    await docClient.send(new UpdateCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: appId },
      UpdateExpression: 'SET #st = :inactive',
      ExpressionAttributeValues: { ':inactive': 'inactive' },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    // Disable all remaining automations (paused/error) that reference this platform
    const allRulesResult = await docClient.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: '(appId = :appId OR appSlug = :slug) AND #st <> :disabled',
      ExpressionAttributeValues: {
        ':orgId': orgId,
        ':appId': appId,
        ':slug': app.appSlug,
        ':disabled': 'disabled',
      },
      ExpressionAttributeNames: { '#st': 'status' },
    }));

    if (allRulesResult.Items && allRulesResult.Items.length > 0) {
      await Promise.all(allRulesResult.Items.map((rule: any) =>
        docClient.send(new UpdateCommand({
          TableName: TableNames.AUTOMATION_RULES,
          Key: { id: rule.id },
          UpdateExpression: 'SET #st = :disabled, updatedAt = :now',
          ExpressionAttributeValues: { ':disabled': 'disabled', ':now': new Date().toISOString() },
          ExpressionAttributeNames: { '#st': 'status' },
        })),
      ));
      logInfo('Disabled automations for removed platform', {
        appSlug: app.appSlug, count: allRulesResult.Items.length,
      });
    }

    logInfo('Platform removed', { appSlug: app.appSlug, orgId, appId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'platform.removed',
      resourceType: 'platform',
      resourceId: appId,
      metadata: { appSlug: app.appSlug, displayName: app.displayName },
    });

    res.json({ message: 'Platform removed', id: appId });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/platforms/:id/webhook-secret — Update webhook secret ─

router.patch('/:id/webhook-secret', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const appId = req.params.id as string;
    const docClient = getDocClient();

    const appResult = await docClient.send(new GetCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: appId },
    }));

    const app = appResult.Item as OrgApp | undefined;
    if (!app || app.orgId !== orgId || app.status !== 'active') {
      throw new NotFoundError('Platform');
    }

    const { secret } = UpdatePlatformSecretInput.parse(req.body);
    const secretKeyEnc = encryptToken(secret);

    await docClient.send(new UpdateCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: appId },
      UpdateExpression: 'SET secretKeyEnc = :enc',
      ExpressionAttributeValues: { ':enc': secretKeyEnc },
    }));

    logInfo('Platform webhook secret updated', { appSlug: app.appSlug, orgId, appId });

    logAudit({
      orgId,
      userId: req.auth!.userId,
      action: 'platform.secret_updated',
      resourceType: 'platform',
      resourceId: appId,
      metadata: { appSlug: app.appSlug },
    });

    res.json({ message: 'Webhook secret updated', id: appId });
  } catch (error) {
    next(error);
  }
});

export default router;

/**
 * Salesforce — Rotate Webhook Secret
 *
 * admin-only endpoint for force-rotating the HMAC secret of an existing
 * Salesforce webhook integration. Clears this rule's composite entries
 * (`<sfOrgId>#<webhookKey>`) plus any legacy bare `<sfOrgId>` entries in
 * `OrgApp.sfRegistrations`, then issues a fresh bootstrap token. The next
 * webhook dispatch from an affected SF org will 401 (see `rule.ts` — a
 * missing registration entry never falls back to the app-level legacy secret
 * when the SF header is present); pasting the returned URL into the Flow
 * lets the Apex package's auto-heal path re-register with the fresh token.
 * Composite entries belonging to OTHER rules of the app are untouched.
 *
 *   POST /api/salesforce/rotate-secret
 *   Auth: required (admin)
 *   Body: { webhookKey: string, expiresInHours?: number (1–168, default 24) }
 *   Response 200: { tokenId, expiresAt, webhookUrl, clearedSfOrgs: string[] }
 *
 *   Errors:
 *     400 — payload validation
 *     404 — webhookKey doesn't match a rule in this org
 *     409 — rule has no associated OrgApp (nothing to rotate)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SfRotateSecretInput } from '../docs/schemas/salesforce';
import { getDocClient, TableNames } from '../db/client';
import { requireAdmin } from '../middleware/rbac';
import { NotFoundError, ConflictError } from '../middleware/error-handler';
import { logInfo } from '../lib/logger';
import { AutomationRule, OrgApp } from '../lib/types';
import { createBootstrapToken } from '../services/bootstrap-token.service';
import env from '../env';

const router = Router();

router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const { webhookKey, expiresInHours } = SfRotateSecretInput.parse(req.body);

    const docClient = getDocClient();
    const ruleResult = await docClient.send(new QueryCommand({
      TableName: TableNames.AUTOMATION_RULES,
      IndexName: 'webhookKey-index',
      KeyConditionExpression: 'webhookKey = :wk',
      ExpressionAttributeValues: { ':wk': webhookKey },
    }));

    const rule = ruleResult.Items?.[0] as AutomationRule | undefined;
    if (!rule || rule.orgId !== orgId) {
      throw new NotFoundError('Webhook endpoint');
    }

    if (!rule.appId) {
      throw new ConflictError('Rule has no associated app to rotate');
    }

    const appResult = await docClient.send(new GetCommand({
      TableName: TableNames.ORG_APPS,
      Key: { id: rule.appId },
    }));
    const app = appResult.Item as OrgApp | undefined;
    if (!app) {
      throw new ConflictError('App record not found');
    }

    // Composite entries (`<sfOrgId>#<webhookKey>`) are per-rule — clear only
    // the ones belonging to this webhookKey. Legacy bare `<sfOrgId>` entries
    // predate composite keying and are shared app-wide; they must be cleared
    // too, or the rotated rule's old secret would keep verifying (this keeps
    // the old org-wide rotation semantics for pre-migration data only).
    const allRegKeys = Object.keys(app.sfRegistrations || {});
    const keysToClear = allRegKeys.filter(
      (k) => !k.includes('#') || k.endsWith(`#${webhookKey}`),
    );
    const clearedSfOrgs = [...new Set(keysToClear.map((k) => k.split('#')[0]))];

    if (keysToClear.length > 0) {
      const names: Record<string, string> = { '#reg': 'sfRegistrations' };
      const removeParts = keysToClear.map((k, i) => {
        names[`#k${i}`] = k;
        return `#reg.#k${i}`;
      });
      await docClient.send(new UpdateCommand({
        TableName: TableNames.ORG_APPS,
        Key: { id: app.id },
        UpdateExpression: `REMOVE ${removeParts.join(', ')}`,
        ExpressionAttributeNames: names,
      }));
    }

    const { tokenId, expiresAt } = await createBootstrapToken({
      webhookKey,
      orgId,
      expiresInHours,
    });

    const webhookUrl = `${env.APP_URL}/api/webhooks/rule/${webhookKey}?bootstrap=${encodeURIComponent(tokenId)}`;

    logInfo('SF webhook secret rotated', {
      orgId,
      ruleId: rule.id,
      appId: app.id,
      webhookKey: webhookKey.substring(0, 8) + '...',
      clearedSfOrgs,
      tokenIdPrefix: tokenId.substring(0, 12) + '...',
      expiresAt,
    });

    res.status(200).json({ tokenId, expiresAt, webhookUrl, clearedSfOrgs });
  } catch (err) {
    next(err);
  }
});

export default router;

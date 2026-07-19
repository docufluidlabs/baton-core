/**
 * Salesforce Bootstrap Tokens — Baton
 *
 * Authenticated endpoint that the Baton frontend calls when an admin sets up
 * a Salesforce automation. Issues a one-time bootstrap token bound to the
 * rule's webhookKey. The frontend then shows the customer a single URL of
 * the form `https://<host>/api/webhooks/rule/<webhookKey>?bootstrap=<tokenId>`
 * to paste into the Flow Builder action — no manual secret handling.
 *
 *   POST /api/salesforce/bootstrap-tokens
 *   Auth: required (admin/member)
 *   Body: { webhookKey: string, expiresInHours?: number (1–168, default 24) }
 *   Response 200: {
 *     tokenId: string,
 *     expiresAt: number (unix epoch s),
 *     webhookUrl: string  // pre-built URL with ?bootstrap=... included
 *   }
 *
 *   Errors:
 *     400 — payload validation
 *     404 — webhookKey doesn't match a rule in this org
 */

import { Router, Request, Response, NextFunction } from 'express';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SfBootstrapTokenInput } from '../docs/schemas/salesforce';
import { getDocClient, TableNames } from '../db/client';
import { requireMember } from '../middleware/rbac';
import { NotFoundError } from '../middleware/error-handler';
import { logInfo } from '../lib/logger';
import { AutomationRule } from '../lib/types';
import { createBootstrapToken } from '../services/bootstrap-token.service';
import env from '../env';

const router = Router();

router.post('/', requireMember, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const { webhookKey, expiresInHours } = SfBootstrapTokenInput.parse(req.body);

    // ─── Verify the webhookKey belongs to a rule in THIS org ────
    // Without this guard, anyone authed could mint a token for another org's rule.
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

    // ─── Issue the bootstrap token ──────────────────────────────
    const { tokenId, expiresAt } = await createBootstrapToken({
      webhookKey,
      orgId,
      expiresInHours,
    });

    const webhookUrl = `${env.APP_URL}/api/webhooks/rule/${webhookKey}?bootstrap=${encodeURIComponent(tokenId)}`;

    logInfo('SF bootstrap token issued', {
      orgId,
      ruleId: rule.id,
      webhookKey: webhookKey.substring(0, 8) + '...',
      tokenIdPrefix: tokenId.substring(0, 12) + '...',
      expiresAt,
    });

    res.status(200).json({ tokenId, expiresAt, webhookUrl });
  } catch (err) {
    next(err);
  }
});

export default router;

/**
 * Bootstrap Token Service — Baton
 *
 * One-time-use registration tokens for the Salesforce managed package v0.3+
 * bootstrap auth flow. See:
 *   (internal design note)
 *
 * Flow:
 *   1. Baton issues a token when an admin creates an SF automation. The token
 *      is embedded in the webhook URL given to the customer:
 *        https://app.iambaton.com/api/webhooks/rule/<webhookKey>?bootstrap=<tokenId>
 *   2. SF Apex's first webhook detects the bootstrap param, generates an HMAC
 *      secret in Apex, and POSTs to /api/salesforce/webhook-registrations.
 *   3. We atomically flip `redeemed=false → true` and store the SF org context.
 *   4. Subsequent webhook events from that SF org use the now-stored secret
 *      for HMAC verification (existing rule.ts handler path).
 *
 * Idempotency:
 *   The Apex callout may be retried (network blip, future-method retry). Each
 *   request carries an Idempotency-Key header. If the same key arrives after
 *   the token is already redeemed, we return the cached registrationResponse
 *   without erroring. A different key on a redeemed token is a hard conflict.
 *
 * Table: baton-bootstrap-tokens
 *   PK: tokenId
 *   TTL: expiresAt (DynamoDB auto-deletes expired items)
 */

import { randomBytes } from 'crypto';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { BootstrapToken } from '../lib/types';
import { logDebug, logError, logInfo, logWarn } from '../lib/logger';
import { ConflictError, NotFoundError, UnauthorizedError } from '../middleware/error-handler';

const DEFAULT_EXPIRY_HOURS = 24;
const TOKEN_PREFIX = 'btn_';

// ─── Create ──────────────────────────────────────────────────

export async function createBootstrapToken(params: {
  webhookKey: string;
  orgId: string;
  expiresInHours?: number;
}): Promise<{ tokenId: string; expiresAt: number }> {
  const tokenId = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (params.expiresInHours ?? DEFAULT_EXPIRY_HOURS) * 3600;

  const item: BootstrapToken = {
    tokenId,
    webhookKey: params.webhookKey,
    orgId: params.orgId,
    createdAt: new Date(now * 1000).toISOString(),
    expiresAt,
    redeemed: false,
  };

  await getDocClient().send(new PutCommand({
    TableName: TableNames.BOOTSTRAP_TOKENS,
    Item: item,
  }));

  logInfo('Bootstrap token issued', {
    tokenId: tokenId.substring(0, 12) + '...',
    webhookKey: params.webhookKey.substring(0, 8) + '...',
    orgId: params.orgId,
    expiresInHours: params.expiresInHours ?? DEFAULT_EXPIRY_HOURS,
  });

  return { tokenId, expiresAt };
}

// ─── Read ────────────────────────────────────────────────────

export async function getBootstrapToken(tokenId: string): Promise<BootstrapToken | null> {
  const result = await getDocClient().send(new GetCommand({
    TableName: TableNames.BOOTSTRAP_TOKENS,
    Key: { tokenId },
  }));
  return (result.Item as BootstrapToken) || null;
}

// ─── Redeem (atomic, idempotent) ─────────────────────────────

export interface RedeemParams {
  tokenId: string;
  /** webhookKey from the URL path the SF Apex called — must match token's stored webhookKey. */
  webhookKey: string;
  /** Idempotency-Key header — typically `<sfOrgId>_<webhookKey>_<tokenId>` */
  idempotencyKey: string;
  sfOrgId: string;
  registrationResponse: NonNullable<BootstrapToken['registrationResponse']>;
}

export interface RedeemResult {
  token: BootstrapToken;
  /** true = token was already redeemed with this exact idempotency-key (safe replay). */
  isIdempotentReplay: boolean;
}

/**
 * Atomically mark a bootstrap token as redeemed and persist registration metadata.
 *
 * Throws:
 *   NotFoundError    — token doesn't exist (or already TTL-expired)
 *   UnauthorizedError — token expired (TTL race), or webhookKey mismatch
 *   ConflictError    — token already redeemed by a DIFFERENT idempotency-key
 */
export async function redeemBootstrapToken(params: RedeemParams): Promise<RedeemResult> {
  const docClient = getDocClient();
  const now = Math.floor(Date.now() / 1000);
  const nowIso = new Date(now * 1000).toISOString();

  // Try the atomic flip first. If the token is already redeemed (or never
  // existed), the conditional update fails and we fall through to the
  // idempotency / not-found handling.
  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: TableNames.BOOTSTRAP_TOKENS,
      Key: { tokenId: params.tokenId },
      ConditionExpression:
        'attribute_exists(tokenId) AND redeemed = :false AND expiresAt > :now AND webhookKey = :wk',
      UpdateExpression:
        'SET redeemed = :true, redeemedAt = :nowIso, redeemedBySfOrgId = :sfOrgId, '
        + 'idempotencyKey = :idem, registrationResponse = :resp, persisted = :false',
      ExpressionAttributeValues: {
        ':false': false,
        ':true': true,
        ':now': now,
        ':wk': params.webhookKey,
        ':nowIso': nowIso,
        ':sfOrgId': params.sfOrgId,
        ':idem': params.idempotencyKey,
        ':resp': params.registrationResponse,
      },
      ReturnValues: 'ALL_NEW',
    }));

    logInfo('Bootstrap token redeemed', {
      tokenId: params.tokenId.substring(0, 12) + '...',
      sfOrgId: params.sfOrgId,
    });

    return { token: result.Attributes as BootstrapToken, isIdempotentReplay: false };
  } catch (err: any) {
    if (err.name !== 'ConditionalCheckFailedException') {
      logError('Bootstrap redeem failed unexpectedly', err, {
        tokenId: params.tokenId.substring(0, 12) + '...',
      });
      throw err;
    }
    // Conditional failed — diagnose why by reading the item.
  }

  const existing = await getBootstrapToken(params.tokenId);

  if (!existing) {
    logWarn('Bootstrap redeem: token not found', {
      tokenId: params.tokenId.substring(0, 12) + '...',
    });
    throw new NotFoundError('Bootstrap token');
  }

  if (existing.expiresAt <= now) {
    logWarn('Bootstrap redeem: token expired', {
      tokenId: params.tokenId.substring(0, 12) + '...',
      expiresAt: existing.expiresAt,
    });
    throw new UnauthorizedError('Bootstrap token expired');
  }

  if (existing.webhookKey !== params.webhookKey) {
    logWarn('Bootstrap redeem: webhookKey mismatch', {
      tokenId: params.tokenId.substring(0, 12) + '...',
    });
    throw new UnauthorizedError('Bootstrap token does not match this webhook URL');
  }

  // Token IS redeemed. Idempotent replay if the same key arrives again.
  if (existing.redeemed && existing.idempotencyKey === params.idempotencyKey) {
    logDebug('Bootstrap redeem: idempotent replay', {
      tokenId: params.tokenId.substring(0, 12) + '...',
    });
    return { token: existing, isIdempotentReplay: true };
  }

  // Different idempotency key on an already-redeemed token = bad actor or
  // genuine bug. Refuse rather than overwrite the prior registration.
  logWarn('Bootstrap redeem: conflicting idempotency-key on redeemed token', {
    tokenId: params.tokenId.substring(0, 12) + '...',
    sfOrgId: params.sfOrgId,
  });
  throw new ConflictError('Bootstrap token already redeemed');
}

// ─── Mark persisted ────────────────────────────────────────────

/**
 * Flip `persisted` to true once the registration secret has been written to
 * OrgApp.sfRegistrations. Idempotent replays consult this flag: if the
 * original request crashed between token redemption and the OrgApp write,
 * the replay re-persists the cached secret (self-heal) instead of returning
 * a response the backend never actually honoured.
 *
 * Best-effort by design — if THIS update fails after a successful OrgApp
 * write, the only consequence is that a future replay redundantly re-writes
 * the same secret.
 */
export async function markBootstrapTokenPersisted(tokenId: string): Promise<void> {
  await getDocClient().send(new UpdateCommand({
    TableName: TableNames.BOOTSTRAP_TOKENS,
    Key: { tokenId },
    UpdateExpression: 'SET persisted = :true',
    ConditionExpression: 'attribute_exists(tokenId)',
    ExpressionAttributeValues: { ':true': true },
  }));

  logDebug('Bootstrap token marked persisted', {
    tokenId: tokenId.substring(0, 12) + '...',
  });
}

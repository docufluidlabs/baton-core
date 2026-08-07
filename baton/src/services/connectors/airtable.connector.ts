/**
 * Airtable Connector — Baton
 *
 * Airtable is webhook-only here (Option A of the integration research): an
 * Airtable Automation ("When record created / matches conditions" trigger +
 * "Run a script" action) POSTs events into Baton's app-webhook endpoint
 * (POST /api/webhooks/app/:webhookKey). Authentication is a static shared
 * token in the X-Baton-Token header, handled by the app-webhook route via the
 * `static_token` verificationMethod from the catalog — Airtable's scripting
 * environment has NO crypto primitives, so HMAC signing is not possible from
 * an automation script; a long random token compared timing-safe is the
 * strongest scheme the platform can actually deliver.
 *
 * (Airtable's native Webhooks API — thin pings signed with
 * X-Airtable-Content-MAC plus a payloads fetch and 7-day refresh — is the
 * future "Option B" upgrade and deliberately NOT this connector.)
 *
 * Expected body (assembled by the user's automation script):
 *   { "event": "record.created", "recordId": "recXXXX", "data": { ... } }
 */

import * as crypto from 'crypto';
import {
  BasePlatformConnector,
  OAuthAuthorizeResult,
  OAuthCallbackParams,
  OAuthTokens,
  WebhookVerificationResult,
  ExtractedEventInfo,
  ConnectionHealthCheck,
} from './platform-connector.interface';
import { Platform } from '../../lib/types';

const WEBHOOK_ONLY_MESSAGE =
  'Airtable is a webhook-only integration in Baton — install it from the Apps catalog, not via OAuth.';

const TOKEN_HEADER = 'x-baton-token';

export class AirtableConnector extends BasePlatformConnector {
  readonly platform: Platform = 'airtable';
  readonly displayName = 'Airtable';

  // ─── OAuth (not supported — webhook-only) ──────────────────

  async authorize(_orgId: string, _userId: string): Promise<OAuthAuthorizeResult> {
    throw new Error(WEBHOOK_ONLY_MESSAGE);
  }

  async handleCallback(_params: OAuthCallbackParams): Promise<OAuthTokens> {
    throw new Error(WEBHOOK_ONLY_MESSAGE);
  }

  async refreshToken(_refreshToken: string): Promise<OAuthTokens> {
    throw new Error(WEBHOOK_ONLY_MESSAGE);
  }

  // ─── Webhook Verification ──────────────────────────────────

  /**
   * Static-token verification. NOTE: the live app-webhook path verifies the
   * token itself (routes/webhooks/app.ts, `static_token`), so this is only a
   * safety net for any future dedicated route. `secret` is the stored token.
   */
  verifyWebhookSignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    if (!secret) {
      return { valid: false, reason: 'Airtable webhook token not configured' };
    }

    const provided = headers[TOKEN_HEADER];
    if (!provided) {
      return { valid: false, reason: `Missing ${TOKEN_HEADER} header` };
    }

    try {
      const expectedBuf = Buffer.from(secret);
      const providedBuf = Buffer.from(provided);
      const valid =
        expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
      return { valid, reason: valid ? undefined : 'Invalid token' };
    } catch {
      return { valid: false, reason: 'Token comparison failed' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  /**
   * The user's automation script controls the body, so we normalize a small,
   * documented envelope. `event` is the only required field; everything else
   * is best-effort with Airtable-flavored fallbacks.
   *
   * Accepted shapes:
   *   { event, recordId, summary?, userEmail?, data?, base?, table? }
   *   { eventType | event_type | type, id, ... }   (fallbacks)
   */
  extractEventInfo(payload: any): ExtractedEventInfo {
    const rawEvent: string =
      payload?.event ?? payload?.eventType ?? payload?.event_type ?? payload?.type ?? 'record.changed';
    const eventType = String(rawEvent).toLowerCase();

    const recordId =
      payload?.recordId ?? payload?.record_id ?? payload?.id ?? payload?.data?.id ?? undefined;

    const actingUserEmail =
      payload?.userEmail ?? payload?.actingUserEmail ?? payload?.user?.email ?? undefined;

    const eventLabel = humanizeEvent(eventType);
    const tableName = payload?.table ?? payload?.tableName ?? payload?.data?.table;
    const summary =
      payload?.summary ??
      `${eventLabel}${tableName ? ` in ${tableName}` : ''}${recordId ? ` — ${recordId}` : ''}`;

    return {
      eventType,
      eventLabel,
      actingUserEmail,
      recordId: recordId !== undefined ? String(recordId) : undefined,
      summary,
      rawEventType: String(rawEvent),
      metadata: {
        data: payload?.data,
        base: payload?.base ?? payload?.baseId,
        table: tableName,
      },
    };
  }

  // ─── Health Check (no API — webhook-only) ──────────────────

  async testConnection(_accessToken: string): Promise<ConnectionHealthCheck> {
    return { healthy: true, message: 'Airtable is webhook-only; nothing to test.' };
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'record.created', label: 'Record Created', description: 'A new record was created in a table' },
      { eventType: 'record.updated', label: 'Record Updated', description: 'A record was updated' },
      { eventType: 'record.matches_conditions', label: 'Record Matches Conditions', description: 'A record entered a view or matched the automation conditions' },
      { eventType: 'form.submitted', label: 'Form Submitted', description: 'An Airtable form response created a record' },
      // The automation script can emit any string — the value of `event` becomes the type.
      { eventType: '*', label: 'Any Event', description: 'Match any event string sent by the automation' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function humanizeEvent(eventType: string): string {
  // "record.created" → "Record Created"
  return eventType
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Record Changed';
}

export const airtableConnector = new AirtableConnector();

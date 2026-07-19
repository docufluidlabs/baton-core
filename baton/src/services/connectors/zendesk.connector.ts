/**
 * Zendesk Connector — Baton
 *
 * Webhook-only integration (no OAuth). Installed as a catalog app; webhooks
 * arrive at POST /api/webhooks/app/:webhookKey and are verified there using the
 * `hmac_zendesk` scheme. This connector provides event normalization (so rules
 * can target specific events like `ticket.created`) and the supported-event list.
 *
 * Target mechanism: Zendesk **Event subscriptions** (Admin Center → Apps and
 * integrations → Webhooks). Those emit a structured, signed envelope:
 *   {
 *     "type": "zen:event-type:ticket.created",
 *     "subject": "zen:ticket:35436",
 *     "detail": { "id": "35436", ... },
 *     "event": { ... },
 *     "account_id": 123, "time": "2026-…"
 *   }
 *
 * Signature: HMAC-SHA256(secret, timestamp + rawBody) → base64.
 *   Headers: X-Zendesk-Webhook-Signature, X-Zendesk-Webhook-Signature-Timestamp
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
import { getAppTemplate } from '../../lib/app-catalog';

// ─── Constants ────────────────────────────────────────────────

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes — replay protection
const EVENT_TYPE_PREFIX = 'zen:event-type:';

// ─── Connector ────────────────────────────────────────────────

export class ZendeskConnector extends BasePlatformConnector {
  readonly platform: Platform = 'zendesk';
  readonly displayName = 'Zendesk';

  // ─── OAuth (not used — webhook-only) ────────────────────────

  async authorize(): Promise<OAuthAuthorizeResult> {
    throw new Error('Zendesk integration is webhook-only - OAuth not supported');
  }

  async handleCallback(): Promise<OAuthTokens> {
    throw new Error('Zendesk integration is webhook-only - OAuth not supported');
  }

  async refreshToken(): Promise<OAuthTokens> {
    throw new Error('Zendesk integration is webhook-only - OAuth not supported');
  }

  // ─── Webhook Verification ──────────────────────────────────

  /**
   * Zendesk signs `timestamp + rawBody` with HMAC-SHA256, base64-encoded.
   * https://developer.zendesk.com/documentation/webhooks/verifying/
   *
   * Headers:
   *   X-Zendesk-Webhook-Signature            — base64 HMAC
   *   X-Zendesk-Webhook-Signature-Timestamp  — ISO-8601 timestamp (also signed)
   *
   * NOTE: The live verification path for Zendesk is the catalog-app route
   * (routes/webhooks/app.ts → `hmac_zendesk`). This implementation mirrors that
   * scheme so the connector stays self-consistent and reusable.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-zendesk-webhook-signature'];
    const timestamp = headers['x-zendesk-webhook-signature-timestamp'];

    if (!signature) {
      return { valid: false, reason: 'Missing X-Zendesk-Webhook-Signature header' };
    }
    if (!timestamp) {
      return { valid: false, reason: 'Missing X-Zendesk-Webhook-Signature-Timestamp header' };
    }
    if (!secret) {
      return { valid: false, reason: 'Zendesk signing secret not configured' };
    }

    // Replay protection: reject webhooks older than 5 minutes
    const tsMs = Date.parse(timestamp);
    if (!Number.isNaN(tsMs) && Date.now() - tsMs > MAX_TIMESTAMP_AGE_MS) {
      return { valid: false, reason: 'Webhook timestamp too old (possible replay attack)' };
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(timestamp + rawBody.toString('utf8'))
      .digest('base64');

    try {
      const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      return { valid, reason: valid ? undefined : 'HMAC signature mismatch' };
    } catch {
      return { valid: false, reason: 'Signature comparison failed (length mismatch)' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  /**
   * Normalize a Zendesk Event-subscription payload to `{resource}.{action}`,
   * e.g. `ticket.created`. Falls back to `event_type`/`type` for non-prefixed
   * (trigger-built) bodies, then to `webhook` so a `*` rule still matches.
   */
  extractEventInfo(payload: any): ExtractedEventInfo {
    const rawType: string = payload?.type || payload?.event_type || payload?.eventType || '';

    // Event subscriptions send "zen:event-type:ticket.created".
    const eventType = rawType.startsWith(EVENT_TYPE_PREFIX)
      ? rawType.slice(EVENT_TYPE_PREFIX.length)
      : rawType || 'webhook';

    // recordId: prefer detail.id, else parse subject ("zen:ticket:35436" → 35436).
    const subject: string = payload?.subject || '';
    const subjectId = subject.includes(':') ? subject.slice(subject.lastIndexOf(':') + 1) : undefined;
    const recordId =
      payload?.detail?.id?.toString() ||
      payload?.detail?.ticket_id?.toString() ||
      subjectId ||
      payload?.id?.toString();

    const known = this.getSupportedEventTypes().find((e) => e.eventType === eventType);
    const eventLabel = known?.label || toLabel(eventType);

    return {
      eventType,
      eventLabel,
      recordId,
      actingUserEmail: payload?.detail?.email || payload?.detail?.requester?.email,
      summary: known?.description || eventLabel,
      rawEventType: rawType,
      metadata: {
        accountId: payload?.account_id,
        subject,
        time: payload?.time,
        zendeskEventVersion: payload?.zendesk_event_version,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(): Promise<ConnectionHealthCheck> {
    // Webhook-only — no API connection to test
    return { healthy: true, message: 'Webhook-only integration - no API connection to test' };
  }

  // ─── Supported Events ──────────────────────────────────────

  /** Reuse the catalog list so the connector and wizard never drift. */
  getSupportedEventTypes() {
    return (getAppTemplate('zendesk')?.supportedEvents ?? []).map((e) => ({
      eventType: e.eventType,
      label: e.label,
      description: e.description,
    }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** "ticket.created" → "Ticket Created" (fallback when not in the catalog). */
function toLabel(eventType: string): string {
  if (!eventType || eventType === 'webhook') return 'Webhook Event';
  return eventType
    .split(/[._]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

export const zendeskConnector = new ZendeskConnector();

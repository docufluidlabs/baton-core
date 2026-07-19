/**
 * Microsoft Power Automate Connector — Baton
 *
 * Power Automate is webhook-only here. A Power Automate cloud flow uses the
 * premium "HTTP" action to POST events into Baton's app-webhook endpoint
 * (POST /api/webhooks/app/:webhookKey). Authentication is Basic Auth, handled
 * directly by the app-webhook route (routes/webhooks/app.ts) using the
 * `basic_auth` verificationMethod from the catalog — so this connector is only
 * responsible for normalizing the incoming payload into a Baton event.
 *
 * Power Automate's HTTP action has no built-in HMAC, so signatures are not used;
 * verifyWebhookSignature here implements Basic Auth purely for completeness in
 * case a dedicated route is ever wired up (it is NOT used by the app-webhook path).
 *
 * Expected body (configured by the user on the HTTP action):
 *   { "event": "invoice.approved", "recordId": "INV-1001", "data": { ... } }
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
  'Power Automate is a webhook-only integration in Baton — install it from the Apps catalog, not via OAuth.';

export class PowerAutomateConnector extends BasePlatformConnector {
  readonly platform: Platform = 'powerautomate';
  readonly displayName = 'Microsoft Power Automate';

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
   * Basic Auth verification. NOTE: the live app-webhook path verifies Basic Auth
   * itself (routes/webhooks/app.ts), so this is only a safety net for any future
   * dedicated route. `secret` is the stored "username:password" pair.
   */
  verifyWebhookSignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    if (!secret || secret.indexOf(':') === -1) {
      return { valid: false, reason: 'Power Automate basic_auth secret not configured (expected username:password)' };
    }

    const authHeader = headers['authorization'] || '';
    if (!authHeader.startsWith('Basic ')) {
      return { valid: false, reason: 'Missing or non-Basic Authorization header' };
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      return { valid: false, reason: 'Malformed Authorization header' };
    }

    const providedUser = Buffer.from(decoded.slice(0, colonIdx));
    const providedPass = Buffer.from(decoded.slice(colonIdx + 1));
    const storedColonIdx = secret.indexOf(':');
    const expectedUser = Buffer.from(secret.slice(0, storedColonIdx));
    const expectedPass = Buffer.from(secret.slice(storedColonIdx + 1));

    try {
      const userMatch =
        providedUser.length === expectedUser.length && crypto.timingSafeEqual(providedUser, expectedUser);
      const passMatch =
        providedPass.length === expectedPass.length && crypto.timingSafeEqual(providedPass, expectedPass);
      const valid = userMatch && passMatch;
      return { valid, reason: valid ? undefined : 'Invalid credentials' };
    } catch {
      return { valid: false, reason: 'Basic Auth comparison failed' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  /**
   * Power Automate gives the user full control over the HTTP action body, so we
   * normalize a small, documented envelope. `event` is the only required field;
   * everything else is best-effort.
   *
   * Accepted shapes:
   *   { event, recordId, summary?, userEmail?, data? }
   *   { eventType | event_type | type, id, ... }   (fallbacks)
   */
  extractEventInfo(payload: any): ExtractedEventInfo {
    const rawEvent: string =
      payload?.event ?? payload?.eventType ?? payload?.event_type ?? payload?.type ?? 'flow.triggered';
    const eventType = String(rawEvent).toLowerCase();

    const recordId =
      payload?.recordId ?? payload?.record_id ?? payload?.id ?? payload?.data?.id ?? undefined;

    const actingUserEmail =
      payload?.userEmail ?? payload?.actingUserEmail ?? payload?.user?.email ?? undefined;

    const eventLabel = humanizeEvent(eventType);
    const summary =
      payload?.summary ?? `${eventLabel}${recordId ? ` — ${recordId}` : ''}`;

    return {
      eventType,
      eventLabel,
      actingUserEmail,
      recordId: recordId !== undefined ? String(recordId) : undefined,
      summary,
      rawEventType: String(rawEvent),
      metadata: {
        data: payload?.data,
        flowName: payload?.flowName ?? payload?.flow_name,
      },
    };
  }

  // ─── Health Check (no API — webhook-only) ──────────────────

  async testConnection(_accessToken: string): Promise<ConnectionHealthCheck> {
    return { healthy: true, message: 'Power Automate is webhook-only; nothing to test.' };
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'flow.triggered', label: 'Flow Triggered', description: 'A Power Automate flow sent an event (generic)' },
      { eventType: 'item.created', label: 'Item Created', description: 'A SharePoint/Dataverse/list item was created' },
      { eventType: 'item.updated', label: 'Item Updated', description: 'A SharePoint/Dataverse/list item was updated' },
      { eventType: 'approval.completed', label: 'Approval Completed', description: 'A Power Automate approval finished' },
      { eventType: 'form.submitted', label: 'Form Submitted', description: 'A Microsoft Forms response was submitted' },
      { eventType: 'email.received', label: 'Email Received', description: 'An Outlook email arrived' },
      // Power Automate can emit any string — the value of `event` becomes the type.
      { eventType: '*', label: 'Any Event', description: 'Match any event string sent by the flow' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function humanizeEvent(eventType: string): string {
  // "invoice.approved" → "Invoice Approved"
  return eventType
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Flow Triggered';
}

export const powerautomateConnector = new PowerAutomateConnector();

/**
 * Middesk Connector — Baton
 *
 * Webhook-only integration (no OAuth).
 * Middesk sends business verification events; Baton verifies via HMAC-SHA256.
 *
 * Key details:
 *   - Webhook signature header: X-Middesk-Signature
 *   - Algorithm: HMAC-SHA256(secret, rawBody), hex-encoded
 *   - Connection resolution: business.id from webhook payload
 *   - No OAuth — webhooks configured in Middesk dashboard
 *
 * Payload structure:
 *   {
 *     "type": "business.approved" | "business.updated" | "business.in_review" | ...,
 *     "created_at": "...",
 *     "data": { "object": { "id": "<business_id>", ... } }
 *   }
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

// ─── Connector ────────────────────────────────────────────────

export class MiddeskConnector extends BasePlatformConnector {
  readonly platform: Platform = 'middesk';
  readonly displayName = 'Middesk';

  // ─── OAuth (not used — webhook-only) ────────────────────────

  async authorize(): Promise<OAuthAuthorizeResult> {
    throw new Error('Middesk integration is webhook-only — OAuth not supported');
  }

  async handleCallback(): Promise<OAuthTokens> {
    throw new Error('Middesk integration is webhook-only — OAuth not supported');
  }

  async refreshToken(): Promise<OAuthTokens> {
    throw new Error('Middesk integration is webhook-only — OAuth not supported');
  }

  // ─── Webhook Verification (HMAC-SHA256) ────────────────────

  /**
   * Middesk webhook signature verification.
   * https://docs.middesk.com/docs/webhooks
   *
   * Header: X-Middesk-Signature
   * Value:  HMAC-SHA256(secret, rawBody) — hex-encoded
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-middesk-signature'];

    if (!signature) {
      return { valid: false, reason: 'Missing X-Middesk-Signature header' };
    }

    if (!secret) {
      return { valid: false, reason: 'Middesk webhook secret not configured' };
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
      return { valid, reason: valid ? undefined : 'HMAC signature mismatch' };
    } catch {
      return { valid: false, reason: 'Signature comparison failed (length mismatch)' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  /**
   * Middesk webhook payload:
   * {
   *   "type": "business.approved",
   *   "created_at": "2024-01-01T00:00:00Z",
   *   "data": { "object": { "id": "biz_xxx", "name": "Acme Corp", ... } }
   * }
   */
  extractEventInfo(payload: any): ExtractedEventInfo {
    const eventType = payload.type || 'unknown';
    const business = payload.data?.object || {};
    const businessId = business.id || '';
    const businessName = business.name || businessId;

    // "business.approved" → "Business Approved"
    const eventLabel = eventType
      .split('.')
      .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');

    return {
      eventType,
      eventLabel,
      recordId: businessId,
      summary: `${eventLabel}: ${businessName}`,
      rawEventType: eventType,
      metadata: {
        businessId,
        businessName,
        status: business.status,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async checkHealth(): Promise<ConnectionHealthCheck> {
    // Middesk is webhook-only — no token to refresh or API to ping
    return { healthy: true };
  }

  async testConnection(_accessToken: string): Promise<ConnectionHealthCheck> {
    // Middesk is webhook-only — no API to test against
    return { healthy: true };
  }

  getSupportedEventTypes(): Array<{ eventType: string; label: string; description: string }> {
    return [
      { eventType: 'business.approved', label: 'Business Approved', description: 'A business has been approved after verification' },
      { eventType: 'business.updated', label: 'Business Updated', description: 'A business record has been updated' },
      { eventType: 'business.in_review', label: 'Business In Review', description: 'A business is under manual review' },
      { eventType: 'business.rejected', label: 'Business Rejected', description: 'A business has been rejected after verification' },
      { eventType: 'business.document_required', label: 'Document Required', description: 'Additional documents are required for verification' },
    ];
  }
}

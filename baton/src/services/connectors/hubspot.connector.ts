/**
 * HubSpot Connector — Baton
 *
 * Webhook-only integration (no OAuth).
 * HubSpot sends webhook events; Baton verifies via HMAC-SHA256 and normalizes.
 *
 * Key details:
 *   - Webhook signature: HMAC-SHA256 v3 (method + uri + body + timestamp)
 *   - Connection resolution: portalId from webhook payload
 *   - No OAuth — webhooks configured in HubSpot Developer App
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

// ─── Constants ────────────────────────────────────────────────

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes — reject older webhooks (replay protection)

// ─── Connector ────────────────────────────────────────────────

export class HubSpotConnector extends BasePlatformConnector {
  readonly platform: Platform = 'hubspot';
  readonly displayName = 'HubSpot';

  // ─── OAuth (not used — webhook-only) ────────────────────────

  async authorize(): Promise<OAuthAuthorizeResult> {
    throw new Error('HubSpot integration is webhook-only - OAuth not supported');
  }

  async handleCallback(): Promise<OAuthTokens> {
    throw new Error('HubSpot integration is webhook-only - OAuth not supported');
  }

  async refreshToken(): Promise<OAuthTokens> {
    throw new Error('HubSpot integration is webhook-only - OAuth not supported');
  }

  // ─── Webhook Verification ──────────────────────────────────

  /**
   * HubSpot v3 signature verification.
   * https://developers.hubspot.com/docs/api/webhooks/validating-requests
   *
   * Source string = requestMethod + requestUri + requestBody + timestamp
   * (no separators — direct concatenation, utf-8 encoded)
   * HMAC-SHA256 with the app's client secret, then base64.
   *
   * Headers:
   *   X-HubSpot-Signature-v3      — base64-encoded HMAC
   *   X-HubSpot-Request-Timestamp  — ms since epoch
   *
   * The webhook route injects x-baton-request-uri with the full URL
   * (including protocol) so we can reconstruct the source string.
   *
   * URL-encoded characters in the URI must be decoded before hashing:
   *   %3A→: %2F→/ %3F→? %40→@ %21→! %24→$ %27→' %28→( %29→) %2A→* %2C→, %3B→;
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-hubspot-signature-v3'];
    const timestamp = headers['x-hubspot-request-timestamp'];

    if (!signature) {
      return { valid: false, reason: 'Missing X-HubSpot-Signature-v3 header' };
    }

    if (!secret) {
      return { valid: false, reason: 'HubSpot client secret not configured' };
    }

    // Replay protection: reject webhooks older than 5 minutes
    if (timestamp) {
      const age = Date.now() - parseInt(timestamp, 10);
      if (age > MAX_TIMESTAMP_AGE_MS) {
        return { valid: false, reason: 'Webhook timestamp too old (possible replay attack)' };
      }
    }

    // Decode URL-encoded characters in the URI per HubSpot's spec
    const rawUri = headers['x-baton-request-uri'] || '';
    const decodedUri = decodeHubSpotUri(rawUri);

    // HubSpot v3: HMAC-SHA256(clientSecret, "POST" + decodedUri + body + timestamp)
    const sourceString = 'POST' + decodedUri + rawBody.toString('utf8') + (timestamp || '');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(sourceString, 'utf8')
      .digest('base64');

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
   * HubSpot sends batched webhook events as an array:
   * [{ subscriptionType: "contact.creation", changeFlag: "CREATED",
   *    objectId: 123, portalId: 12345678, eventId: 1, ... }]
   *
   * Note: objectType/changeType are NOT present in the payload.
   * Instead, use subscriptionType (e.g. "contact.creation") and changeFlag.
   */
  extractEventInfo(payload: any): ExtractedEventInfo {
    const events = Array.isArray(payload) ? payload : [payload];
    const event = events[0] || {};

    // Simple / partial format — no subscriptionType, capture all present fields
    if (!event.subscriptionType) {
      return {
        eventType: 'unknown.received',
        eventLabel: 'Webhook Received',
        recordId: event.objectId?.toString(),
        summary: 'HubSpot webhook received',
        rawEventType: '',
        metadata: { ...event, batchSize: events.length },
      };
    }

    // Parse subscriptionType (e.g. "contact.creation" → objectType="contact", action="creation")
    const subscriptionType = event.subscriptionType || '';
    const [objectType, action] = subscriptionType.split('.');

    const normalizedAction = normalizeHubSpotChangeType(action || event.changeFlag || '');
    const eventType = `${objectType}.${normalizedAction}`;
    const eventLabel = `${capitalize(objectType)} ${capitalize(normalizedAction)}`;

    return {
      eventType,
      eventLabel,
      recordId: event.objectId?.toString(),
      summary: events.length > 1
        ? `${eventLabel} + ${events.length - 1} more event(s)`
        : eventLabel,
      rawEventType: subscriptionType,
      metadata: {
        portalId: event.portalId,
        objectType,
        changeFlag: event.changeFlag,
        eventId: event.eventId,
        changeSource: event.changeSource,
        batchSize: events.length,
        allEvents: events.length > 1 ? events.map((e: any) => ({
          subscriptionType: e.subscriptionType,
          objectId: e.objectId,
          changeFlag: e.changeFlag,
        })) : undefined,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(): Promise<ConnectionHealthCheck> {
    // Webhook-only — no API connection to test
    return { healthy: true, message: 'Webhook-only integration - no API connection to test' };
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      // Contacts
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      { eventType: 'contact.deleted', label: 'Contact Deleted', description: 'A contact was deleted' },
      // Deals
      { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deal.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'deal.deleted', label: 'Deal Deleted', description: 'A deal was deleted' },
      // Companies
      { eventType: 'company.created', label: 'Company Created', description: 'A new company was created' },
      { eventType: 'company.updated', label: 'Company Updated', description: 'A company was updated' },
      { eventType: 'company.deleted', label: 'Company Deleted', description: 'A company was deleted' },
      // Wildcards
      { eventType: 'contact.*', label: 'All Contact Events', description: 'Any contact-related event' },
      { eventType: 'deal.*', label: 'All Deal Events', description: 'Any deal-related event' },
      { eventType: 'company.*', label: 'All Company Events', description: 'Any company-related event' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Decode URL-encoded characters in the request URI per HubSpot's v3 spec.
 * Only specific characters need decoding — the leading '?' of the query string
 * should NOT be decoded.
 * https://developers.hubspot.com/docs/api/webhooks/validating-requests
 */
function decodeHubSpotUri(uri: string): string {
  return uri
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/%3F/gi, '?')
    .replace(/%40/gi, '@')
    .replace(/%21/gi, '!')
    .replace(/%24/gi, '$')
    .replace(/%27/gi, "'")
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%2A/gi, '*')
    .replace(/%2C/gi, ',')
    .replace(/%3B/gi, ';');
}

function normalizeHubSpotChangeType(changeType: string): string {
  const mapping: Record<string, string> = {
    creation: 'created',
    update: 'updated',
    deletion: 'deleted',
    merge: 'updated',
    propertychange: 'updated',
  };
  return mapping[changeType.toLowerCase()] || changeType.toLowerCase();
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const hubspotConnector = new HubSpotConnector();

/**
 * Pipedrive Connector — Baton
 *
 * Webhook-only integration (no OAuth for demo).
 * Pipedrive sends webhook events; Baton verifies via basic auth / shared secret.
 *
 * Key details:
 *   - Webhook signature: HTTP Basic Auth or custom header verification
 *   - Connection resolution: company_id from webhook payload
 *   - No OAuth in demo — webhooks configured in Pipedrive Settings
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

export class PipedriveConnector extends BasePlatformConnector {
  readonly platform: Platform = 'pipedrive';
  readonly displayName = 'Pipedrive';

  // ─── OAuth (not used — webhook-only for demo) ─────────────

  async authorize(): Promise<OAuthAuthorizeResult> {
    throw new Error('Pipedrive integration is webhook-only — OAuth not supported in demo');
  }

  async handleCallback(): Promise<OAuthTokens> {
    throw new Error('Pipedrive integration is webhook-only — OAuth not supported in demo');
  }

  async refreshToken(): Promise<OAuthTokens> {
    throw new Error('Pipedrive integration is webhook-only — OAuth not supported in demo');
  }

  // ─── Webhook Verification ──────────────────────────────────

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-pipedrive-signature'];

    if (!signature) {
      // Fallback: check basic auth header
      const auth = headers['authorization'] || '';
      if (auth && secret) {
        const expected = `Basic ${Buffer.from(`baton:${secret}`).toString('base64')}`;
        const valid = auth === expected;
        return { valid, reason: valid ? undefined : 'Basic auth mismatch' };
      }
      return { valid: false, reason: 'Missing signature or authorization header' };
    }

    if (!secret) {
      return { valid: false, reason: 'Pipedrive webhook secret not configured' };
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

  extractEventInfo(payload: any): ExtractedEventInfo {
    // Pipedrive webhook payload: { event: "added.deal", current: {...}, previous: {...}, meta: {...} }
    const eventStr = payload.event || '';
    const [action, objectType] = eventStr.split('.');

    const normalizedAction = normalizePipedriveAction(action || '');
    const normalizedObject = (objectType || '').toLowerCase();
    const eventType = `${normalizedObject}.${normalizedAction}`;
    const eventLabel = `${capitalize(normalizedObject)} ${capitalize(normalizedAction)}`;

    return {
      eventType,
      eventLabel,
      recordId: payload.current?.id?.toString() || payload.meta?.id?.toString(),
      summary: eventLabel,
      rawEventType: eventStr,
      metadata: {
        objectType: normalizedObject,
        action: normalizedAction,
        companyId: payload.meta?.company_id,
        userId: payload.meta?.user_id,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(): Promise<ConnectionHealthCheck> {
    return { healthy: true, message: 'Webhook-only integration — no API connection to test' };
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      // Deals
      { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deal.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'deal.deleted', label: 'Deal Deleted', description: 'A deal was deleted' },
      { eventType: 'deal.merged', label: 'Deal Merged', description: 'Deals were merged' },
      // Persons
      { eventType: 'person.created', label: 'Person Created', description: 'A new person was created' },
      { eventType: 'person.updated', label: 'Person Updated', description: 'A person was updated' },
      { eventType: 'person.deleted', label: 'Person Deleted', description: 'A person was deleted' },
      // Organizations
      { eventType: 'organization.created', label: 'Organization Created', description: 'A new organization was created' },
      { eventType: 'organization.updated', label: 'Organization Updated', description: 'An organization was updated' },
      // Activities
      { eventType: 'activity.created', label: 'Activity Created', description: 'A new activity was created' },
      { eventType: 'activity.updated', label: 'Activity Updated', description: 'An activity was updated' },
      // Notes
      { eventType: 'note.created', label: 'Note Created', description: 'A new note was added' },
      // Wildcards
      { eventType: 'deal.*', label: 'All Deal Events', description: 'Any deal-related event' },
      { eventType: 'person.*', label: 'All Person Events', description: 'Any person-related event' },
      { eventType: 'organization.*', label: 'All Organization Events', description: 'Any organization-related event' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function normalizePipedriveAction(action: string): string {
  const mapping: Record<string, string> = {
    added: 'created',
    updated: 'updated',
    deleted: 'deleted',
    merged: 'merged',
  };
  return mapping[action.toLowerCase()] || action.toLowerCase();
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const pipedriveConnector = new PipedriveConnector();

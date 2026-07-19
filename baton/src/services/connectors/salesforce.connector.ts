/**
 * Salesforce Connector — Baton
 *
 * Webhook-only integration (no OAuth for demo).
 * Salesforce sends webhook events; Baton verifies via HMAC-SHA256 and normalizes.
 *
 * Key details:
 *   - Webhook signature: HMAC-SHA256 (X-Salesforce-Signature header)
 *   - Connection resolution: orgId from webhook payload
 *   - No OAuth in demo — webhooks configured in Salesforce Setup
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

export class SalesforceConnector extends BasePlatformConnector {
  readonly platform: Platform = 'salesforce';
  readonly displayName = 'Salesforce';

  // ─── OAuth (not used — webhook-only for demo) ─────────────

  async authorize(): Promise<OAuthAuthorizeResult> {
    throw new Error('Salesforce integration is webhook-only — OAuth not supported in demo');
  }

  async handleCallback(): Promise<OAuthTokens> {
    throw new Error('Salesforce integration is webhook-only — OAuth not supported in demo');
  }

  async refreshToken(): Promise<OAuthTokens> {
    throw new Error('Salesforce integration is webhook-only — OAuth not supported in demo');
  }

  // ─── Webhook Verification ──────────────────────────────────

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-salesforce-signature'];

    if (!signature) {
      return { valid: false, reason: 'Missing X-Salesforce-Signature header' };
    }

    if (!secret) {
      return { valid: false, reason: 'Salesforce webhook secret not configured' };
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
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

  extractEventInfo(payload: any): ExtractedEventInfo {
    const objectType = (payload.sobject?.type || payload.objectType || payload.type || '').toLowerCase();
    const action = (payload.event?.type || payload.action || payload.changeType || '').toLowerCase();
    const normalizedAction = normalizeSalesforceAction(action);

    const eventType = `${objectType}.${normalizedAction}`;
    const eventLabel = `${capitalize(objectType)} ${capitalize(normalizedAction)}`;

    return {
      eventType,
      eventLabel,
      recordId: payload.sobject?.Id || payload.recordId || payload.id,
      summary: eventLabel,
      rawEventType: `${objectType}.${action}`,
      metadata: {
        objectType,
        action,
        orgId: payload.organizationId,
        userId: payload.userId,
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
      // Leads
      { eventType: 'lead.created', label: 'Lead Created', description: 'A new lead was created' },
      { eventType: 'lead.updated', label: 'Lead Updated', description: 'A lead was updated' },
      { eventType: 'lead.converted', label: 'Lead Converted', description: 'A lead was converted' },
      // Opportunities
      { eventType: 'opportunity.created', label: 'Opportunity Created', description: 'A new opportunity was created' },
      { eventType: 'opportunity.updated', label: 'Opportunity Updated', description: 'An opportunity was updated' },
      { eventType: 'opportunity.closed', label: 'Opportunity Closed', description: 'An opportunity was closed' },
      // Contacts
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      // Accounts
      { eventType: 'account.created', label: 'Account Created', description: 'A new account was created' },
      { eventType: 'account.updated', label: 'Account Updated', description: 'An account was updated' },
      // Cases
      { eventType: 'case.created', label: 'Case Created', description: 'A new case was created' },
      { eventType: 'case.updated', label: 'Case Updated', description: 'A case was updated' },
      // Wildcards
      { eventType: 'lead.*', label: 'All Lead Events', description: 'Any lead-related event' },
      { eventType: 'opportunity.*', label: 'All Opportunity Events', description: 'Any opportunity-related event' },
      { eventType: 'contact.*', label: 'All Contact Events', description: 'Any contact-related event' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function normalizeSalesforceAction(action: string): string {
  const mapping: Record<string, string> = {
    created: 'created',
    updated: 'updated',
    deleted: 'deleted',
    undeleted: 'restored',
    insert: 'created',
    update: 'updated',
    delete: 'deleted',
  };
  return mapping[action.toLowerCase()] || action.toLowerCase();
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const salesforceConnector = new SalesforceConnector();

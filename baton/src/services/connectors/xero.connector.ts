/**
 * Xero Connector — Baton
 *
 * Ported from: xero/src/services/xero-oauth.service.ts
 *              xero/src/services/xero-webhook-handler.service.ts
 *
 * Key differences from other connectors:
 *   - OAuth 2.0 with PKCE (code_verifier + code_challenge S256)
 *   - Refresh tokens are single-use (must store new one after each refresh)
 *   - Webhook verification: HMAC-SHA256 with base64 digest
 *   - Multi-tenant: requires xero-tenant-id header for all API calls
 *   - Intent-to-receive validation handled in webhook route, not here
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
import env from '../../env';
import { logInfo, logError, logDebug } from '../../lib/logger';

// ─── Constants ────────────────────────────────────────────────

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const XERO_SCOPES = 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access';
const API_TIMEOUT = 30_000;

// ─── Connector ────────────────────────────────────────────────

export class XeroConnector extends BasePlatformConnector {
  readonly platform: Platform = 'xero';
  readonly displayName = 'Xero';

  private readonly clientId = env.XERO_CLIENT_ID;
  private readonly clientSecret = env.XERO_CLIENT_SECRET;
  private readonly redirectUri =
    env.XERO_REDIRECT_URI || `${env.API_URL}/api/connections/xero/callback`;

  // ─── PKCE Helpers ──────────────────────────────────────────

  /**
   * Generate PKCE code_verifier (43-128 chars, base64url-safe)
   */
  private generateCodeVerifier(): string {
    return crypto
      .randomBytes(64)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 128);
  }

  /**
   * Derive code_challenge from code_verifier using SHA-256
   */
  private generateCodeChallenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  // ─── OAuth (Authorization Code + PKCE) ─────────────────────

  async authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult> {
    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: XERO_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const redirectUrl = `${XERO_AUTH_URL}?${params.toString()}`;

    logInfo('Generated Xero authorization URL with PKCE', { orgId, userId });

    return { redirectUrl, state, codeVerifier };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code, codeVerifier } = params;

    if (!codeVerifier) {
      throw new Error('Xero OAuth requires codeVerifier (PKCE). Missing from callback params.');
    }

    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const response = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Xero token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Xero OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = Math.floor(Date.now() / 1000);

    // Fetch connected tenants to include in raw data
    let tenants: XeroTenant[] = [];
    try {
      tenants = await this.fetchTenants(data.access_token);
    } catch (err: any) {
      logError('Failed to fetch Xero tenants after token exchange', { error: err.message });
    }

    logInfo('Xero token exchange successful', {
      expiresIn: data.expires_in,
      tenantCount: tenants.length,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: { ...data, tenants },
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const basicAuth = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString('base64');

    const response = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Xero token refresh failed', { status: response.status, error: errorText });

      // Xero refresh tokens are single-use — if refresh fails,
      // the token is burned and re-authorization is required
      if (response.status === 400 || response.status === 401) {
        throw new Error('Xero refresh token is invalid or expired. Re-authorization required.');
      }
      throw new Error(`Xero Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    logInfo('Xero token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      // CRITICAL: Xero refresh tokens are single-use — always store the new one
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: data,
    };
  }

  // ─── Tenant Management ─────────────────────────────────────

  /**
   * Fetch connected Xero organisations (tenants)
   * After OAuth, call this to get available tenants.
   * Store the chosen tenantId in connection metadata.
   */
  async fetchTenants(accessToken: string): Promise<XeroTenant[]> {
    const response = await fetch(XERO_CONNECTIONS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Xero tenants: ${response.status}`);
    }

    const tenants: XeroTenant[] = await response.json() as any;
    logDebug('Fetched Xero tenants', { count: tenants.length });
    return tenants;
  }

  // ─── Webhook Verification (HMAC-SHA256) ────────────────────

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const signature = headers['x-xero-signature'];

    if (!signature) {
      return { valid: false, reason: 'Missing x-xero-signature header' };
    }

    if (!secret) {
      return { valid: false, reason: 'Xero webhook key not configured' };
    }

    // Xero uses HMAC-SHA256 with base64 digest
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
      return { valid, reason: valid ? undefined : 'HMAC signature mismatch' };
    } catch {
      return { valid: false, reason: 'Signature comparison failed (length mismatch)' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  extractEventInfo(payload: any): ExtractedEventInfo {
    // Xero webhook payload structure:
    // { events: [{ resourceUrl, resourceId, eventDateUtc, eventType, eventCategory, tenantId }],
    //   firstEventSequence, lastEventSequence, entropy }
    //
    // We process the first event; multiple events are handled by the webhook worker
    // which calls this per-event after splitting the payload.
    const events: XeroWebhookEvent[] = payload.events || [];
    const event = events[0];

    if (!event) {
      return {
        eventType: 'unknown',
        eventLabel: 'Unknown Xero Event',
        summary: 'Empty Xero webhook payload',
      };
    }

    // Normalize: "INVOICE.CREATE" → "invoice.created"
    const category = (event.eventCategory || '').toLowerCase();
    const type = normalizeXeroEventType(event.eventType || '');
    const eventType = `${category}.${type}`;
    const eventLabel = `${capitalize(category)} ${capitalize(type)}`;

    return {
      eventType,
      eventLabel,
      recordId: event.resourceId,
      summary: `${eventLabel} — ${event.resourceId} (tenant: ${event.tenantId})`,
      rawEventType: `${event.eventCategory}.${event.eventType}`,
      metadata: {
        tenantId: event.tenantId,
        resourceUrl: event.resourceUrl,
        eventDateUtc: event.eventDateUtc,
        eventSequence: payload.lastEventSequence,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(accessToken: string, tenantId?: string): Promise<ConnectionHealthCheck> {
    const start = Date.now();

    // tenantId is stored in connection metadata
    // If not provided, we can only check token validity
    if (!tenantId) {
      // Fallback: just check /connections endpoint
      try {
        const response = await fetch(XERO_CONNECTIONS_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(API_TIMEOUT),
        });
        const latencyMs = Date.now() - start;

        if (!response.ok) {
          return { healthy: false, latencyMs, message: `API returned ${response.status}` };
        }

        const tenants: XeroTenant[] = await response.json() as any;
        return {
          healthy: true,
          latencyMs,
          message: `Connected — ${tenants.length} tenant(s)`,
          details: { tenantCount: tenants.length },
        };
      } catch (error: any) {
        return { healthy: false, latencyMs: Date.now() - start, message: error.message };
      }
    }

    try {
      const response = await fetch(`${XERO_API_BASE}/Organisation`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'xero-tenant-id': tenantId,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(API_TIMEOUT),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      const data: any = await response.json();
      const org = data.Organisations?.[0];

      return {
        healthy: true,
        latencyMs,
        message: `Connected as ${org?.Name || 'Unknown Org'}`,
        details: {
          orgName: org?.Name,
          shortCode: org?.ShortCode,
          version: org?.Version,
          organisationType: org?.OrganisationType,
        },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      // Invoices
      { eventType: 'invoice.created', label: 'Invoice Created', description: 'A new invoice was created' },
      { eventType: 'invoice.updated', label: 'Invoice Updated', description: 'An invoice was updated' },
      // Contacts
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contact.updated', label: 'Contact Updated', description: 'A contact was updated' },
      // Subscriptions (webhook-specific)
      { eventType: 'subscription.created', label: 'Subscription Created', description: 'A new subscription was created' },
      { eventType: 'subscription.updated', label: 'Subscription Updated', description: 'A subscription was updated' },
      // Wildcards for advanced rules
      { eventType: 'invoice.*', label: 'All Invoice Events', description: 'Any invoice-related event' },
      { eventType: 'contact.*', label: 'All Contact Events', description: 'Any contact-related event' },
    ];
  }
}

// ─── Xero-specific Types ──────────────────────────────────────

export interface XeroTenant {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

interface XeroWebhookEvent {
  resourceUrl: string;
  resourceId: string;
  eventDateUtc: string;
  eventType: string;       // "CREATE", "UPDATE"
  eventCategory: string;   // "INVOICE", "CONTACT"
  tenantId: string;
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Normalize Xero event types: "CREATE" → "created", "UPDATE" → "updated"
 */
function normalizeXeroEventType(type: string): string {
  const mapping: Record<string, string> = {
    CREATE: 'created',
    UPDATE: 'updated',
    DELETE: 'deleted',
  };
  return mapping[type.toUpperCase()] || type.toLowerCase();
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

// ─── Singleton ────────────────────────────────────────────────

export const xeroConnector = new XeroConnector();

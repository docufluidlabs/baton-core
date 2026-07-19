/**
 * Zoho CRM Connector — Baton
 *
 * Zoho CRM OAuth 2.0 Authorization Code flow.
 *
 * Key details:
 *   - Auth URL: {ZOHO_ACCOUNTS_BASE}/oauth/v2/auth
 *   - Token URL: {ZOHO_ACCOUNTS_BASE}/oauth/v2/token
 *   - Regional: .zoho.com (US), .zoho.eu (EU), .zoho.in (India), .zoho.com.au (AU)
 *     — set ZOHO_ACCOUNTS_BASE to the matching accounts server (default US)
 *   - Webhooks: Zoho uses notification URLs with custom verification tokens
 *     (no HMAC signature — verification via shared secret in URL params)
 *   - Refresh tokens do not expire but can be revoked
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

const ZOHO_AUTH_URL = `${env.ZOHO_ACCOUNTS_BASE}/oauth/v2/auth`;
const ZOHO_TOKEN_URL = `${env.ZOHO_ACCOUNTS_BASE}/oauth/v2/token`;
const ZOHO_API_BASE = 'https://www.zohoapis.com/crm/v6';
const ZOHO_SCOPES = 'ZohoCRM.modules.ALL ZohoCRM.settings.ALL ZohoCRM.notifications.ALL ZohoCRM.users.READ';
const API_TIMEOUT = 30_000;

// ─── Connector ────────────────────────────────────────────────

export class ZohoCRMConnector extends BasePlatformConnector {
  readonly platform: Platform = 'zohocrm';
  readonly displayName = 'Zoho CRM';

  private readonly clientId = env.ZOHO_CLIENT_ID;
  private readonly clientSecret = env.ZOHO_CLIENT_SECRET;
  private readonly redirectUri =
    env.ZOHO_REDIRECT_URI || `${env.API_URL}/api/connections/zohocrm/callback`;

  // ─── OAuth ─────────────────────────────────────────────────

  async authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult> {
    const state = crypto.randomBytes(32).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: ZOHO_SCOPES,
      state,
      access_type: 'offline',   // Required for refresh_token
      prompt: 'consent',        // Force consent screen to get refresh_token
    });

    const redirectUrl = `${ZOHO_AUTH_URL}?${params.toString()}`;
    logInfo('Generated Zoho CRM authorization URL', { orgId, userId });

    return { redirectUrl, state };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code } = params;

    const response = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        code,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Zoho CRM token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Zoho CRM OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      logError('Zoho CRM OAuth error response', { error: data.error });
      throw new Error(`Zoho CRM OAuth Error: ${data.error}`);
    }

    const createdAt = Math.floor(Date.now() / 1000);

    // Fetch current user info
    let userInfo: any = null;
    try {
      userInfo = await this.fetchCurrentUser(data.access_token);
    } catch (err: any) {
      logError('Failed to fetch Zoho user after token exchange', { error: err.message });
    }

    logInfo('Zoho CRM token exchange successful', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in || 3600,
      createdAt,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: { ...data, userInfo, api_domain: data.api_domain },
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(ZOHO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Zoho CRM token refresh failed', { status: response.status, error: errorText });
      throw new Error(`Zoho CRM Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      throw new Error(`Zoho CRM Refresh Error: ${data.error}`);
    }

    logInfo('Zoho CRM token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      // Zoho does NOT return a new refresh_token on refresh — keep the original
      refreshToken,
      expiresIn: data.expires_in || 3600,
      createdAt: Math.floor(Date.now() / 1000),
      tokenType: data.token_type || 'Bearer',
      raw: data,
    };
  }

  // ─── User Info ─────────────────────────────────────────────

  private async fetchCurrentUser(accessToken: string): Promise<any> {
    const response = await fetch(`${ZOHO_API_BASE}/users?type=CurrentUser`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT),
    });
    if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
    const data: any = await response.json();
    return data.users?.[0] || null;
  }

  // ─── Webhook Verification ──────────────────────────────────

  /**
   * Zoho CRM webhook verification via per-connection notification token.
   *
   * When registering a Zoho webhook subscription, include a custom
   * notification token in the config and have Zoho pass it back as the
   * X-Zoho-Token header on every delivery.
   *
   * `secret` here is the per-connection webhookSecret stored in DynamoDB.
   * The comparison uses timingSafeEqual to prevent timing-based attacks.
   */
  verifyWebhookSignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    if (!secret) {
      // No per-connection token configured — reject rather than silently accept
      return { valid: false, reason: 'Zoho webhook secret not configured for this connection' };
    }

    const providedToken = headers['x-zoho-token'] || headers['x-zoho-webhook-token'] || '';

    if (!providedToken) {
      return { valid: false, reason: 'Missing X-Zoho-Token header' };
    }

    try {
      const expected = Buffer.from(secret);
      const provided = Buffer.from(providedToken);

      if (expected.length !== provided.length) {
        return { valid: false, reason: 'Zoho token length mismatch' };
      }

      const valid = crypto.timingSafeEqual(expected, provided);
      return { valid, reason: valid ? undefined : 'Zoho token mismatch' };
    } catch {
      return { valid: false, reason: 'Zoho token comparison failed' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  extractEventInfo(payload: any): ExtractedEventInfo {
    // Zoho CRM notification payload varies by module.
    // Common structure:
    // { module: "Deals", operation: "insert", ids: ["12345"], token: "..." }
    // or for v2 notifications:
    // { query_params: { module, operation, ... }, body: { ids: [...] } }
    const module = (payload.module || payload.query_params?.module || '').toLowerCase();
    const operation = (payload.operation || payload.query_params?.operation || '').toLowerCase();
    const ids: string[] = payload.ids || payload.body?.ids || [];

    const eventType = `${module}.${normalizeZohoOperation(operation)}`;
    const eventLabel = `${capitalize(module)} ${capitalize(normalizeZohoOperation(operation))}`;

    return {
      eventType,
      eventLabel,
      recordId: ids[0],
      summary: `${eventLabel} - ${ids.length} record(s)`,
      rawEventType: `${module}.${operation}`,
      metadata: {
        module,
        operation,
        recordIds: ids,
        token: payload.token,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(accessToken: string): Promise<ConnectionHealthCheck> {
    const start = Date.now();
    try {
      const response = await fetch(`${ZOHO_API_BASE}/users?type=CurrentUser`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(API_TIMEOUT),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      const data: any = await response.json();
      const user = data.users?.[0];

      return {
        healthy: true,
        latencyMs,
        message: `Connected as ${user?.full_name || 'Unknown'}`,
        details: {
          fullName: user?.full_name,
          email: user?.email,
          role: user?.role?.name,
          profile: user?.profile?.name,
        },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      // Deals
      { eventType: 'deals.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'deals.updated', label: 'Deal Updated', description: 'A deal was updated' },
      { eventType: 'deals.deleted', label: 'Deal Deleted', description: 'A deal was deleted' },
      // Contacts
      { eventType: 'contacts.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'contacts.updated', label: 'Contact Updated', description: 'A contact was updated' },
      // Leads
      { eventType: 'leads.created', label: 'Lead Created', description: 'A new lead was created' },
      { eventType: 'leads.updated', label: 'Lead Updated', description: 'A lead was updated' },
      { eventType: 'leads.converted', label: 'Lead Converted', description: 'A lead was converted to a contact/deal' },
      // Accounts
      { eventType: 'accounts.created', label: 'Account Created', description: 'A new account was created' },
      { eventType: 'accounts.updated', label: 'Account Updated', description: 'An account was updated' },
      // Vendors
      { eventType: 'vendors.created', label: 'Vendor Created', description: 'A new vendor was created' },
      { eventType: 'vendors.updated', label: 'Vendor Updated', description: 'A vendor was updated' },
      // Wildcards
      { eventType: 'deals.*', label: 'All Deal Events', description: 'Any deal-related event' },
      { eventType: 'contacts.*', label: 'All Contact Events', description: 'Any contact-related event' },
      { eventType: 'leads.*', label: 'All Lead Events', description: 'Any lead-related event' },
    ];
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function normalizeZohoOperation(operation: string): string {
  const mapping: Record<string, string> = {
    insert: 'created',
    update: 'updated',
    delete: 'deleted',
    convert: 'converted',
  };
  return mapping[operation.toLowerCase()] || operation.toLowerCase();
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const zohocrmConnector = new ZohoCRMConnector();

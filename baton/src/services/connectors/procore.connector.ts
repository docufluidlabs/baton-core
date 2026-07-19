/**
 * Procore Connector — Baton
 * 
 * Ported from: procore/src/services/procore-oauth.service.ts
 * 
 * Changes from original:
 *   - Uses PlatformConnector interface
 *   - Multi-tenant (orgId-aware)
 *   - Webhook signature verification added (static header approach)
 *   - Event extraction for rule engine
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

export class ProcoreConnector extends BasePlatformConnector {
  readonly platform: Platform = 'procore';
  readonly displayName = 'Procore';

  private readonly clientId = env.PROCORE_CLIENT_ID;
  private readonly clientSecret = env.PROCORE_CLIENT_SECRET;
  private readonly redirectUri = env.PROCORE_REDIRECT_URI;
  private readonly authUrl = env.PROCORE_AUTH_URL;

  // ─── OAuth ───────────────────────────────────────────────

  async authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult> {
    const state = crypto.randomBytes(32).toString('hex');

    const authUrl = new URL(`${this.authUrl}/oauth/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', this.redirectUri);
    authUrl.searchParams.set('state', state);

    logInfo('Generated Procore authorization URL', { orgId, userId });

    return {
      redirectUrl: authUrl.toString(),
      state,
    };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code } = params;

    if (!code) throw new Error('Authorization code is required');

    const tokenUrl = `${this.authUrl}/oauth/token`;

    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: requestBody.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Procore token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Procore OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = data.created_at || Math.floor(Date.now() / 1000);

    logInfo('Procore token exchange successful', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type,
      raw: data,
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    if (!refreshToken) throw new Error('Refresh token is required');

    const tokenUrl = `${this.authUrl}/oauth/token`;

    const requestBody = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: requestBody.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Procore token refresh failed', { status: response.status, error: errorText });
      throw new Error(`Procore Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = data.created_at || Math.floor(Date.now() / 1000);

    logInfo('Procore token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type,
      raw: data,
    };
  }

  // ─── Webhook ─────────────────────────────────────────────

  /**
   * Procore uses a static webhook secret header for verification.
   * Less secure than HMAC but it's what Procore provides.
   */
  verifyWebhookSignature(
    _rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    // Procore doesn't use HMAC; it sends a configurable static token
    // Check the header matches the configured secret
    const receivedSecret = headers['x-procore-webhook-secret'] || headers['X-Procore-Webhook-Secret'];

    if (!receivedSecret) {
      return { valid: false, reason: 'Missing X-Procore-Webhook-Secret header' };
    }

    const valid = crypto.timingSafeEqual(
      Buffer.from(receivedSecret),
      Buffer.from(secret),
    );

    return { valid, reason: valid ? undefined : 'Secret mismatch' };
  }

  extractEventInfo(payload: any): ExtractedEventInfo {
    // Procore webhook payload v3+:
    // { resource_name, event_type, resource_id, project_id, company_id, user_id, ... }
    const resourceName = payload.resource_name || 'unknown';
    const eventAction = payload.event_type || 'unknown';
    const eventType = `${resourceName}.${eventAction}`;

    return {
      eventType,
      eventLabel: `${capitalize(resourceName)} ${capitalize(eventAction)}`,
      actingUserId: payload.user_id?.toString(),
      recordId: payload.resource_id?.toString(),
      summary: `${capitalize(resourceName)} ${eventAction} in project ${payload.project_id || 'N/A'}`,
      rawEventType: eventType,
      metadata: {
        projectId: payload.project_id,
        companyId: payload.company_id,
        resourceName,
        apiVersion: payload.api_version,
      },
    };
  }

  // ─── Health Check ────────────────────────────────────────

  async testConnection(accessToken: string): Promise<ConnectionHealthCheck> {
    const start = Date.now();
    try {
      const response = await fetch('https://api.procore.com/rest/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      const data: any = await response.json();
      return {
        healthy: true,
        latencyMs,
        message: `Connected as ${data.login}`,
        details: { login: data.login, id: data.id },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'commitments.purchase_order_contracts.create', label: 'Purchase Order Created', description: 'A new purchase order contract was created' },
      { eventType: 'commitments.purchase_order_contracts.update', label: 'Purchase Order Updated', description: 'A purchase order contract was modified' },
      { eventType: 'commitments.work_order_contracts.create', label: 'Subcontract Created', description: 'A new subcontract was created' },
      { eventType: 'commitments.work_order_contracts.update', label: 'Subcontract Updated', description: 'A subcontract was modified' },
      { eventType: 'cost_codes.create', label: 'Cost Code Created', description: 'A new cost code was added' },
      { eventType: 'projects.create', label: 'Project Created', description: 'A new project was created' },
      { eventType: 'projects.update', label: 'Project Updated', description: 'A project was modified' },
      { eventType: 'vendors.create', label: 'Vendor Created', description: 'A new vendor was added' },
      { eventType: 'vendors.update', label: 'Vendor Updated', description: 'A vendor was modified' },
      { eventType: 'submittals.create', label: 'Submittal Created', description: 'A new submittal was created' },
      { eventType: 'rfis.create', label: 'RFI Created', description: 'A new RFI was created' },
    ];
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const procoreConnector = new ProcoreConnector();

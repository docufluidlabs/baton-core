/**
 * Smartsheet Connector — Baton
 *
 * Ported from: smartsheet-extension-app/src/services/smartsheet-oauth.service.ts
 *
 * Key differences from other connectors:
 *   - No PKCE, no Basic Auth — uses SHA-256 hash of clientSecret|code
 *   - Token endpoint: https://api.smartsheet.com/2.0/token
 *   - Auth endpoint: https://app.smartsheet.com/b/authorize
 *   - Webhook verification: challenge-response pattern (HMAC-SHA256)
 *     plus standard HMAC-SHA256 for normal webhooks
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

const SMARTSHEET_AUTH_URL = 'https://app.smartsheet.com/b/authorize';
const SMARTSHEET_TOKEN_URL = 'https://api.smartsheet.com/2.0/token';
const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';
const SMARTSHEET_SCOPES = 'READ_SHEETS WRITE_SHEETS READ_USERS';
const API_TIMEOUT = 30_000;

// ─── Connector ────────────────────────────────────────────────

export class SmartsheetConnector extends BasePlatformConnector {
  readonly platform: Platform = 'smartsheet';
  readonly displayName = 'Smartsheet';

  private readonly clientId = env.SMARTSHEET_CLIENT_ID;
  private readonly clientSecret = env.SMARTSHEET_CLIENT_SECRET;
  private readonly redirectUri =
    env.SMARTSHEET_REDIRECT_URI || `${env.API_URL}/api/connections/smartsheet/callback`;

  // ─── Smartsheet-specific hash ──────────────────────────────

  /**
   * Smartsheet requires SHA-256 hash of `clientSecret|code` or `clientSecret|refreshToken`
   * for token exchange and refresh. This is unique to Smartsheet's API.
   * See: https://smartsheet.redoc.ly/tag/oAuth2
   */
  private generateHash(codeOrToken: string): string {
    return crypto
      .createHash('sha256')
      .update(`${this.clientSecret}|${codeOrToken}`)
      .digest('hex');
  }

  // ─── OAuth ─────────────────────────────────────────────────

  async authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult> {
    const state = crypto.randomBytes(32).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: SMARTSHEET_SCOPES,
      state,
    });

    const redirectUrl = `${SMARTSHEET_AUTH_URL}?${params.toString()}`;
    logInfo('Generated Smartsheet authorization URL', { orgId, userId });

    return { redirectUrl, state };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code } = params;
    const hash = this.generateHash(code);

    const response = await fetch(SMARTSHEET_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        code,
        hash,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Smartsheet token exchange failed', { status: response.status, error: errorText });
      throw new Error(`Smartsheet OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = Math.floor(Date.now() / 1000);

    // Fetch current user info
    let userInfo: any = null;
    try {
      userInfo = await this.fetchCurrentUser(data.access_token);
    } catch (err: any) {
      logError('Failed to fetch Smartsheet user after token exchange', { error: err.message });
    }

    logInfo('Smartsheet token exchange successful', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: { ...data, userInfo },
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const hash = this.generateHash(refreshToken);

    const response = await fetch(SMARTSHEET_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        refresh_token: refreshToken,
        hash,
      }).toString(),
      signal: AbortSignal.timeout(API_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Smartsheet token refresh failed', { status: response.status, error: errorText });
      throw new Error(`Smartsheet Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    logInfo('Smartsheet token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: data,
    };
  }

  // ─── User Info ─────────────────────────────────────────────

  private async fetchCurrentUser(accessToken: string): Promise<any> {
    const response = await fetch(`${SMARTSHEET_API_BASE}/users/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT),
    });
    if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
    return response.json() as Promise<any>;
  }

  // ─── Webhook Verification (HMAC-SHA256) ────────────────────

  /**
   * Smartsheet webhook verification:
   *   - Challenge: payload has `challenge` field → respond with HMAC
   *     (handled in webhook route, not here)
   *   - Normal: HMAC-SHA256 of body in `Smartsheet-Hmac-SHA256` header
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    // Smartsheet uses Smartsheet-Hmac-SHA256 header (case-insensitive)
    const signature =
      headers['smartsheet-hmac-sha256'] ||
      headers['Smartsheet-Hmac-SHA256'] ||
      headers['smartsheet-hmac-sha-256'];

    if (!signature) {
      return { valid: false, reason: 'Missing Smartsheet-Hmac-SHA256 header' };
    }

    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedHmac),
      );
      return { valid, reason: valid ? undefined : 'HMAC signature mismatch' };
    } catch {
      return { valid: false, reason: 'Signature comparison failed (length mismatch)' };
    }
  }

  // ─── Event Extraction ──────────────────────────────────────

  extractEventInfo(payload: any): ExtractedEventInfo {
    // Smartsheet webhook payload:
    // { webhookId, scope, scopeObjectId, events: [{ objectType, eventType, id, ... }] }
    const events = payload.events || [];
    const event = events[0];

    if (!event) {
      return {
        eventType: 'unknown',
        eventLabel: 'Unknown Smartsheet Event',
        summary: 'Empty Smartsheet webhook payload',
      };
    }

    // Normalize: objectType=sheet, eventType=updated → "sheet.updated"
    const objectType = (event.objectType || '').toLowerCase();
    const eventAction = (event.eventType || '').toLowerCase();
    const eventType = `${objectType}.${eventAction}`;
    const eventLabel = `${capitalize(objectType)} ${capitalize(eventAction)}`;

    return {
      eventType,
      eventLabel,
      actingUserId: event.userId?.toString(),
      recordId: event.id?.toString(),
      summary: `${eventLabel} — ${objectType} ${event.id} (webhook: ${payload.webhookId})`,
      rawEventType: `${event.objectType}.${event.eventType}`,
      metadata: {
        webhookId: payload.webhookId,
        scope: payload.scope,
        scopeObjectId: payload.scopeObjectId,
        rowId: event.rowId,
        columnId: event.columnId,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(accessToken: string): Promise<ConnectionHealthCheck> {
    const start = Date.now();
    try {
      const response = await fetch(`${SMARTSHEET_API_BASE}/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(API_TIMEOUT),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      const data: any = await response.json();
      return {
        healthy: true,
        latencyMs,
        message: `Connected as ${data.firstName} ${data.lastName}`,
        details: { email: data.email, firstName: data.firstName, lastName: data.lastName, id: data.id },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'sheet.updated', label: 'Sheet Updated', description: 'A sheet was updated (rows, cells, columns)' },
      { eventType: 'sheet.created', label: 'Sheet Created', description: 'A new sheet was created' },
      { eventType: 'row.created', label: 'Row Created', description: 'A new row was added to a sheet' },
      { eventType: 'row.updated', label: 'Row Updated', description: 'A row was updated in a sheet' },
      { eventType: 'row.deleted', label: 'Row Deleted', description: 'A row was deleted from a sheet' },
      { eventType: 'column.created', label: 'Column Created', description: 'A column was added to a sheet' },
      { eventType: 'column.updated', label: 'Column Updated', description: 'A column was modified' },
      { eventType: 'comment.created', label: 'Comment Created', description: 'A comment was added' },
      { eventType: 'attachment.created', label: 'Attachment Created', description: 'An attachment was added' },
      { eventType: 'sheet.*', label: 'All Sheet Events', description: 'Any sheet-related event' },
      { eventType: 'row.*', label: 'All Row Events', description: 'Any row-related event' },
    ];
  }
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const smartsheetConnector = new SmartsheetConnector();

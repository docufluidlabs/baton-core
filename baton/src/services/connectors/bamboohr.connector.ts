/**
 * BambooHR Connector — Baton
 *
 * Ported from: bamboohr/dist/services/bamboohr-oauth.service.js
 *              bamboohr/dist/services/bamboohr-webhook-handler.service.js
 *
 * Key differences from other connectors:
 *   - Domain-specific OAuth URLs: https://{companyDomain}.bamboohr.com/authorize.php
 *   - Token URL: https://{companyDomain}.bamboohr.com/token.php?request=token
 *   - Webhook verification: HMAC-SHA256 of (rawBody + timestamp)
 *     using x-bamboohr-timestamp and x-bamboohr-signature headers
 *   - Requires companyDomain stored in connection metadata
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

const BAMBOOHR_SCOPES = 'openid offline_access';
const BAMBOOHR_API_VERSION = 'v1';
const API_TIMEOUT = 30_000;

// Default domain — overridden per-connection via metadata.companyDomain
const DEFAULT_COMPANY_DOMAIN = 'app';

// ─── Connector ────────────────────────────────────────────────

export class BambooHRConnector extends BasePlatformConnector {
  readonly platform: Platform = 'bamboohr';
  readonly displayName = 'BambooHR';

  private readonly clientId = env.BAMBOOHR_CLIENT_ID;
  private readonly clientSecret = env.BAMBOOHR_CLIENT_SECRET;
  private readonly redirectUri =
    env.BAMBOOHR_REDIRECT_URI || `${env.API_URL}/api/connections/bamboohr/callback`;

  // ─── OAuth (Domain-specific) ───────────────────────────────

  /**
   * BambooHR requires the company subdomain for OAuth URLs.
   * The companyDomain should be passed via connection metadata or
   * collected from the user before initiating OAuth.
   *
   * For now, we encode it in the state parameter as JSON.
   */
  async authorize(orgId: string, userId: string, companyDomain?: string): Promise<OAuthAuthorizeResult> {
    const domain = companyDomain || DEFAULT_COMPANY_DOMAIN;
    const statePayload = { nonce: crypto.randomBytes(16).toString('hex'), domain };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    const params = new URLSearchParams({
      request: 'authorize',
      state,
      response_type: 'code',
      scope: BAMBOOHR_SCOPES,
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
    });

    const redirectUrl = `https://${domain}.bamboohr.com/authorize.php?${params.toString()}`;
    logInfo('Generated BambooHR authorization URL', { orgId, userId, domain });

    return { redirectUrl, state };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code, state } = params;

    // Extract companyDomain from state
    let companyDomain = DEFAULT_COMPANY_DOMAIN;
    try {
      const statePayload = JSON.parse(Buffer.from(state, 'base64url').toString());
      companyDomain = statePayload.domain || DEFAULT_COMPANY_DOMAIN;
    } catch {
      logDebug('Could not parse BambooHR state, using default domain');
    }

    const response = await fetch(
      `https://${companyDomain}.bamboohr.com/token.php?request=token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(API_TIMEOUT),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logError('BambooHR token exchange failed', { status: response.status, error: errorText });
      throw new Error(`BambooHR OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = Math.floor(Date.now() / 1000);

    logInfo('BambooHR token exchange successful', { expiresIn: data.expires_in, companyDomain });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
      raw: { ...data, companyDomain },
    };
  }

  async refreshToken(refreshToken: string, companyDomain?: string): Promise<OAuthTokens> {
    const domain = companyDomain || DEFAULT_COMPANY_DOMAIN;

    const response = await fetch(
      `https://${domain}.bamboohr.com/token.php?request=token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(API_TIMEOUT),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logError('BambooHR token refresh failed', { status: response.status, error: errorText });
      throw new Error(`BambooHR Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    logInfo('BambooHR token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
      tokenType: data.token_type || 'Bearer',
      raw: { ...data, companyDomain: domain },
    };
  }

  // ─── Webhook Verification ──────────────────────────────────

  /**
   * BambooHR uses HMAC-SHA256 of (rawBody + timestamp)
   * Headers: x-bamboohr-timestamp, x-bamboohr-signature
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    const timestamp = headers['x-bamboohr-timestamp'];
    const signature = headers['x-bamboohr-signature'];

    if (!timestamp || !signature) {
      return { valid: false, reason: 'Missing x-bamboohr-timestamp or x-bamboohr-signature headers' };
    }

    if (!secret) {
      return { valid: false, reason: 'BambooHR webhook key not configured' };
    }

    // BambooHR: HMAC-SHA256 of rawBody + timestamp
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody.toString('utf8') + timestamp)
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
    // BambooHR webhook payload (current format):
    // { type: "employee.updated", data: { changedFields, companyId, employeeId }, timestamp }
    //
    // Legacy format (fallback):
    // { employees: [{ id, changedFields }] }
    if (payload.type && payload.data) {
      const { type, data } = payload;
      const changedFields: string[] = data.changedFields || [];
      const employeeId = data.employeeId?.toString();

      const eventLabelMap: Record<string, string> = {
        'employee.updated': 'Employee Updated',
        'employee.created': 'Employee Created',
        'employee.deleted': 'Employee Deleted',
      };
      const eventLabel = eventLabelMap[type] || type;

      return {
        eventType: type,
        eventLabel,
        recordId: employeeId,
        summary: changedFields.length > 0
          ? `Employee ${employeeId} updated: ${changedFields.slice(0, 3).join(', ')}${changedFields.length > 3 ? '...' : ''}`
          : `${eventLabel} (ID: ${employeeId})`,
        rawEventType: type,
        metadata: {
          employeeId,
          changedFields,
          companyId: data.companyId,
        },
      };
    }

    // Legacy format
    const employees = payload.employees || [];
    const employee = employees[0];

    if (!employee) {
      return {
        eventType: 'unknown',
        eventLabel: 'Unknown BambooHR Event',
        summary: 'Empty BambooHR webhook payload',
      };
    }

    const changedFields: string[] = employee.changedFields || [];
    const isNewEmployee = changedFields.length === 0;
    const eventType = isNewEmployee ? 'employee.created' : 'employee.changed';

    return {
      eventType,
      eventLabel: isNewEmployee ? 'Employee Created' : 'Employee Changed',
      recordId: employee.id?.toString(),
      summary: isNewEmployee
        ? `New employee created (ID: ${employee.id})`
        : `Employee ${employee.id} changed: ${changedFields.slice(0, 3).join(', ')}${changedFields.length > 3 ? '...' : ''}`,
      rawEventType: eventType,
      metadata: {
        employeeId: employee.id,
        changedFields,
        employeeCount: employees.length,
      },
    };
  }

  // ─── Health Check ──────────────────────────────────────────

  async testConnection(accessToken: string, companyDomain?: string): Promise<ConnectionHealthCheck> {
    const domain = companyDomain || DEFAULT_COMPANY_DOMAIN;
    const start = Date.now();

    try {
      // BambooHR API: GET /api/gateway.php/{companyDomain}/v1/employees/directory
      const response = await fetch(
        `https://api.bamboohr.com/api/gateway.php/${domain}/${BAMBOOHR_API_VERSION}/meta/fields/`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(API_TIMEOUT),
        },
      );

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      return {
        healthy: true,
        latencyMs,
        message: `Connected to ${domain}.bamboohr.com`,
        details: { companyDomain: domain },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ──────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'employee.created', label: 'Employee Created', description: 'A new employee was added to BambooHR' },
      { eventType: 'employee.updated', label: 'Employee Updated', description: 'Employee data was updated (fields changed)' },
      { eventType: 'employee.deleted', label: 'Employee Deleted', description: 'An employee was removed from BambooHR' },
      { eventType: 'employee.*', label: 'All Employee Events', description: 'Any employee-related event' },
    ];
  }
}

export const bamboohrConnector = new BambooHRConnector();

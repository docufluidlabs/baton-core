/**
 * DocuSign Connector — Baton
 * 
 * DocuSign OAuth + Maestro workflow launching.
 * Uses Authorization Code flow (not JWT Grant — that's for service accounts)
 * 
 * DocuSign is special in Baton: it's both a platform connection AND the Maestro host.
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

export class DocuSignConnector extends BasePlatformConnector {
  readonly platform: Platform = 'docusign';
  readonly displayName = 'Docusign';

  private readonly integrationKey = env.DOCUSIGN_INTEGRATION_KEY;
  private readonly secretKey = env.DOCUSIGN_SECRET_KEY;
  private readonly oauthBase = env.DOCUSIGN_OAUTH_BASE;

  // ─── OAuth (Authorization Code flow) ─────────────────────

  async authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult> {
    const state = crypto.randomBytes(32).toString('hex');
    const scopes = 'signature extended aow_manage';

    const authUrl = new URL(`${this.oauthBase}/oauth/auth`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('client_id', this.integrationKey);
    authUrl.searchParams.set('redirect_uri', `${env.API_URL}/api/connections/docusign/callback`);
    authUrl.searchParams.set('state', state);

    logInfo('Generated DocuSign authorization URL', { orgId, userId });

    return { redirectUrl: authUrl.toString(), state };
  }

  async handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens> {
    const { code } = params;

    const tokenUrl = `${this.oauthBase}/oauth/token`;
    const basicAuth = Buffer.from(`${this.integrationKey}:${this.secretKey}`).toString('base64');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.API_URL}/api/connections/docusign/callback`,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('DocuSign token exchange failed', { status: response.status, error: errorText });
      throw new Error(`DocuSign OAuth Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const createdAt = Math.floor(Date.now() / 1000);

    // Fetch userinfo to get account_id
    const userInfoResponse = await fetch(`${this.oauthBase}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const userInfo: any = userInfoResponse.ok ? await userInfoResponse.json() : null;

    logInfo('DocuSign token exchange successful', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt,
      tokenType: data.token_type,
      scope: data.scope,
      raw: { ...data, userInfo },
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const tokenUrl = `${this.oauthBase}/oauth/token`;
    const basicAuth = Buffer.from(`${this.integrationKey}:${this.secretKey}`).toString('base64');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('DocuSign token refresh failed', { status: response.status, error: errorText });
      throw new Error(`DocuSign Refresh Error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    logInfo('DocuSign token refreshed', { expiresIn: data.expires_in });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      createdAt: Math.floor(Date.now() / 1000),
      tokenType: data.token_type,
      raw: data,
    };
  }

  // ─── Webhook (DocuSign Connect HMAC-SHA256) ──────────────

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult {
    // DocuSign Connect uses x-docusign-signature-1 (and optionally -2, -3)
    const signatures = [
      headers['x-docusign-signature-1'],
      headers['x-docusign-signature-2'],
      headers['x-docusign-signature-3'],
    ].filter(Boolean);

    if (signatures.length === 0) {
      return { valid: false, reason: 'Missing x-docusign-signature headers' };
    }

    const computedHmac = crypto
      .createHmac('sha256', Buffer.from(secret, 'utf8'))
      .update(rawBody)
      .digest('base64');

    const valid = signatures.some((sig) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(sig!), Buffer.from(computedHmac));
      } catch {
        return false;
      }
    });

    return { valid, reason: valid ? undefined : 'HMAC signature mismatch' };
  }

  extractEventInfo(payload: any): ExtractedEventInfo {
    // DocuSign Connect payload structure
    const event = payload.event || '';
    const envelopeId = payload.data?.envelopeId || payload.envelopeId || '';
    const envelopeSummary = payload.data?.envelopeSummary;

    // DocuSign Connect events are already prefixed: "envelope-sent", "recipient-completed"
    // Normalize to dot notation: "envelope.sent", "recipient.completed"
    const eventType = event.replace('-', '.');

    return {
      eventType,
      eventLabel: capitalize(event.replace('-', ' ')),
      actingUserEmail: envelopeSummary?.sender?.email,
      recordId: envelopeId,
      summary: `Envelope ${envelopeId} — ${event}`,
      rawEventType: event,
      metadata: {
        envelopeId,
        status: envelopeSummary?.status,
        subject: envelopeSummary?.emailSubject,
      },
    };
  }

  // ─── Health Check ────────────────────────────────────────

  async testConnection(accessToken: string): Promise<ConnectionHealthCheck> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.oauthBase}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return { healthy: false, latencyMs, message: `API returned ${response.status}` };
      }

      const data: any = await response.json();
      return {
        healthy: true,
        latencyMs,
        message: `Connected as ${data.name}`,
        details: { name: data.name, email: data.email, sub: data.sub },
      };
    } catch (error: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: error.message };
    }
  }

  // ─── Supported Events ────────────────────────────────────

  getSupportedEventTypes() {
    return [
      { eventType: 'envelope.sent', label: 'Envelope Sent', description: 'An envelope was sent for signing' },
      { eventType: 'envelope.delivered', label: 'Envelope Delivered', description: 'An envelope was delivered to a recipient' },
      { eventType: 'envelope.completed', label: 'Envelope Completed', description: 'All recipients have signed the envelope' },
      { eventType: 'envelope.declined', label: 'Envelope Declined', description: 'A recipient declined to sign' },
      { eventType: 'envelope.voided', label: 'Envelope Voided', description: 'An envelope was voided' },
      { eventType: 'recipient.sent', label: 'Recipient Sent', description: 'An envelope was sent to a recipient' },
      { eventType: 'recipient.completed', label: 'Recipient Completed', description: 'A recipient completed signing' },
    ];
  }
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export const docusignConnector = new DocuSignConnector();

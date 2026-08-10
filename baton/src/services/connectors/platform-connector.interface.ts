/**
 * PlatformConnector Interface — Baton
 * 
 * Unified interface that all platform connectors must implement.
 * Each platform = one class implementing this interface, registered in index.ts.
 * This is the extension surface for adding new platforms to Baton.
 */

import { Platform, PlatformConnection } from '../../lib/types';

// ─── OAuth Types ─────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;       // seconds
  createdAt: number;        // unix timestamp
  tokenType?: string;
  scope?: string;
  raw?: Record<string, any>; // platform-specific extra fields
}

export interface OAuthAuthorizeResult {
  redirectUrl: string;
  state: string;           // CSRF state to validate on callback
  codeVerifier?: string;   // PKCE code_verifier (for platforms requiring PKCE)
}

export interface OAuthCallbackParams {
  code: string;
  state: string;
  codeVerifier?: string;   // PKCE
}

// ─── Webhook Types ───────────────────────────────────────────

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

export interface ExtractedEventInfo {
  eventType: string;         // e.g. "vendor.created", "invoice.updated"
  eventLabel: string;        // human-readable: "Vendor Created"
  actingUserEmail?: string;  // for user attribution
  actingUserId?: string;     // platform user ID
  recordId?: string;         // source record ID
  summary: string;           // human-readable summary
  rawEventType?: string;     // original event type from platform
  metadata?: Record<string, any>;
}

// ─── Connection Health ───────────────────────────────────────

export interface ConnectionHealthCheck {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  details?: Record<string, any>;
}

// ─── Platform Connector Interface ────────────────────────────

export interface PlatformConnector {
  /** Platform identifier */
  readonly platform: Platform;

  /** Human-readable platform name */
  readonly displayName: string;

  // ─── OAuth ───────────────────────────────────────────────

  /**
   * Generate authorization URL for OAuth flow
   * @param orgId - Organization ID (for state parameter)
   * @param userId - User initiating the connection
   */
  authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult>;

  /**
   * Handle OAuth callback — exchange code for tokens
   */
  handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens>;

  /**
   * Refresh an expired access token
   */
  refreshToken(refreshToken: string): Promise<OAuthTokens>;

  /**
   * Check if token is expired (with 5-minute buffer)
   */
  isTokenExpired(createdAt: number, expiresIn: number): boolean;

  // ─── Webhook Verification ────────────────────────────────

  /**
   * Verify webhook signature/authenticity
   * Each platform has its own mechanism:
   *   - Docusign Connect: HMAC-SHA256
   *   - Salesforce: HMAC-SHA256
   *   - BambooHR: HMAC-SHA256
   *   - Zendesk: HMAC-SHA256 (timestamp + body)
   *   - Power Automate: Basic Auth
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>,
    secret: string,
  ): WebhookVerificationResult;

  /**
   * Extract normalized event info from webhook payload
   */
  extractEventInfo(payload: any): ExtractedEventInfo;

  // ─── Connection Health ───────────────────────────────────

  /**
   * Test if connection is healthy (make a lightweight API call)
   */
  testConnection(accessToken: string): Promise<ConnectionHealthCheck>;

  // ─── Platform-specific event types ───────────────────────

  /**
   * List available event types this platform can emit
   * Used by UI for rule creation
   */
  getSupportedEventTypes(): Array<{ eventType: string; label: string; description: string }>;
}

// ─── Base Implementation ─────────────────────────────────────

/**
 * Base connector with shared logic (token expiry check, etc.)
 */
export abstract class BasePlatformConnector implements PlatformConnector {
  abstract readonly platform: Platform;
  abstract readonly displayName: string;

  abstract authorize(orgId: string, userId: string): Promise<OAuthAuthorizeResult>;
  abstract handleCallback(params: OAuthCallbackParams): Promise<OAuthTokens>;
  abstract refreshToken(refreshToken: string): Promise<OAuthTokens>;
  abstract verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>, secret: string): WebhookVerificationResult;
  abstract extractEventInfo(payload: any): ExtractedEventInfo;
  abstract testConnection(accessToken: string): Promise<ConnectionHealthCheck>;
  abstract getSupportedEventTypes(): Array<{ eventType: string; label: string; description: string }>;

  /**
   * Check if token is expired with 5-minute buffer
   */
  isTokenExpired(createdAt: number, expiresIn: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = createdAt + expiresIn;
    const bufferTime = 300; // 5 minutes buffer
    return now >= (expiresAt - bufferTime);
  }
}

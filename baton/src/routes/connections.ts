/**
 * Connection Routes — Baton
 * Platform CRUD + OAuth callbacks
 * 
 * Wired to: connection.service, connectors, maestro.service
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SelectAccountInput, WebhookSecretInput } from '../docs/schemas/connection';
import { PlatformSlug } from '../docs/schemas/common';
import { requireAuth } from '../middleware/auth';
import { requireAdmin, requireViewer } from '../middleware/rbac';
import { logInfo, logError } from '../lib/logger';
import { Platform } from '../lib/types';
import { NotFoundError, ValidationError } from '../middleware/error-handler';
import * as connectionService from '../services/connection.service';
import { getConnector, hasConnector } from '../services/connectors';
import { storeOAuthState, retrieveOAuthState } from '../services/oauth-state.service';
import { logAudit } from '../services/audit.service';
import { getDocClient, TableNames } from '../db/client';
import env from '../env';

const router = Router();

// Validation schemas live in src/docs/schemas/connection.ts. The platform-param
// guard below uses the shared PlatformSlug enum to stay aligned with docs.
const authorizeSchema = z.object({ platform: PlatformSlug });

// ─── GET /api/connections — List all connections for org ─────

router.get('/', requireAuth, requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const connections = await connectionService.getConnectionsByOrg(orgId);

    // Strip encrypted tokens from response
    const safeConnections = connections.map(stripSensitiveFields);

    res.json({ connections: safeConnections });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/connections/platforms — Available OAuth platforms ─
// Demo: all platforms are webhook-only (configured via Apps page)
const OAUTH_PLATFORMS: Platform[] = [];

router.get('/platforms', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const platforms = OAUTH_PLATFORMS
      .filter((p) => hasConnector(p))
      .map((p) => {
        const connector = getConnector(p);
        return {
          platform: p,
          displayName: connector.displayName,
          eventTypes: connector.getSupportedEventTypes(),
        };
      });
    res.json({ platforms });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/connections/docusign/setup-status — Guided OAuth setup ─
// Readable by any authenticated role. On a fresh self-host the Docusign OAuth
// app credentials are empty and the Connect button would start a doomed
// redirect (empty client_id). The frontend calls this to decide whether to
// show the n8n-style one-time setup guide (exact redirect URI to copy) or
// the normal Connect button.

router.get('/docusign/setup-status', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getDocusignSetupStatus());
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/connections/:id — Get connection details ───────

router.get('/:id', requireAuth, requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    res.json({ connection: stripSensitiveFields(connection) });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/connections/:platform/authorize — Start OAuth ─

router.post('/:platform/authorize', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { platform } = authorizeSchema.parse({ platform: req.params.platform });
    const orgId = req.auth!.orgId;
    const userId = req.auth!.userId;

    if (!hasConnector(platform as Platform)) {
      throw new ValidationError(`Platform '${platform}' is not supported yet`);
    }

    // Fresh self-host guard: without the OAuth app credentials the Docusign
    // redirect would carry an empty client_id and fail at Docusign's door.
    if (platform === 'docusign') {
      const setup = getDocusignSetupStatus();
      if (!setup.configured) {
        res.status(409).json({
          error: 'Docusign OAuth is not configured',
          message: 'Set DOCUSIGN_INTEGRATION_KEY and DOCUSIGN_SECRET_KEY in the API environment and restart. The Connections page shows the exact redirect URI to register in your Docusign app.',
          redirectUri: setup.redirectUri,
          developerPortalUrl: setup.developerPortalUrl,
        });
        return;
      }
    }

    // Check if connection already exists
    const existing = await connectionService.getConnectionByOrgAndPlatform(orgId, platform as Platform);
    if (existing && existing.status === 'healthy') {
      throw new ValidationError(`${platform} is already connected. Disconnect first to reconnect.`);
    }

    const connector = getConnector(platform as Platform);
    const result = await connector.authorize(orgId, userId);

    // Store state in DynamoDB for callback validation (10 min TTL, one-time use)
    await storeOAuthState(result.state, {
      orgId,
      userId,
      platform: platform as Platform,
      codeVerifier: result.codeVerifier,
    });

    logInfo('OAuth flow initiated', { platform, orgId, userId });

    res.json({ redirectUrl: result.redirectUrl });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/connections/:platform/callback — OAuth callback ─

router.get('/:platform/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const platform = req.params.platform as Platform;
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    // Handle OAuth errors
    if (error) {
      logError('OAuth callback error', { platform, error, description: req.query.error_description });
      res.redirect(`${env.FRONTEND_URL}/connections?status=error&platform=${platform}&error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${env.FRONTEND_URL}/connections?status=error&platform=${platform}&error=missing_params`);
      return;
    }

    // Retrieve and validate stored state (DynamoDB, one-time use)
    const storedState = await retrieveOAuthState(state);
    if (!storedState) {
      logError('Invalid OAuth state', { platform, state });
      res.redirect(`${env.FRONTEND_URL}/connections?status=error&platform=${platform}&error=invalid_state`);
      return;
    }

    if (!hasConnector(platform)) {
      res.redirect(`${env.FRONTEND_URL}/connections?status=error&platform=${platform}&error=unsupported`);
      return;
    }

    const connector = getConnector(platform);

    // Exchange code for tokens
    const tokens = await connector.handleCallback({
      code,
      state,
      codeVerifier: storedState.codeVerifier,
    });

    // Extract account info from token response
    const accountId = extractAccountId(platform, tokens);
    const displayName = extractDisplayName(platform, tokens);

    // Delete existing connection for this org+platform if reconnecting
    const existing = await connectionService.getConnectionByOrgAndPlatform(storedState.orgId, platform);
    if (existing) {
      await connectionService.deleteConnection(existing.id);
    }

    // Create connection with encrypted tokens
    await connectionService.createConnection({
      orgId: storedState.orgId,
      platform,
      displayName,
      tokens,
      accountId,
      metadata: {
        apiBase: tokens.raw?.userInfo?.accounts?.[0]?.base_uri, // Docusign
      },
      createdBy: storedState.userId,
    });

    logInfo('OAuth connection established', { platform, orgId: storedState.orgId });

    logAudit({
      orgId: storedState.orgId,
      userId: storedState.userId,
      action: 'connection.created',
      resourceType: 'connection',
      resourceId: platform,
      metadata: { platform, displayName },
    });

    res.redirect(`${env.FRONTEND_URL}/connections?status=success&platform=${platform}`);
  } catch (error: any) {
    logError('OAuth callback failed', error, { platform: req.params.platform });
    const platform = req.params.platform;
    res.redirect(`${env.FRONTEND_URL}/connections?status=error&platform=${platform}&error=${encodeURIComponent(error.message)}`);
  }
});

// ─── POST /api/connections/:id/select-account — Choose account/tenant ─

router.post('/:id/select-account', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    const { accountId, accountName, baseUri } = SelectAccountInput.parse(req.body);

    // Update connection metadata with selected account
    const updatedMetadata = {
      ...connection.metadata,
      accountId,
      accountName,
      ...(baseUri && { apiBase: baseUri }),
    };

    await connectionService.updateConnectionMetadata(connection.id, updatedMetadata);

    // Also update the accountId field on the connection itself
    await connectionService.updateConnectionAccountId(connection.id, accountId);

    logInfo('Account selected for connection', {
      connectionId: connection.id,
      platform: connection.platform,
      accountId,
    });

    res.json({
      message: 'Account selected',
      connectionId: connection.id,
      accountId,
      accountName,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/connections/:id/accounts — List available accounts/tenants ─

router.get('/:id/accounts', requireAuth, requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    const accessToken = await connectionService.getAccessToken(connection.id);
    let accounts: Array<{ id: string; name: string; baseUri?: string }> = [];

    if (connection.platform === 'docusign') {
      // Docusign: fetch accounts from userInfo
      const connector = getConnector('docusign');
      const health = await connector.testConnection(accessToken);
      const userAccounts = health.details?.accounts || connection.metadata?.accounts || [];

      // If no cached accounts, re-fetch via userInfo
      if (userAccounts.length === 0) {
        const response = await fetch(`${env.DOCUSIGN_OAUTH_BASE}/oauth/userinfo`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.ok) {
          const userInfo: any = await response.json();
          accounts = (userInfo.accounts || []).map((a: any) => ({
            id: a.account_id,
            name: a.account_name,
            baseUri: a.base_uri,
            isDefault: a.is_default,
          }));
        }
      } else {
        accounts = userAccounts;
      }
    }

    res.json({
      accounts,
      selectedAccountId: connection.accountId || connection.metadata?.accountId,
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/connections/:id — Remove connection ─────────

router.delete('/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    await connectionService.deleteConnection(req.params.id as string, req.auth!.userId);

    // Delete all workflows associated with this connection
    const docClient = getDocClient();
    const wfResult = await docClient.send(new QueryCommand({
      TableName: TableNames.WORKFLOWS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      FilterExpression: 'connectionId = :connId',
      ExpressionAttributeValues: { ':orgId': connection.orgId, ':connId': req.params.id as string },
    }));
    const workflowsToDelete = wfResult.Items || [];
    await Promise.all(workflowsToDelete.map((wf: any) =>
      docClient.send(new DeleteCommand({ TableName: TableNames.WORKFLOWS, Key: { id: wf.id } })),
    ));
    if (workflowsToDelete.length > 0) {
      logInfo('Workflows removed after connection disconnect', { connectionId: req.params.id, count: workflowsToDelete.length });
    }

    logInfo('Connection deleted', { id: req.params.id, platform: connection.platform, orgId: connection.orgId });

    logAudit({
      orgId: connection.orgId,
      userId: req.auth!.userId,
      action: 'connection.deleted',
      resourceType: 'connection',
      resourceId: req.params.id as string,
      metadata: { platform: connection.platform },
    });

    res.json({ message: 'Connection removed', id: req.params.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/connections/:id/test — Test connection health ─

router.post('/:id/test', requireAuth, requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    if (!hasConnector(connection.platform)) {
      throw new ValidationError(`No connector for platform: ${connection.platform}`);
    }

    const accessToken = await connectionService.getAccessToken(connection.id);
    const connector = getConnector(connection.platform);
    const health = await connector.testConnection(accessToken);

    // Update connection status based on health check
    const newStatus = health.healthy ? 'healthy' : 'warning';
    if (connection.status !== newStatus) {
      await connectionService.updateConnectionStatus(connection.id, newStatus, health.message);
    }

    logAudit({
      orgId: connection.orgId,
      userId: req.auth!.userId,
      action: 'connection.tested',
      resourceType: 'connection',
      resourceId: connection.id,
      metadata: { platform: connection.platform, healthy: health.healthy },
    });

    res.json({ ...health, connectionId: connection.id, platform: connection.platform });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/connections/:id/refresh — Force token refresh ─

router.post('/:id/refresh', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    const connector = getConnector(connection.platform);
    const refreshToken = await connectionService.getRefreshToken(connection.id);
    const newTokens = await connector.refreshToken(refreshToken);
    await connectionService.updateTokens(connection.id, newTokens);

    logInfo('Token manually refreshed', { id: connection.id, platform: connection.platform });

    logAudit({
      orgId: connection.orgId,
      userId: req.auth!.userId,
      action: 'connection.refreshed',
      resourceType: 'connection',
      resourceId: connection.id,
      metadata: { platform: connection.platform },
    });

    res.json({ message: 'Token refreshed', connectionId: connection.id });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/connections/:id/webhook-secret — Update webhook secret ─

router.patch('/:id/webhook-secret', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connection = await connectionService.getConnection(req.params.id as string);
    if (!connection) throw new NotFoundError('Connection');
    if (connection.orgId !== req.auth!.orgId) throw new NotFoundError('Connection');

    const { secret } = WebhookSecretInput.parse(req.body);
    await connectionService.updateWebhookSecret(connection.id, secret);

    logInfo('Webhook secret updated', { id: connection.id, platform: connection.platform });

    logAudit({
      orgId: connection.orgId,
      userId: req.auth!.userId,
      action: 'connection.webhook_secret_updated',
      resourceType: 'connection',
      resourceId: connection.id,
      metadata: { platform: connection.platform },
    });

    res.json({ message: 'Webhook secret updated', connectionId: connection.id });
  } catch (error) {
    next(error);
  }
});

// ─── Helpers ─────────────────────────────────────────────────

const DOCUSIGN_DEVELOPER_PORTAL_URL = 'https://developers.docusign.com';

/** Docusign guided-setup status. `configured` is true only when both OAuth
 *  app credentials are present; `redirectUri` mirrors exactly what
 *  docusign.connector.ts sends as redirect_uri during authorize/callback. */
function getDocusignSetupStatus() {
  return {
    configured: !!(env.DOCUSIGN_INTEGRATION_KEY && env.DOCUSIGN_SECRET_KEY),
    redirectUri: `${env.API_URL}/api/connections/docusign/callback`,
    oauthBase: env.DOCUSIGN_OAUTH_BASE,
    developerPortalUrl: DOCUSIGN_DEVELOPER_PORTAL_URL,
  };
}

function stripSensitiveFields(connection: any) {
  const { accessTokenEnc, refreshTokenEnc, webhookSecret, ...safe } = connection;
  if (safe.platform === 'docusign' && safe.displayName === 'Docusign') {
    safe.displayName = 'Docusign';
  }
  return {
    ...safe,
    hasAccessToken: !!accessTokenEnc,
    hasRefreshToken: !!refreshTokenEnc,
  };
}

function extractAccountId(platform: Platform, tokens: any): string | undefined {
  switch (platform) {
    case 'docusign':
      return tokens.raw?.userInfo?.accounts?.[0]?.account_id;
    case 'bamboohr':
      // BambooHR: extracted asynchronously in the callback handler below (#13)
      return tokens.raw?.subdomain || tokens.raw?.companyDomain;
    case 'zohocrm':
      // Zoho: current user's org ID fetched after token exchange (#13)
      return tokens.raw?.userInfo?.id?.toString() || tokens.raw?.userInfo?.org?.[0]?.id?.toString();
    case 'smartsheet':
      // Smartsheet: current user's ID fetched after token exchange (#13)
      return tokens.raw?.userInfo?.id?.toString();
    default:
      return undefined;
  }
}

function extractDisplayName(platform: Platform, tokens: any): string {
  switch (platform) {
    case 'docusign':
      return 'Docusign';
    default:
      return `${platform} Connection`;
  }
}

export const _testExports = { stripSensitiveFields, extractAccountId, extractDisplayName, getDocusignSetupStatus };

export default router;

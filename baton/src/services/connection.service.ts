/**
 * Connection Service — Baton
 * 
 * Manages platform_connections in DynamoDB.
 * Handles: create, read, update, delete, token encryption/decryption.
 * 
 * Ported token management patterns from:
 *   - procore/src/services/docusign-token-store.service.ts
 *   - common-extension-lib/token-encryption-production.service.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { encryptToken, decryptToken } from '../lib/encryption';
import { logInfo, logError, logDebug } from '../lib/logger';
import { PlatformConnection, Platform, ConnectionStatus } from '../lib/types';
import { OAuthTokens } from './connectors';
import { sendNotification, connectionCreatedNotification, connectionDisconnectedNotification } from './notification.service';

// ─── Create ──────────────────────────────────────────────────

export async function createConnection(params: {
  orgId: string;
  platform: Platform;
  displayName: string;
  tokens: OAuthTokens;
  accountId?: string;
  webhookId?: string;
  webhookSecret?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
}): Promise<PlatformConnection> {
  const docClient = getDocClient();
  const now = new Date().toISOString();
  const id = uuidv4();

  const connection: PlatformConnection = {
    id,
    orgId: params.orgId,
    platform: params.platform,
    displayName: params.displayName,
    accountId: params.accountId,
    status: 'healthy',
    accessTokenEnc: encryptToken(params.tokens.accessToken),
    refreshTokenEnc: params.tokens.refreshToken ? encryptToken(params.tokens.refreshToken) : undefined,
    tokenExpiresAt: new Date((params.tokens.createdAt + params.tokens.expiresIn) * 1000).toISOString(),
    scopes: params.tokens.scope ? params.tokens.scope.split(' ') : undefined,
    metadata: params.metadata,
    webhookId: params.webhookId,
    webhookSecret: params.webhookSecret,
    lastSyncAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Item: connection,
  }));

  logInfo('Connection created', { id, orgId: params.orgId, platform: params.platform });

  // Send notification (fire-and-forget)
  if (params.createdBy) {
    sendNotification(connectionCreatedNotification(
      params.orgId, params.createdBy, params.platform, params.displayName,
    )).catch(() => {});
  }

  return connection;
}

// ─── Read ────────────────────────────────────────────────────

export async function getConnection(id: string): Promise<PlatformConnection | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
  }));
  return (result.Item as PlatformConnection) || null;
}

export async function getConnectionsByOrg(orgId: string): Promise<PlatformConnection[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :orgId',
    ExpressionAttributeValues: { ':orgId': orgId },
  }));
  return (result.Items as PlatformConnection[]) || [];
}

export async function getConnectionByOrgAndPlatform(orgId: string, platform: Platform): Promise<PlatformConnection | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    IndexName: 'orgId-platform-index',
    KeyConditionExpression: 'orgId = :orgId AND platform = :platform',
    ExpressionAttributeValues: { ':orgId': orgId, ':platform': platform },
  }));
  return (result.Items?.[0] as PlatformConnection) || null;
}

export async function getConnectionByAccountId(accountId: string): Promise<PlatformConnection | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    IndexName: 'accountId-index',
    KeyConditionExpression: 'accountId = :accountId',
    ExpressionAttributeValues: { ':accountId': accountId },
  }));
  return (result.Items?.[0] as PlatformConnection) || null;
}

// ─── Token Operations ────────────────────────────────────────

/**
 * Get decrypted access token for a connection
 */
export async function getAccessToken(connectionId: string): Promise<string> {
  const connection = await getConnection(connectionId);
  if (!connection || !connection.accessTokenEnc) {
    throw new Error(`No access token for connection ${connectionId}`);
  }
  return decryptToken(connection.accessTokenEnc);
}

/**
 * Get decrypted refresh token for a connection
 */
export async function getRefreshToken(connectionId: string): Promise<string> {
  const connection = await getConnection(connectionId);
  if (!connection || !connection.refreshTokenEnc) {
    throw new Error(`No refresh token for connection ${connectionId}`);
  }
  return decryptToken(connection.refreshTokenEnc);
}

/**
 * Update tokens after a refresh
 * Pattern from: docusign-token-store.service.ts → updateToken()
 */
export async function updateTokens(connectionId: string, tokens: OAuthTokens): Promise<void> {
  const docClient = getDocClient();
  const now = new Date().toISOString();

  const updateExpr: string[] = [
    'accessTokenEnc = :accessToken',
    'tokenExpiresAt = :tokenExpiresAt',
    'updatedAt = :updatedAt',
    '#st = :status',
    'lastSyncAt = :lastSyncAt',
  ];
  const exprValues: Record<string, any> = {
    ':accessToken': encryptToken(tokens.accessToken),
    ':tokenExpiresAt': new Date((tokens.createdAt + tokens.expiresIn) * 1000).toISOString(),
    ':updatedAt': now,
    ':status': 'healthy',
    ':lastSyncAt': now,
  };

  if (tokens.refreshToken) {
    updateExpr.push('refreshTokenEnc = :refreshToken');
    exprValues[':refreshToken'] = encryptToken(tokens.refreshToken);
  }

  if (tokens.scope) {
    updateExpr.push('scopes = :scopes');
    exprValues[':scopes'] = tokens.scope.split(' ');
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id: connectionId },
    UpdateExpression: `SET ${updateExpr.join(', ')}`,
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: { '#st': 'status' },
  }));

  logDebug('Connection tokens updated', { connectionId });
}

// ─── Status ──────────────────────────────────────────────────

export async function updateConnectionStatus(id: string, status: ConnectionStatus, error?: string): Promise<void> {
  const docClient = getDocClient();
  const now = new Date().toISOString();

  const updateExpr = ['#st = :status', 'updatedAt = :updatedAt'];
  const exprValues: Record<string, any> = { ':status': status, ':updatedAt': now };

  if (error) {
    updateExpr.push('lastError = :error');
    exprValues[':error'] = error;
  }

  await docClient.send(new UpdateCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
    UpdateExpression: `SET ${updateExpr.join(', ')}`,
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: { '#st': 'status' },
  }));
}

// ─── Metadata & Account ──────────────────────────────────────

export async function updateConnectionMetadata(id: string, metadata: Record<string, any>): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
    UpdateExpression: 'SET metadata = :metadata, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':metadata': metadata,
      ':updatedAt': new Date().toISOString(),
    },
  }));
  logDebug('Connection metadata updated', { id });
}

export async function updateConnectionAccountId(id: string, accountId: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
    UpdateExpression: 'SET accountId = :accountId, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':accountId': accountId,
      ':updatedAt': new Date().toISOString(),
    },
  }));
  logDebug('Connection accountId updated', { id, accountId });
}

export async function updateWebhookSecret(id: string, webhookSecret: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
    UpdateExpression: 'SET webhookSecret = :secret, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':secret': webhookSecret,
      ':updatedAt': new Date().toISOString(),
    },
  }));
  logDebug('Connection webhook secret updated', { id });
}

// ─── Delete ──────────────────────────────────────────────────

export async function deleteConnection(id: string, deletedBy?: string): Promise<void> {
  const docClient = getDocClient();

  // Fetch before delete for notification context
  const connection = await getConnection(id);

  await docClient.send(new DeleteCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    Key: { id },
  }));
  logInfo('Connection deleted', { id });

  // Send notification (fire-and-forget)
  if (connection && deletedBy) {
    sendNotification(connectionDisconnectedNotification(
      connection.orgId, deletedBy, connection.platform, connection.displayName,
    )).catch(() => {});
  }
}

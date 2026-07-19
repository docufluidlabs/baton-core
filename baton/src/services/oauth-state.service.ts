/**
 * OAuth State Service — Baton
 *
 * DynamoDB-backed OAuth state store for CSRF protection.
 * Replaces in-memory Map for production readiness.
 *
 * Table: baton-oauth-states
 *   PK: state (random hex string)
 *   Attributes: orgId, userId, platform, codeVerifier, createdAt, ttl
 *   TTL: DynamoDB auto-deletes expired items via `ttl` attribute
 */

import { PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { Platform } from '../lib/types';
import { logDebug, logError } from '../lib/logger';

// ─── Types ───────────────────────────────────────────────────

export interface OAuthStateData {
  orgId: string;
  userId: string;
  platform: Platform;
  codeVerifier?: string;
  createdAt: number;
}

const STATE_TTL_SECONDS = 10 * 60; // 10 minutes

// ─── Store State ─────────────────────────────────────────────

export async function storeOAuthState(
  state: string,
  data: Omit<OAuthStateData, 'createdAt'>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const doc = getDocClient();

  try {
    await doc.send(
      new PutCommand({
        TableName: TableNames.OAUTH_STATES,
        Item: {
          state,
          orgId: data.orgId,
          userId: data.userId,
          platform: data.platform,
          codeVerifier: data.codeVerifier,
          createdAt: now,
          ttl: now + STATE_TTL_SECONDS,
        },
      }),
    );
    logDebug('OAuth state stored', { state: state.substring(0, 8) + '...', platform: data.platform });
  } catch (error: any) {
    logError('Failed to store OAuth state in DynamoDB', error);
    throw new Error('Failed to initiate OAuth flow. Please try again.');
  }
}

// ─── Retrieve & Consume State (one-time use) ─────────────────

export async function retrieveOAuthState(state: string): Promise<OAuthStateData | null> {
  const doc = getDocClient();

  try {
    const result = await doc.send(
      new GetCommand({
        TableName: TableNames.OAUTH_STATES,
        Key: { state },
      }),
    );

    if (!result.Item) {
      logDebug('OAuth state not found (expired or invalid)', { state: state.substring(0, 8) + '...' });
      return null;
    }

    // One-time use: delete immediately after retrieval
    await doc.send(
      new DeleteCommand({
        TableName: TableNames.OAUTH_STATES,
        Key: { state },
      }),
    );

    // Check expiry (belt-and-suspenders — DynamoDB TTL is eventually consistent)
    const now = Math.floor(Date.now() / 1000);
    if (result.Item.ttl && now > result.Item.ttl) {
      logDebug('OAuth state expired', { state: state.substring(0, 8) + '...' });
      return null;
    }

    return {
      orgId: result.Item.orgId,
      userId: result.Item.userId,
      platform: result.Item.platform as Platform,
      codeVerifier: result.Item.codeVerifier,
      createdAt: result.Item.createdAt,
    };
  } catch (error: any) {
    logError('Failed to retrieve OAuth state from DynamoDB', error);
    return null;
  }
}

/**
 * Token Refresh Worker — Baton
 * 
 * Proactively refreshes tokens that are about to expire.
 * Refreshes OAuth tokens before expiry (5min buffer)
 * 
 * This worker is triggered on a schedule (every 5 minutes via cron job)
 * that sends a message to the SQS queue for each connection needing refresh.
 */

import { TokenRefreshJob } from '../lib/types';
import { createLogger } from '../lib/logger';
import * as connectionService from '../services/connection.service';
import { getConnector, hasConnector } from '../services/connectors';
import { getOrgAdmin } from '../services/user.service';
import { sendNotification, connectionDisconnectedNotification } from '../services/notification.service';

export async function processTokenRefreshJob(job: TokenRefreshJob): Promise<void> {
  const { connectionId, orgId, platform } = job;
  const log = createLogger({ worker: 'token-refresh', connectionId, orgId, platform });

  log.debug('Processing token refresh');

  try {
    if (!hasConnector(platform)) {
      log.debug('No connector for platform, skipping refresh');
      return;
    }

    const connection = await connectionService.getConnection(connectionId);
    if (!connection) {
      log.error('Connection not found for token refresh');
      return;
    }

    // Check if token actually needs refresh
    if (connection.tokenExpiresAt) {
      const expiresAt = new Date(connection.tokenExpiresAt).getTime();
      const now = Date.now();
      const bufferMs = 10 * 60 * 1000; // 10 minutes

      if (now < expiresAt - bufferMs) {
        log.debug('Token still valid, skipping refresh');
        return;
      }
    }

    // Check if refresh token exists before attempting refresh
    if (!connection.refreshTokenEnc) {
      log.error('No refresh token available, marking connection as warning');
      await connectionService.updateConnectionStatus(connectionId, 'warning', 'No refresh token available. Please reconnect.');

      // Notify org admin about permanent token failure
      const adminId = await getOrgAdmin(orgId);
      if (adminId) {
        await sendNotification(connectionDisconnectedNotification(
          orgId, adminId, platform, connection.displayName, 'Refresh token expired. Please reconnect.',
        ));
      }
      return; // Don't throw — permanent error, retrying won't help
    }

    // Refresh
    const connector = getConnector(platform);
    const refreshToken = await connectionService.getRefreshToken(connectionId);
    const newTokens = await connector.refreshToken(refreshToken);
    await connectionService.updateTokens(connectionId, newTokens);

    log.info('Token refreshed successfully');
  } catch (error: any) {
    log.error({ err: error }, 'Token refresh failed');
    await connectionService.updateConnectionStatus(connectionId, 'warning', error.message);

    // Don't retry permanent errors (missing tokens, invalid connections)
    const permanent = error.message?.includes('No refresh token') || error.message?.includes('not found');
    if (permanent) return;

    throw error; // Only rethrow transient errors for SQS retry
  }
}

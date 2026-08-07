/**
 * Connector Registry — Baton
 * Central registry for all platform connectors
 */

import { Platform } from '../../lib/types';
import { PlatformConnector } from './platform-connector.interface';
import { salesforceConnector } from './salesforce.connector';
import { hubspotConnector } from './hubspot.connector';
import { zohocrmConnector } from './zohocrm.connector';
import { docusignConnector } from './docusign.connector';
import { smartsheetConnector } from './smartsheet.connector';
import { bamboohrConnector } from './bamboohr.connector';
import { zendeskConnector } from './zendesk.connector';
import { powerautomateConnector } from './powerautomate.connector';
import { airtableConnector } from './airtable.connector';

const connectorRegistry = new Map<Platform, PlatformConnector>();

// Register connectors
connectorRegistry.set('salesforce', salesforceConnector);
connectorRegistry.set('hubspot', hubspotConnector);
connectorRegistry.set('zohocrm', zohocrmConnector);
connectorRegistry.set('docusign', docusignConnector);
connectorRegistry.set('smartsheet', smartsheetConnector);
connectorRegistry.set('bamboohr', bamboohrConnector);
connectorRegistry.set('zendesk', zendeskConnector);
connectorRegistry.set('powerautomate', powerautomateConnector);
connectorRegistry.set('airtable', airtableConnector);

/**
 * Get connector for a specific platform
 * @throws Error if platform is not registered
 */
export function getConnector(platform: Platform): PlatformConnector {
  const connector = connectorRegistry.get(platform);
  if (!connector) {
    throw new Error(`No connector registered for platform: ${platform}`);
  }
  return connector;
}

/**
 * Check if a platform has a registered connector
 */
export function hasConnector(platform: Platform): boolean {
  return connectorRegistry.has(platform);
}

/**
 * Get list of all registered platforms
 */
export function getRegisteredPlatforms(): Platform[] {
  return Array.from(connectorRegistry.keys());
}

export { PlatformConnector } from './platform-connector.interface';
export type { OAuthTokens, OAuthAuthorizeResult, OAuthCallbackParams, ExtractedEventInfo, WebhookVerificationResult, ConnectionHealthCheck } from './platform-connector.interface';

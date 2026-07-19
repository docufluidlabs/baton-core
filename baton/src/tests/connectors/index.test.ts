import { describe, it, expect, vi } from 'vitest';

// Mock all connector modules to prevent env/logger initialization
vi.mock('../../services/connectors/docusign.connector', () => ({ docusignConnector: { platform: 'docusign' } }));
vi.mock('../../services/connectors/salesforce.connector', () => ({ salesforceConnector: { platform: 'salesforce' } }));
vi.mock('../../services/connectors/hubspot.connector', () => ({ hubspotConnector: { platform: 'hubspot' } }));
vi.mock('../../services/connectors/zohocrm.connector', () => ({ zohocrmConnector: { platform: 'zohocrm' } }));
vi.mock('../../services/connectors/bamboohr.connector', () => ({ bamboohrConnector: { platform: 'bamboohr' } }));
vi.mock('../../services/connectors/zendesk.connector', () => ({ zendeskConnector: { platform: 'zendesk' } }));
vi.mock('../../services/connectors/powerautomate.connector', () => ({ powerautomateConnector: { platform: 'powerautomate' } }));
vi.mock('../../lib/types', () => ({}));

import { getConnector, hasConnector, getRegisteredPlatforms } from '../../services/connectors/index';

const SHIP_SET = [
  'docusign',
  'salesforce',
  'hubspot',
  'zohocrm',
  'zendesk',
  'bamboohr',
  'powerautomate',
] as const;

describe('Connector Registry', () => {
  describe('getConnector', () => {
    it('should return the docusign connector', () => {
      const connector = getConnector('docusign' as any);
      expect(connector).toBeDefined();
      expect(connector).toHaveProperty('platform', 'docusign');
    });

    it('should throw for an unregistered platform', () => {
      expect(() => getConnector('invalid_platform' as any)).toThrow(
        'No connector registered for platform',
      );
    });
  });

  describe('hasConnector', () => {
    it('should return true for every shipped platform', () => {
      for (const platform of SHIP_SET) {
        expect(hasConnector(platform as any)).toBe(true);
      }
    });

    it('should return false for an unregistered platform', () => {
      expect(hasConnector('not_a_platform' as any)).toBe(false);
    });

    it('should return false for platforms that no longer ship', () => {
      for (const platform of ['procore', 'xero', 'smartsheet', 'middesk', 'pipedrive']) {
        expect(hasConnector(platform as any)).toBe(false);
      }
    });
  });

  describe('getRegisteredPlatforms', () => {
    it('should register exactly the ship set', () => {
      const platforms = getRegisteredPlatforms();
      expect(platforms.sort()).toEqual([...SHIP_SET].sort());
    });
  });
});

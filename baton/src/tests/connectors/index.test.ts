import { describe, it, expect, vi } from 'vitest';

// Mock all connector modules to prevent env/logger initialization
vi.mock('../../services/connectors/docusign.connector', () => ({ docusignConnector: { platform: 'docusign' } }));
vi.mock('../../services/connectors/procore.connector', () => ({ procoreConnector: { platform: 'procore' } }));
vi.mock('../../services/connectors/xero.connector', () => ({ xeroConnector: { platform: 'xero' } }));
vi.mock('../../services/connectors/smartsheet.connector', () => ({ smartsheetConnector: { platform: 'smartsheet' } }));
vi.mock('../../services/connectors/bamboohr.connector', () => ({ bamboohrConnector: { platform: 'bamboohr' } }));
vi.mock('../../services/connectors/zohocrm.connector', () => ({ zohocrmConnector: { platform: 'zohocrm' } }));
vi.mock('../../lib/types', () => ({}));

import { getConnector, hasConnector, getRegisteredPlatforms } from '../../services/connectors/index';

describe('Connector Registry', () => {
  describe('getConnector', () => {
    it('should return the docusign connector', () => {
      const connector = getConnector('docusign' as any);
      expect(connector).toBeDefined();
      expect(connector).toHaveProperty('platform', 'docusign');
    });

    it('should return the procore connector', () => {
      const connector = getConnector('procore' as any);
      expect(connector).toBeDefined();
      expect(connector).toHaveProperty('platform', 'procore');
    });

    it('should return the xero connector', () => {
      const connector = getConnector('xero' as any);
      expect(connector).toBeDefined();
    });

    it('should throw for an unregistered platform', () => {
      expect(() => getConnector('invalid_platform' as any)).toThrow(
        'No connector registered for platform',
      );
    });
  });

  describe('hasConnector', () => {
    it('should return true for a registered platform', () => {
      expect(hasConnector('procore' as any)).toBe(true);
    });

    it('should return false for an unregistered platform', () => {
      expect(hasConnector('not_a_platform' as any)).toBe(false);
    });
  });

  describe('getRegisteredPlatforms', () => {
    it('should return an array of length 8', () => {
      const platforms = getRegisteredPlatforms();
      expect(platforms).toHaveLength(8);
    });

    it('should include the zendesk connector', () => {
      expect(getRegisteredPlatforms()).toContain('zendesk');
    });

    it('should include the powerautomate connector', () => {
      expect(getRegisteredPlatforms()).toContain('powerautomate');
    });

    it('should include all 6 registered platforms', () => {
      const platforms = getRegisteredPlatforms();
      expect(platforms).toContain('procore');
      expect(platforms).toContain('docusign');
      expect(platforms).toContain('xero');
      expect(platforms).toContain('smartsheet');
      expect(platforms).toContain('bamboohr');
      expect(platforms).toContain('zohocrm');
    });
  });
});

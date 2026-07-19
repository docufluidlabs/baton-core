/**
 * App Catalog — Zendesk entry tests — Baton
 *
 * The Zendesk catalog entry drives webhook verification and the setup wizard.
 * These guard the config the route handlers + connector depend on.
 */
import { describe, it, expect } from 'vitest';
import { getAppTemplate } from '../../lib/app-catalog';

describe('app-catalog: zendesk', () => {
  const template = getAppTemplate('zendesk');

  it('is registered as a webhook-capable Zendesk app', () => {
    expect(template).toBeDefined();
    expect(template!.slug).toBe('zendesk');
    expect(template!.name).toBe('Zendesk');
    expect(template!.webhookCapable).toBe(true);
  });

  it('uses the hmac_zendesk verification scheme (base64, signature header)', () => {
    expect(template!.verificationMethod).toEqual({
      type: 'hmac_zendesk',
      headerName: 'x-zendesk-webhook-signature',
      encoding: 'base64',
    });
  });

  it('exposes the supported event types used for rule matching', () => {
    const eventTypes = template!.supportedEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('ticket.created');
    expect(eventTypes).toContain('ticket.solved');
    expect(eventTypes).toContain('satisfaction_rating.created');
    for (const e of template!.supportedEvents) {
      expect(typeof e.eventType).toBe('string');
      expect(typeof e.label).toBe('string');
      expect(typeof e.description).toBe('string');
    }
  });

  it('provides setup instructions for the wizard', () => {
    expect(template!.setupInstructions.length).toBeGreaterThan(0);
    expect(template!.secretKeyLabel).toMatch(/signing secret/i);
  });
});

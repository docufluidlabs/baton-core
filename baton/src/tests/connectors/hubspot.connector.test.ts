import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { HubSpotConnector } from '../../services/connectors/hubspot.connector';

let connector: HubSpotConnector;

beforeEach(() => {
  connector = new HubSpotConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {

  // ─── Повний формат (масив подій) ──────────────────────────

  it('розпізнає contact.creation з масиву подій', () => {
    const payload = [
      {
        attemptNumber: 0,
        sourceId: 'userId:89643182',
        eventId: 2474115725,
        changeSource: 'CRM_UI',
        occurredAt: 1777035637445,
        subscriptionType: 'contact.creation',
        portalId: 148041090,
        appId: 33908884,
        changeFlag: 'CREATED',
        subscriptionId: 5863565,
        objectId: 763810161872,
      },
    ];

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('contact.created');
    expect(result.eventLabel).toBe('Contact Created');
    expect(result.recordId).toBe('763810161872');
    expect(result.rawEventType).toBe('contact.creation');
    expect(result.metadata?.portalId).toBe(148041090);
    expect(result.metadata?.changeFlag).toBe('CREATED');
  });

  it('розпізнає deal.deletion', () => {
    const payload = [{ subscriptionType: 'deal.deletion', changeFlag: 'DELETED', objectId: 999, portalId: 111 }];

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('deal.deleted');
    expect(result.eventLabel).toBe('Deal Deleted');
    expect(result.recordId).toBe('999');
  });

  it('розпізнає company.propertyChange як updated', () => {
    const payload = [{ subscriptionType: 'company.propertyChange', changeFlag: 'UPDATED', objectId: 42, portalId: 111 }];

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('company.updated');
  });

  it('включає batchSize та allEvents у metadata при кількох подіях', () => {
    const payload = [
      { subscriptionType: 'contact.creation', objectId: 1, changeFlag: 'CREATED', portalId: 111 },
      { subscriptionType: 'contact.update', objectId: 2, changeFlag: 'UPDATED', portalId: 111 },
    ];

    const result = connector.extractEventInfo(payload);

    expect(result.metadata?.batchSize).toBe(2);
    expect(result.metadata?.allEvents).toHaveLength(2);
    expect(result.summary).toContain('+');
  });

  it('не включає allEvents у metadata при одній події', () => {
    const payload = [{ subscriptionType: 'contact.creation', objectId: 1, changeFlag: 'CREATED', portalId: 111 }];

    const result = connector.extractEventInfo(payload);

    expect(result.metadata?.batchSize).toBe(1);
    expect(result.metadata?.allEvents).toBeUndefined();
  });

  // ─── Спрощений формат (об'єкт без subscriptionType) ───────

  it('обробляє { objectId } без subscriptionType', () => {
    const payload = { objectId: 59086970954 };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown.received');
    expect(result.eventLabel).toBe('Webhook Received');
    expect(result.recordId).toBe('59086970954');
    expect(result.metadata?.objectId).toBe(59086970954);
    expect(result.metadata?.batchSize).toBe(1);
  });

  it('обробляє { objectId, eventId }', () => {
    const payload = { objectId: 59086970954, eventId: 2474115725 };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown.received');
    expect(result.recordId).toBe('59086970954');
    expect(result.metadata?.objectId).toBe(59086970954);
    expect(result.metadata?.eventId).toBe(2474115725);
  });

  it('обробляє { objectId, appId }', () => {
    const payload = { objectId: 59086970954, appId: 33908884 };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown.received');
    expect(result.metadata?.objectId).toBe(59086970954);
    expect(result.metadata?.appId).toBe(33908884);
  });

  it('обробляє { eventId, appId } без objectId', () => {
    const payload = { eventId: 2474115725, appId: 33908884 };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('unknown.received');
    expect(result.recordId).toBeUndefined();
    expect(result.metadata?.eventId).toBe(2474115725);
    expect(result.metadata?.appId).toBe(33908884);
  });

  it('обробляє порожній об\'єкт без падіння', () => {
    const result = connector.extractEventInfo({});

    expect(result.eventType).toBe('unknown.received');
    expect(result.recordId).toBeUndefined();
  });

  it('обробляє порожній масив без падіння', () => {
    const result = connector.extractEventInfo([]);

    expect(result.eventType).toBe('unknown.received');
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'test-hubspot-client-secret';
  const uri = 'https://app.baton.io/api/webhooks/hubspot';
  // свіжий timestamp щоб не спрацювала replay-protection
  const timestamp = String(Date.now());

  function computeSignature(body: string, method = 'POST'): string {
    const sourceString = method + uri + body + timestamp;
    return crypto
      .createHmac('sha256', secret)
      .update(sourceString, 'utf8')
      .digest('base64');
  }

  it('підтверджує валідний підпис v3', () => {
    const body = '[{"subscriptionType":"contact.creation","portalId":12345}]';
    const rawBody = Buffer.from(body);
    const signature = computeSignature(body);

    const result = connector.verifyWebhookSignature(rawBody, {
      'x-hubspot-signature-v3': signature,
      'x-hubspot-request-timestamp': timestamp,
      'x-baton-request-uri': uri,
    }, secret);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('відхиляє невалідний підпис', () => {
    const body = '[{"subscriptionType":"contact.creation"}]';

    const result = connector.verifyWebhookSignature(Buffer.from(body), {
      'x-hubspot-signature-v3': 'aW52YWxpZC1zaWduYXR1cmUtdGVzdA==',
      'x-hubspot-request-timestamp': timestamp,
      'x-baton-request-uri': uri,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('відхиляє запит без заголовка підпису', () => {
    const result = connector.verifyWebhookSignature(Buffer.from('{}'), {
      'x-hubspot-request-timestamp': timestamp,
      'x-baton-request-uri': uri,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('відхиляє запит без налаштованого секрету', () => {
    const result = connector.verifyWebhookSignature(Buffer.from('{}'), {
      'x-hubspot-signature-v3': 'some-sig',
      'x-hubspot-request-timestamp': timestamp,
    }, '');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not configured');
  });

  it('відхиляє застарілий timestamp (replay attack)', () => {
    const body = '{}';
    const oldTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 хвилин тому
    const sourceString = 'POST' + uri + body + oldTimestamp;
    const sig = crypto.createHmac('sha256', secret).update(sourceString, 'utf8').digest('base64');

    const result = connector.verifyWebhookSignature(Buffer.from(body), {
      'x-hubspot-signature-v3': sig,
      'x-hubspot-request-timestamp': oldTimestamp,
      'x-baton-request-uri': uri,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('timestamp too old');
  });

  it('пропускає перевірку timestamp коли заголовок відсутній', () => {
    const body = '{}';
    // Без timestamp у source string
    const sourceString = 'POST' + uri + body + '';
    const sig = crypto.createHmac('sha256', secret).update(sourceString, 'utf8').digest('base64');

    const result = connector.verifyWebhookSignature(Buffer.from(body), {
      'x-hubspot-signature-v3': sig,
      'x-baton-request-uri': uri,
    }, secret);

    expect(result.valid).toBe(true);
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('повертає події для contact, deal, company та wildcards', () => {
    const types = connector.getSupportedEventTypes();

    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(t).toHaveProperty('eventType');
      expect(t).toHaveProperty('label');
      expect(t).toHaveProperty('description');
    }
  });

  it('містить wildcard-події', () => {
    const types = connector.getSupportedEventTypes();
    const wildcards = types.filter(t => t.eventType.endsWith('.*'));

    expect(wildcards.length).toBeGreaterThan(0);
  });
});

// ─── OAuth (не підтримується) ────────────────────────────────

describe('OAuth методи (не підтримуються)', () => {
  it('authorize кидає помилку', async () => {
    await expect(connector.authorize()).rejects.toThrow('webhook-only');
  });

  it('handleCallback кидає помилку', async () => {
    await expect(connector.handleCallback({ code: 'x', state: 'y' })).rejects.toThrow('webhook-only');
  });

  it('refreshToken кидає помилку', async () => {
    await expect(connector.refreshToken('token')).rejects.toThrow('webhook-only');
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('завжди повертає healthy (webhook-only)', async () => {
    const result = await connector.testConnection();

    expect(result.healthy).toBe(true);
    expect(result.message).toContain('no API connection');
  });
});

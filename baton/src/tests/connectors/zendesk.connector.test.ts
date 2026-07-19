import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

import { ZendeskConnector } from '../../services/connectors/zendesk.connector';
import { getAppTemplate } from '../../lib/app-catalog';

let connector: ZendeskConnector;

beforeEach(() => {
  connector = new ZendeskConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('normalizes an Event-subscription envelope to {resource}.{action}', () => {
    const payload = {
      type: 'zen:event-type:ticket.created',
      subject: 'zen:ticket:35436',
      detail: { id: '35436', status: 'new' },
      account_id: 123,
      time: '2026-06-12T10:00:00Z',
      zendesk_event_version: '2022-11-06',
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('ticket.created');
    expect(result.eventLabel).toBe('Ticket Created');
    expect(result.recordId).toBe('35436');
    expect(result.rawEventType).toBe('zen:event-type:ticket.created');
    expect(result.metadata?.accountId).toBe(123);
  });

  it('handles satisfaction_rating.created', () => {
    const payload = {
      type: 'zen:event-type:satisfaction_rating.created',
      subject: 'zen:satisfaction_rating:99',
      detail: { id: '99' },
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('satisfaction_rating.created');
    expect(result.eventLabel).toBe('CSAT Rating Received');
    expect(result.recordId).toBe('99');
  });

  it('parses recordId from subject when detail.id is absent', () => {
    const payload = {
      type: 'zen:event-type:user.created',
      subject: 'zen:user:771',
    };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('user.created');
    expect(result.recordId).toBe('771');
  });

  it('falls back to event_type for trigger-built (non-prefixed) bodies', () => {
    const payload = { event_type: 'ticket.updated', id: 42 };

    const result = connector.extractEventInfo(payload);

    expect(result.eventType).toBe('ticket.updated');
    expect(result.eventLabel).toBe('Ticket Updated');
    expect(result.recordId).toBe('42');
  });

  it('falls back to "webhook" for an unrecognized body so a "*" rule still matches', () => {
    const result = connector.extractEventInfo({ hello: 'world' });

    expect(result.eventType).toBe('webhook');
    expect(result.eventLabel).toBe('Webhook Event');
  });

  it('labels an unknown but well-formed event type via title-casing', () => {
    const result = connector.extractEventInfo({ type: 'zen:event-type:ticket.merged' });

    expect(result.eventType).toBe('ticket.merged');
    expect(result.eventLabel).toBe('Ticket Merged');
  });
});

// ─── verifyWebhookSignature ──────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'zendesk-signing-secret';

  function sign(body: string, timestamp: string, key: string): string {
    return crypto.createHmac('sha256', key).update(timestamp + body).digest('base64');
  }

  it('accepts a valid signature over (timestamp + body)', () => {
    const bodyStr = '{"type":"zen:event-type:ticket.created"}';
    const timestamp = new Date().toISOString();
    const signature = sign(bodyStr, timestamp, secret);

    const result = connector.verifyWebhookSignature(Buffer.from(bodyStr), {
      'x-zendesk-webhook-signature': signature,
      'x-zendesk-webhook-signature-timestamp': timestamp,
    }, secret);

    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('rejects a tampered body', () => {
    const timestamp = new Date().toISOString();
    const signature = sign('{"a":1}', timestamp, secret);

    const result = connector.verifyWebhookSignature(Buffer.from('{"a":2}'), {
      'x-zendesk-webhook-signature': signature,
      'x-zendesk-webhook-signature-timestamp': timestamp,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('rejects when the signature header is missing', () => {
    const result = connector.verifyWebhookSignature(Buffer.from('x'), {
      'x-zendesk-webhook-signature-timestamp': new Date().toISOString(),
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('rejects when the timestamp header is missing', () => {
    const result = connector.verifyWebhookSignature(Buffer.from('x'), {
      'x-zendesk-webhook-signature': 'sig',
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp');
  });

  it('rejects a stale timestamp (replay protection)', () => {
    const bodyStr = '{"a":1}';
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const signature = sign(bodyStr, oldTimestamp, secret);

    const result = connector.verifyWebhookSignature(Buffer.from(bodyStr), {
      'x-zendesk-webhook-signature': signature,
      'x-zendesk-webhook-signature-timestamp': oldTimestamp,
    }, secret);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too old');
  });

  it('returns invalid when secret is not configured', () => {
    const result = connector.verifyWebhookSignature(Buffer.from('x'), {
      'x-zendesk-webhook-signature': 'sig',
      'x-zendesk-webhook-signature-timestamp': new Date().toISOString(),
    }, '');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not configured');
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns the catalog event list with required properties', () => {
    const types = connector.getSupportedEventTypes();

    expect(types.length).toBeGreaterThan(0);
    expect(types.map((t) => t.eventType)).toContain('ticket.created');
    for (const t of types) {
      expect(typeof t.eventType).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(typeof t.description).toBe('string');
    }
  });
});

// ─── OAuth methods (webhook-only) ────────────────────────────

describe('OAuth methods', () => {
  it('authorize/handleCallback/refreshToken all reject (webhook-only)', async () => {
    await expect(connector.authorize()).rejects.toThrow('webhook-only');
    await expect(connector.handleCallback()).rejects.toThrow('webhook-only');
    await expect(connector.refreshToken()).rejects.toThrow('webhook-only');
  });

  it('testConnection reports healthy with a webhook-only note', async () => {
    const result = await connector.testConnection('');
    expect(result.healthy).toBe(true);
    expect(result.message).toContain('Webhook-only');
  });
});

// ─── extractEventInfo — every catalog event type maps cleanly ───

describe('extractEventInfo — full event-type coverage', () => {
  const cases: Array<[string, string]> = [
    ['ticket.created', 'Ticket Created'],
    ['ticket.updated', 'Ticket Updated'],
    ['ticket.solved', 'Ticket Solved'],
    ['ticket.closed', 'Ticket Closed'],
    ['user.created', 'User Created'],
    ['organization.created', 'Organization Created'],
    ['satisfaction_rating.created', 'CSAT Rating Received'],
  ];

  it.each(cases)('maps zen:event-type:%s → %s', (eventType, label) => {
    const result = connector.extractEventInfo({
      type: `zen:event-type:${eventType}`,
      detail: { id: '1' },
    });
    expect(result.eventType).toBe(eventType);
    expect(result.eventLabel).toBe(label);
  });

  it('falls back to payload.id for recordId when detail/subject are absent', () => {
    const result = connector.extractEventInfo({ type: 'zen:event-type:ticket.created', id: 'top-7' });
    expect(result.recordId).toBe('top-7');
  });

  it('prefers detail.id over subject and top-level id', () => {
    const result = connector.extractEventInfo({
      type: 'zen:event-type:ticket.created',
      detail: { id: 'detail-1' },
      subject: 'zen:ticket:subject-2',
      id: 'top-3',
    });
    expect(result.recordId).toBe('detail-1');
  });

  it('extracts actingUserEmail from detail.email or detail.requester.email', () => {
    expect(connector.extractEventInfo({
      type: 'zen:event-type:ticket.created', detail: { email: 'a@x.com' },
    }).actingUserEmail).toBe('a@x.com');

    expect(connector.extractEventInfo({
      type: 'zen:event-type:ticket.created', detail: { requester: { email: 'r@x.com' } },
    }).actingUserEmail).toBe('r@x.com');
  });

  it('carries envelope metadata (accountId, time, version)', () => {
    const result = connector.extractEventInfo({
      type: 'zen:event-type:ticket.created',
      account_id: 555,
      time: '2026-06-16T10:00:00Z',
      zendesk_event_version: '2022-11-06',
    });
    expect(result.metadata?.accountId).toBe(555);
    expect(result.metadata?.time).toBe('2026-06-16T10:00:00Z');
    expect(result.metadata?.zendeskEventVersion).toBe('2022-11-06');
  });
});

// ─── getSupportedEventTypes stays in sync with the catalog ──────

describe('getSupportedEventTypes ↔ catalog sync', () => {
  it('returns exactly the catalog supportedEvents', () => {
    const fromCatalog = (getAppTemplate('zendesk')?.supportedEvents ?? []).map((e) => e.eventType);
    const fromConnector = connector.getSupportedEventTypes().map((e) => e.eventType);
    expect(fromConnector).toEqual(fromCatalog);
    expect(fromConnector.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// PowerAutomateConnector imports only `crypto` + the (type-only) interface,
// so no env/logger mocks are needed.
import { PowerAutomateConnector } from '../../services/connectors/powerautomate.connector';

let connector: PowerAutomateConnector;

beforeEach(() => {
  connector = new PowerAutomateConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('lowercases the event and humanizes the label', () => {
    const result = connector.extractEventInfo({ event: 'Invoice.Approved', recordId: 'INV-1' });

    expect(result.eventType).toBe('invoice.approved');
    expect(result.eventLabel).toBe('Invoice Approved');
    expect(result.rawEventType).toBe('Invoice.Approved');
  });

  it('falls back to flow.triggered when no event field is present', () => {
    const result = connector.extractEventInfo({ foo: 'bar' });

    expect(result.eventType).toBe('flow.triggered');
    expect(result.eventLabel).toBe('Flow Triggered');
  });

  it('accepts eventType / event_type / type fallbacks', () => {
    expect(connector.extractEventInfo({ eventType: 'item.created' }).eventType).toBe('item.created');
    expect(connector.extractEventInfo({ event_type: 'item.updated' }).eventType).toBe('item.updated');
    expect(connector.extractEventInfo({ type: 'item.deleted' }).eventType).toBe('item.deleted');
  });

  it('resolves recordId from recordId / record_id / id / data.id', () => {
    expect(connector.extractEventInfo({ event: 'e', recordId: 'a' }).recordId).toBe('a');
    expect(connector.extractEventInfo({ event: 'e', record_id: 'b' }).recordId).toBe('b');
    expect(connector.extractEventInfo({ event: 'e', id: 'c' }).recordId).toBe('c');
    expect(connector.extractEventInfo({ event: 'e', data: { id: 'd' } }).recordId).toBe('d');
  });

  it('coerces a numeric recordId to a string', () => {
    const result = connector.extractEventInfo({ event: 'item.created', id: 12345 });
    expect(result.recordId).toBe('12345');
  });

  it('auto-generates a summary from label + recordId when none is given', () => {
    const result = connector.extractEventInfo({ event: 'invoice.approved', recordId: 'INV-1001' });
    expect(result.summary).toBe('Invoice Approved - INV-1001');
  });

  it('uses an explicit summary when provided', () => {
    const result = connector.extractEventInfo({ event: 'invoice.approved', summary: 'Custom summary' });
    expect(result.summary).toBe('Custom summary');
  });

  it('resolves actingUserEmail from userEmail / actingUserEmail / user.email', () => {
    expect(connector.extractEventInfo({ event: 'e', userEmail: 'a@b.com' }).actingUserEmail).toBe('a@b.com');
    expect(connector.extractEventInfo({ event: 'e', actingUserEmail: 'c@d.com' }).actingUserEmail).toBe('c@d.com');
    expect(connector.extractEventInfo({ event: 'e', user: { email: 'e@f.com' } }).actingUserEmail).toBe('e@f.com');
  });

  it('passes through data and flowName into metadata', () => {
    const result = connector.extractEventInfo({
      event: 'item.created',
      data: { amount: 4200 },
      flowName: 'Approve invoices',
    });
    expect(result.metadata?.data).toEqual({ amount: 4200 });
    expect(result.metadata?.flowName).toBe('Approve invoices');
  });
});

// ─── verifyWebhookSignature (basic auth — safety net, not used by app-webhook) ─

describe('verifyWebhookSignature', () => {
  const secret = 'baton-pa:s3cr3t';
  const goodHeader = 'Basic ' + Buffer.from('baton-pa:s3cr3t').toString('base64');

  it('accepts matching Basic Auth credentials', () => {
    const result = connector.verifyWebhookSignature(Buffer.from(''), { authorization: goodHeader }, secret);
    expect(result.valid).toBe(true);
  });

  it('rejects wrong credentials', () => {
    const badHeader = 'Basic ' + Buffer.from('baton-pa:wrong').toString('base64');
    const result = connector.verifyWebhookSignature(Buffer.from(''), { authorization: badHeader }, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid credentials');
  });

  it('rejects a missing / non-Basic Authorization header', () => {
    expect(connector.verifyWebhookSignature(Buffer.from(''), {}, secret).valid).toBe(false);
    expect(connector.verifyWebhookSignature(Buffer.from(''), { authorization: 'Bearer x' }, secret).valid).toBe(false);
  });

  it('rejects when the stored secret is not in username:password form', () => {
    const result = connector.verifyWebhookSignature(Buffer.from(''), { authorization: goodHeader }, 'no-colon');
    expect(result.valid).toBe(false);
  });

  it('supports colons inside the password', () => {
    const s = 'user:pa:ss:word';
    const header = 'Basic ' + Buffer.from('user:pa:ss:word').toString('base64');
    expect(connector.verifyWebhookSignature(Buffer.from(''), { authorization: header }, s).valid).toBe(true);
  });
});

// ─── getSupportedEventTypes ──────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('returns well-formed event type descriptors', () => {
    const types = connector.getSupportedEventTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(typeof t.eventType).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(typeof t.description).toBe('string');
    }
    expect(types.map((t) => t.eventType)).toContain('*');
  });
});

// ─── OAuth methods (webhook-only → throw) ────────────────────

describe('OAuth methods are not supported', () => {
  it('authorize throws', async () => {
    await expect(connector.authorize('org', 'user')).rejects.toThrow('webhook-only');
  });
  it('handleCallback throws', async () => {
    await expect(connector.handleCallback({ code: 'c', state: 's' })).rejects.toThrow('webhook-only');
  });
  it('refreshToken throws', async () => {
    await expect(connector.refreshToken('r')).rejects.toThrow('webhook-only');
  });
});

// ─── testConnection ──────────────────────────────────────────

describe('testConnection', () => {
  it('reports healthy (nothing to test for a webhook-only platform)', async () => {
    const result = await connector.testConnection('any');
    expect(result.healthy).toBe(true);
  });
});

// Keep the crypto import referenced (timingSafeEqual path is exercised above).
void crypto;

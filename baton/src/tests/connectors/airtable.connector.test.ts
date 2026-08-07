import { describe, it, expect, beforeEach } from 'vitest';

// AirtableConnector imports only `crypto` + the (type-only) interface,
// so no env/logger mocks are needed.
import { AirtableConnector } from '../../services/connectors/airtable.connector';

let connector: AirtableConnector;

beforeEach(() => {
  connector = new AirtableConnector();
});

// ─── extractEventInfo ────────────────────────────────────────

describe('extractEventInfo', () => {
  it('lowercases the event and humanizes the label', () => {
    const result = connector.extractEventInfo({ event: 'Record.Created', recordId: 'recABC' });

    expect(result.eventType).toBe('record.created');
    expect(result.eventLabel).toBe('Record Created');
    expect(result.rawEventType).toBe('Record.Created');
  });

  it('falls back to record.changed when no event field is present', () => {
    const result = connector.extractEventInfo({ foo: 'bar' });

    expect(result.eventType).toBe('record.changed');
    expect(result.eventLabel).toBe('Record Changed');
  });

  it('accepts eventType / event_type / type fallbacks', () => {
    expect(connector.extractEventInfo({ eventType: 'record.updated' }).eventType).toBe('record.updated');
    expect(connector.extractEventInfo({ event_type: 'form.submitted' }).eventType).toBe('form.submitted');
    expect(connector.extractEventInfo({ type: 'record.deleted' }).eventType).toBe('record.deleted');
  });

  it('resolves recordId from recordId / record_id / id / data.id', () => {
    expect(connector.extractEventInfo({ event: 'e', recordId: 'recA' }).recordId).toBe('recA');
    expect(connector.extractEventInfo({ event: 'e', record_id: 'recB' }).recordId).toBe('recB');
    expect(connector.extractEventInfo({ event: 'e', id: 'recC' }).recordId).toBe('recC');
    expect(connector.extractEventInfo({ event: 'e', data: { id: 'recD' } }).recordId).toBe('recD');
  });

  it('includes the table name in the auto-generated summary when provided', () => {
    const result = connector.extractEventInfo({ event: 'record.created', recordId: 'rec1', table: 'Vendors' });
    expect(result.summary).toBe('Record Created in Vendors — rec1');
    expect(result.metadata?.table).toBe('Vendors');
  });

  it('uses an explicit summary when provided', () => {
    const result = connector.extractEventInfo({ event: 'record.created', summary: 'Custom summary' });
    expect(result.summary).toBe('Custom summary');
  });

  it('extracts the acting user email and base metadata', () => {
    const result = connector.extractEventInfo({
      event: 'record.updated',
      userEmail: 'ops@example.com',
      base: 'appXYZ',
      data: { Name: 'Acme' },
    });
    expect(result.actingUserEmail).toBe('ops@example.com');
    expect(result.metadata?.base).toBe('appXYZ');
    expect(result.metadata?.data).toEqual({ Name: 'Acme' });
  });
});

// ─── verifyWebhookSignature (static token safety net) ────────

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{}');

  it('accepts a matching X-Baton-Token header', () => {
    const result = connector.verifyWebhookSignature(body, { 'x-baton-token': 'tok-123' }, 'tok-123');
    expect(result.valid).toBe(true);
  });

  it('rejects a wrong token', () => {
    const result = connector.verifyWebhookSignature(body, { 'x-baton-token': 'wrong' }, 'tok-123');
    expect(result.valid).toBe(false);
  });

  it('rejects a missing header', () => {
    const result = connector.verifyWebhookSignature(body, {}, 'tok-123');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('x-baton-token');
  });

  it('rejects when no secret is configured', () => {
    const result = connector.verifyWebhookSignature(body, { 'x-baton-token': 'tok-123' }, '');
    expect(result.valid).toBe(false);
  });
});

// ─── Webhook-only surface ────────────────────────────────────

describe('webhook-only OAuth methods', () => {
  it('authorize / handleCallback / refreshToken all throw', async () => {
    await expect(connector.authorize('org-1', 'user-1')).rejects.toThrow('webhook-only');
    await expect(connector.handleCallback({ code: 'c', state: 's' })).rejects.toThrow('webhook-only');
    await expect(connector.refreshToken('r')).rejects.toThrow('webhook-only');
  });

  it('testConnection reports healthy without an API call', async () => {
    const result = await connector.testConnection('unused');
    expect(result.healthy).toBe(true);
  });
});

// ─── Supported events ────────────────────────────────────────

describe('getSupportedEventTypes', () => {
  it('offers the documented record events plus the any-event wildcard', () => {
    const types = connector.getSupportedEventTypes().map((e) => e.eventType);
    expect(types).toContain('record.created');
    expect(types).toContain('record.updated');
    expect(types).toContain('record.matches_conditions');
    expect(types).toContain('form.submitted');
    expect(types).toContain('*');
  });
});

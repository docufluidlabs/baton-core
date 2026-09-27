/**
 * Webhook Event Service — what the stored copy keeps — Baton
 *
 * A stored event is a record of what arrived, read later in the Activity Log
 * and by whoever can read the table. By the time it is written the request has
 * been verified, so the credentials it arrived with have done their job and
 * must not be kept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { WEBHOOK_EVENTS: 'baton-webhook-events' },
}));
vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logDebug: vi.fn(), logError: vi.fn(), logWarn: vi.fn(),
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-event-uuid') }));

import { storeWebhookEvent } from '../../services/webhook-event.service';

/** The item written for the event itself (not the dedup marker). */
function storedEvent(): Record<string, any> {
  const put = mockSend.mock.calls
    .map(([cmd]) => cmd.input.Item)
    .find((item) => item?.id === 'test-event-uuid');
  if (!put) throw new Error('event was not written');
  return put;
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe('storeWebhookEvent — credentials', () => {
  it('masks Basic auth, API keys, tokens and cookies before writing', async () => {
    const returned = await storeWebhookEvent({
      platform: 'powerautomate' as any,
      payload: { event: 'flow.triggered' },
      headers: {
        authorization: 'Basic ' + Buffer.from('baton-pa:hunter2-hunter2').toString('base64'),
        'x-api-key': 'endpoint-key-123',
        'x-baton-token': 'shared-token-456',
        cookie: 'baton_session=abc',
        'content-type': 'application/json',
      },
      signatureValid: true,
    });

    const written = storedEvent();
    expect(written.headers).toEqual({
      authorization: 'Basic [REDACTED]',
      'x-api-key': '[REDACTED]',
      'x-baton-token': '[REDACTED]',
      cookie: '[REDACTED]',
      'content-type': 'application/json',
    });
    // The value handed back to the caller is the stored one.
    expect(returned.headers).toEqual(written.headers);

    const everything = JSON.stringify(mockSend.mock.calls.map(([cmd]) => cmd.input));
    expect(everything).not.toContain('hunter2');
    expect(everything).not.toContain(Buffer.from('baton-pa:hunter2-hunter2').toString('base64'));
    expect(everything).not.toContain('endpoint-key-123');
    expect(everything).not.toContain('shared-token-456');
  });

  it('masks headers the caller names as credentials for this source', async () => {
    await storeWebhookEvent({
      platform: 'airtable' as any,
      payload: { event: 'record.created' },
      headers: { 'x-shared-value': 'static-abc', 'user-agent': 'Airtable' },
      credentialHeaders: ['X-Shared-Value'],
    });

    expect(storedEvent().headers).toEqual({ 'x-shared-value': '[REDACTED]', 'user-agent': 'Airtable' });
  });

  it('keeps signatures and the headers that describe the delivery', async () => {
    const headers = {
      'x-zendesk-webhook-signature': 'c2ln',
      'x-zendesk-webhook-signature-timestamp': '2026-01-01T00:00:00Z',
      'x-baton-dispatch-id': 'dispatch-1',
      'content-type': 'application/json',
    };
    await storeWebhookEvent({ platform: 'zendesk' as any, payload: { id: 1 }, headers });

    expect(storedEvent().headers).toEqual(headers);
  });

  it('does not change the headers object the route goes on to use', async () => {
    const headers = { authorization: 'Basic abc', 'x-baton-sf-org-id': '00D1' };
    await storeWebhookEvent({ platform: 'salesforce' as any, payload: { id: 1 }, headers });

    expect(headers).toEqual({ authorization: 'Basic abc', 'x-baton-sf-org-id': '00D1' });
  });

  it('stores an event that has no headers', async () => {
    await storeWebhookEvent({ platform: 'docusign' as any, payload: { type: 'x' } });

    expect(storedEvent().headers).toBeUndefined();
  });
});

describe('storeWebhookEvent — Zoho CRM idempotency key', () => {
  const dedupKeys = () =>
    mockSend.mock.calls
      .map(([cmd]) => cmd.input.Item?.id as string)
      .filter((id) => id?.startsWith('dedup#'));

  it('builds the same key from a JSON array and from a form-post string', async () => {
    await storeWebhookEvent({
      platform: 'zohocrm' as any,
      payload: { org_id: '777', module: 'Deals', operation: 'insert', ids: ['202', '101'] },
    });
    await storeWebhookEvent({
      platform: 'zohocrm' as any,
      payload: { org_id: '777', module: 'Deals', operation: 'insert', ids: '202,101' },
    });

    expect(dedupKeys()).toEqual(['dedup#777:Deals:insert:101,202', 'dedup#777:Deals:insert:101,202']);
  });

  it('does not throw on a string `ids`, which a form post always sends', async () => {
    await expect(
      storeWebhookEvent({
        platform: 'zohocrm' as any,
        payload: { org_id: '777', module: 'Leads', operation: 'update', ids: '5' },
      }),
    ).resolves.toMatchObject({ id: 'test-event-uuid' });
  });

  it('leaves the order of ids in the stored payload as delivered', async () => {
    await storeWebhookEvent({
      platform: 'zohocrm' as any,
      payload: { org_id: '777', module: 'Deals', operation: 'insert', ids: ['202', '101'] },
    });

    expect(storedEvent().payload.ids).toEqual(['202', '101']);
  });

  it('stores without a key when there are no ids', async () => {
    await storeWebhookEvent({
      platform: 'zohocrm' as any,
      payload: { org_id: '777', module: 'Deals', operation: 'insert' },
    });

    expect(dedupKeys()).toEqual([]);
    expect(mockSend).toHaveBeenCalledOnce();
  });
});

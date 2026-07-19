import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { WEBHOOK_EVENTS: 'baton-webhook-events' },
}));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn(), logDebug: vi.fn(), logError: vi.fn() }));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-event-uuid') }));
vi.mock('../../lib/types', () => ({}));

import { storeWebhookEvent, markProcessed, getWebhookEvent, getRecentByPlatform } from '../../services/webhook-event.service';

beforeEach(() => {
  mockSend.mockReset();
});

describe('storeWebhookEvent', () => {
  it('creates record with processed=false and returns WebhookEvent', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await storeWebhookEvent({
      platform: 'docusign' as any,
      payload: { type: 'envelope.completed' },
    });

    expect(result.id).toBe('test-event-uuid');
    expect(result.platform).toBe('docusign');
    expect(result.processed).toBe(false);
    expect(result.payload).toEqual({ type: 'envelope.completed' });
    expect(result.receivedAt).toBeDefined();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('includes optional fields when provided (connectionId, headers, signatureValid)', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await storeWebhookEvent({
      platform: 'procore' as any,
      connectionId: 'conn-123',
      payload: { event: 'project.created' },
      headers: { 'x-procore-signature': 'abc' },
      signatureValid: true,
    });

    expect(result.connectionId).toBe('conn-123');
    expect(result.headers).toEqual({ 'x-procore-signature': 'abc' });
    expect(result.signatureValid).toBe(true);
  });
});

describe('markProcessed', () => {
  it('sets processed=true and processedAt without error', async () => {
    mockSend.mockResolvedValueOnce({});

    await markProcessed('event-1');

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Key).toEqual({ id: 'event-1' });
    expect(call.input.ExpressionAttributeValues[':processed']).toBe(true);
    expect(call.input.ExpressionAttributeValues[':processedAt']).toBeDefined();
    expect(call.input.ExpressionAttributeValues[':error']).toBeUndefined();
  });

  it('also sets error field when error is provided', async () => {
    mockSend.mockResolvedValueOnce({});

    await markProcessed('event-2', 'Something went wrong');

    const call = mockSend.mock.calls[0][0];
    expect(call.input.ExpressionAttributeValues[':error']).toBe('Something went wrong');
    expect(call.input.ExpressionAttributeValues[':processed']).toBe(true);
  });
});

describe('getWebhookEvent', () => {
  it('returns Item when found', async () => {
    const mockEvent = { id: 'event-1', platform: 'docusign', processed: false };
    mockSend.mockResolvedValueOnce({ Item: mockEvent });

    const result = await getWebhookEvent('event-1');
    expect(result).toEqual(mockEvent);
  });

  it('returns null when not found', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await getWebhookEvent('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getRecentByPlatform', () => {
  it('returns Items with default limit=20', async () => {
    const mockItems = [
      { id: 'e1', platform: 'xero' },
      { id: 'e2', platform: 'xero' },
    ];
    mockSend.mockResolvedValueOnce({ Items: mockItems });

    const result = await getRecentByPlatform('xero' as any);

    expect(result).toEqual(mockItems);
    const call = mockSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(20);
  });

  it('respects custom limit', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getRecentByPlatform('docusign' as any, 5);

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(5);
  });
});

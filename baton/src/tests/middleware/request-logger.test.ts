/**
 * Request Logger Tests — Baton
 *
 * The request line is written for every call, so whatever the URL carries ends
 * up in the log store. OAuth callbacks carry the authorization code and state
 * in their query string; Salesforce registration calls carry a bootstrap token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Request, Response } from 'express';

const { mockInfo, mockWarn, mockError } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: mockInfo, warn: mockWarn, error: mockError }),
}));

import { requestLogger } from '../../middleware/request-logger';

function run(originalUrl: string, statusCode = 200, path = originalUrl.split('?')[0]) {
  const req = {
    method: 'GET',
    originalUrl,
    path,
    ip: '203.0.113.7',
    headers: { 'user-agent': 'vitest' },
  } as unknown as Request;

  const res = Object.assign(new EventEmitter(), {
    statusCode,
    setHeader: vi.fn(),
  }) as unknown as Response & EventEmitter;

  const next = vi.fn();
  requestLogger(req, res, next);
  res.emit('finish');
  return { req, res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestLogger', () => {
  it('logs the request line and calls next', () => {
    const { next } = run('/api/instances?limit=50&status=running');

    expect(next).toHaveBeenCalledOnce();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/instances?limit=50&status=running', status: 200 }),
      'Request completed',
    );
  });

  it('masks the OAuth code and state of a connection callback', () => {
    run('/api/connections/docusign/callback?code=AUTHCODE123&state=STATE456');

    const [logData] = mockInfo.mock.calls[0];
    expect(logData.path).toBe('/api/connections/docusign/callback?code=[REDACTED]&state=[REDACTED]');
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('AUTHCODE123');
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('STATE456');
  });

  it('masks the bootstrap token of a Salesforce registration call, at every level', () => {
    run('/api/webhooks/rule/abc?bootstrap=BOOT-1', 401);
    run('/api/webhooks/rule/abc?bootstrap=BOOT-2', 500);

    expect(mockWarn.mock.calls[0][0].path).toBe('/api/webhooks/rule/abc?bootstrap=[REDACTED]');
    expect(mockError.mock.calls[0][0].path).toBe('/api/webhooks/rule/abc?bootstrap=[REDACTED]');
    const logged = JSON.stringify([...mockWarn.mock.calls, ...mockError.mock.calls]);
    expect(logged).not.toContain('BOOT-1');
    expect(logged).not.toContain('BOOT-2');
  });

  it('does not log health checks', () => {
    run('/health');
    run('/api/health');

    expect(mockInfo).not.toHaveBeenCalled();
  });

  it('replaces a malformed X-Request-Id with a fresh one', () => {
    const req = {
      method: 'GET', originalUrl: '/api/x', path: '/api/x', ip: '::1',
      headers: { 'x-request-id': 'bad id\nwith newline' },
    } as unknown as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn() }) as unknown as Response;

    requestLogger(req, res, vi.fn());

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

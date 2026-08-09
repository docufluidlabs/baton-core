/**
 * Dev auth bypass — gating regression suite — Baton
 *
 * requireAuth accepts an identity straight from X-Dev-UserId / X-Dev-OrgId /
 * X-Dev-Role headers with no credential at all. That is fine on a laptop and
 * catastrophic anywhere else, and it used to be gated on NODE_ENV === 'development'
 * alone — a value the shipped .env.example set, the Dockerfile never overrode,
 * and docker-compose did not pin. A default `docker compose up` therefore
 * exposed owner-level API access to anyone who sent three headers.
 *
 * The gate is now NODE_ENV === 'development' AND BATON_DEV_AUTH_BYPASS === 'true',
 * evaluated in env.ts. These tests pin both halves, and the role allowlist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { envState } = vi.hoisted(() => ({
  envState: { NODE_ENV: 'production', DEV_AUTH_BYPASS: false },
}));

vi.mock('../../env', () => ({ default: envState }));
vi.mock('../../lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  logWarn: vi.fn(), logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
}));
vi.mock('../../lib/request-context', () => ({
  requestContext: { getStore: () => undefined },
}));

import { requireAuth } from '../../middleware/auth';

const DEV_HEADERS = {
  'x-dev-userid': 'attacker',
  'x-dev-orgid': 'default-org',
  'x-dev-role': 'owner',
};

function makeReq(headers: Record<string, string>): Request {
  return { headers, path: '/api/dashboard' } as unknown as Request;
}

function run(headers: Record<string, string>) {
  const req = makeReq(headers);
  const next = vi.fn();
  requireAuth(req, {} as Response, next);
  return { req, next };
}

beforeEach(() => {
  envState.NODE_ENV = 'production';
  envState.DEV_AUTH_BYPASS = false;
});

describe('requireAuth dev bypass gating', () => {
  it('ignores dev headers when the bypass is off, even in development', () => {
    envState.NODE_ENV = 'development';
    envState.DEV_AUTH_BYPASS = false;

    const { req, next } = run(DEV_HEADERS);

    expect(req.auth).toBeUndefined();
    expect(next).not.toHaveBeenCalled(); // falls through to real session validation
  });

  it('ignores dev headers in production', () => {
    const { req, next } = run(DEV_HEADERS);

    expect(req.auth).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('honours dev headers only when both switches are on', () => {
    envState.NODE_ENV = 'development';
    envState.DEV_AUTH_BYPASS = true;

    const { req, next } = run(DEV_HEADERS);

    expect(req.auth).toEqual({ userId: 'attacker', orgId: 'default-org', role: 'owner' });
    expect(next).toHaveBeenCalled();
  });

  it('falls back to viewer for an unknown role rather than trusting the header', () => {
    envState.NODE_ENV = 'development';
    envState.DEV_AUTH_BYPASS = true;

    const { req } = run({ ...DEV_HEADERS, 'x-dev-role': 'superadmin' });

    expect(req.auth?.role).toBe('viewer');
  });

  it('defaults to viewer when no role header is sent', () => {
    envState.NODE_ENV = 'development';
    envState.DEV_AUTH_BYPASS = true;

    const { req } = run({ 'x-dev-userid': 'dev', 'x-dev-orgid': 'org' });

    expect(req.auth?.role).toBe('viewer');
  });

  it('does not activate on partial headers', () => {
    envState.NODE_ENV = 'development';
    envState.DEV_AUTH_BYPASS = true;

    const { req, next } = run({ 'x-dev-userid': 'dev' }); // no org id

    expect(req.auth).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});

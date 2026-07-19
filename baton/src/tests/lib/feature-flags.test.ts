/**
 * feature-flags — unit tests
 *
 * Covers:
 *  - PLAN_FEATURES + hasFeature  — new plan slugs and their feature unlocks
 *  - requireFeature(flag)        — middleware gate on capabilities
 *  - requireActiveSubscription() — middleware gate on subscription status
 *
 * The two middlewares are orthogonal:
 *   requireFeature      — "does the plan include this capability?"
 *   requireActiveSub    — "is the org currently allowed to spend money?"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

const mockSend = vi.fn();
vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: mockSend })),
  TableNames: { ORGANIZATIONS: 'organizations' },
}));

import {
  PLAN_FEATURES,
  hasFeature,
  getFeaturesForPlan,
  requireFeature,
  requireActiveSubscription,
} from '../../lib/feature-flags';
import { ForbiddenError } from '../../middleware/error-handler';
import type { Request, Response, NextFunction } from 'express';

// ─── Helpers ─────────────────────────────────────────────────

beforeEach(() => mockSend.mockReset());

function reqWithAuth(authOverrides: Record<string, any> = {}): Request {
  return {
    auth: { userId: 'user-1', orgId: 'org-1', role: 'admin', ...authOverrides },
  } as unknown as Request;
}

function reqWithoutAuth(): Request {
  return {} as Request;
}

function runMw(
  mw: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
  req: Request,
): Promise<Error | undefined> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: any) => resolve(err);
    Promise.resolve(mw(req, {} as Response, next)).catch(resolve);
  });
}

// ─── PLAN_FEATURES catalog ───────────────────────────────────

describe('PLAN_FEATURES', () => {
  it('contains all four new plans', () => {
    expect(Object.keys(PLAN_FEATURES).sort()).toEqual(
      ['enterprise', 'free_demo', 'growth', 'starter'],
    );
  });

  it('free_demo unlocks generous feature set (full trial experience)', () => {
    expect(PLAN_FEATURES.free_demo).toContain('audit_log');
    expect(PLAN_FEATURES.free_demo).toContain('custom_branding');
    expect(PLAN_FEATURES.free_demo).toContain('unlimited_connections');
  });

  it('starter has only basic features (no audit_log, no custom_branding)', () => {
    expect(PLAN_FEATURES.starter).toContain('api_access');
    expect(PLAN_FEATURES.starter).not.toContain('audit_log');
    expect(PLAN_FEATURES.starter).not.toContain('custom_branding');
    expect(PLAN_FEATURES.starter).not.toContain('sso');
  });

  it('growth unlocks audit_log + custom_branding + unlimited_connections + priority_support', () => {
    expect(PLAN_FEATURES.growth).toEqual(
      expect.arrayContaining([
        'audit_log', 'custom_branding', 'unlimited_connections', 'priority_support',
      ]),
    );
    // But not sso — that's enterprise-only
    expect(PLAN_FEATURES.growth).not.toContain('sso');
  });

  it('enterprise unlocks everything including SSO', () => {
    expect(PLAN_FEATURES.enterprise).toContain('sso');
    expect(PLAN_FEATURES.enterprise).toContain('audit_log');
    expect(PLAN_FEATURES.enterprise).toContain('priority_support');
  });
});

describe('hasFeature', () => {
  it('returns true when plan unlocks the feature', () => {
    expect(hasFeature('growth', 'audit_log')).toBe(true);
  });

  it('returns false when plan does not unlock the feature', () => {
    expect(hasFeature('starter', 'audit_log')).toBe(false);
  });

  it('returns false for unknown plan', () => {
    expect(hasFeature('mystery' as any, 'audit_log')).toBe(false);
  });
});

describe('getFeaturesForPlan', () => {
  it('returns the configured flag list', () => {
    expect(getFeaturesForPlan('starter')).toEqual(PLAN_FEATURES.starter);
  });
});

// ─── requireFeature middleware ───────────────────────────────

describe('requireFeature middleware', () => {
  it('passes when plan has the feature (uses cached plan from req.auth)', async () => {
    const req = reqWithAuth({ plan: 'growth' });
    const err = await runMw(requireFeature('audit_log'), req);
    expect(err).toBeUndefined();
    // Cached on req.auth: no DB read needed.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('forbids when plan lacks the feature', async () => {
    const req = reqWithAuth({ plan: 'starter' });
    const err = await runMw(requireFeature('audit_log'), req);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as Error).message).toContain('audit_log');
    expect((err as Error).message).toContain('starter');
  });

  it('reads plan from DB when not on req.auth', async () => {
    mockSend.mockResolvedValueOnce({ Item: { plan: 'growth' } });
    // Unique orgId — feature-flags caches by orgId across module lifetime,
    // so each "fall through to DB" test needs its own key.
    const req = reqWithAuth({ orgId: 'org-feature-db-1' });
    const err = await runMw(requireFeature('audit_log'), req);
    expect(err).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('forbids when no auth', async () => {
    const err = await runMw(requireFeature('audit_log'), reqWithoutAuth());
    expect(err).toBeInstanceOf(ForbiddenError);
  });
});

// ─── requireActiveSubscription middleware ────────────────────

describe('requireActiveSubscription middleware', () => {
  it('forbids when no auth', async () => {
    const err = await runMw(requireActiveSubscription(), reqWithoutAuth());
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('passes for enterprise unconditionally (manual contract)', async () => {
    const req = reqWithAuth({ plan: 'enterprise', subscriptionStatus: 'canceled' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
  });

  it('passes for free_demo with future trial', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const req = reqWithAuth({ plan: 'free_demo', trialEndsAt: future });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
  });

  it('forbids for free_demo with expired trial', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const req = reqWithAuth({ plan: 'free_demo', trialEndsAt: past });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as Error).message).toMatch(/trial/i);
  });

  it('passes when subscriptionStatus is active', async () => {
    const req = reqWithAuth({ plan: 'growth', subscriptionStatus: 'active' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
  });

  it('passes when subscriptionStatus is trialing', async () => {
    const req = reqWithAuth({ plan: 'starter', subscriptionStatus: 'trialing' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
  });

  it('passes when subscriptionStatus is past_due (grace period)', async () => {
    const req = reqWithAuth({ plan: 'growth', subscriptionStatus: 'past_due' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
  });

  it('forbids when subscriptionStatus is canceled', async () => {
    const req = reqWithAuth({ plan: 'growth', subscriptionStatus: 'canceled' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as Error).message).toMatch(/subscription is not active|update billing/i);
  });

  it('forbids when subscriptionStatus is paused_overcap (with cap-specific message)', async () => {
    const req = reqWithAuth({ plan: 'growth', subscriptionStatus: 'paused_overcap' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as Error).message).toMatch(/cap/i);
  });

  it('reads org billing from DB when not on req.auth', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { plan: 'growth', subscriptionStatus: 'active' },
    });
    // Unique orgId — feature-flags caches by orgId; reuse risks stale data.
    const req = reqWithAuth({ orgId: 'org-active-sub-db-1' });
    const err = await runMw(requireActiveSubscription(), req);
    expect(err).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

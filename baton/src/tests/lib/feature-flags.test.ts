/**
 * feature-flags — unit tests
 *
 * Open-core contract: the gates are pass-through shims. Every feature is
 * enabled and no subscription state is checked; the hosted edition replaces
 * these with plan-based enforcement.
 */
import { describe, it, expect } from 'vitest';

import {
  ALL_FEATURES,
  hasFeature,
  getFeatures,
  requireFeature,
  requireActiveSubscription,
} from '../../lib/feature-flags';
import type { Request, Response, NextFunction } from 'express';

// ─── Helpers ─────────────────────────────────────────────────

function runMw(
  mw: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
  req: Request,
): Promise<Error | undefined> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: any) => resolve(err);
    Promise.resolve(mw(req, {} as Response, next)).catch(resolve);
  });
}

// ─── Feature helpers ─────────────────────────────────────────

describe('hasFeature', () => {
  it('returns true for every known flag', () => {
    for (const flag of ALL_FEATURES) {
      expect(hasFeature(flag)).toBe(true);
    }
  });
});

describe('getFeatures', () => {
  it('returns the full feature list', () => {
    expect(getFeatures()).toEqual(ALL_FEATURES);
    expect(getFeatures()).toContain('audit_log');
    expect(getFeatures()).toContain('sso');
  });
});

// ─── Middleware shims ────────────────────────────────────────

describe('requireFeature middleware', () => {
  it('passes through without error for any flag', async () => {
    const err = await runMw(requireFeature('audit_log'), {} as Request);
    expect(err).toBeUndefined();
  });

  it('passes through even without auth (gating is a hosted-edition concern)', async () => {
    const err = await runMw(requireFeature('sso'), {} as Request);
    expect(err).toBeUndefined();
  });
});

describe('requireActiveSubscription middleware', () => {
  it('passes through without error', async () => {
    const err = await runMw(requireActiveSubscription(), {} as Request);
    expect(err).toBeUndefined();
  });
});

/**
 * Feature Flags — Baton
 *
 * Open-core shims: every feature is enabled and no subscription state is
 * checked. The hosted edition replaces these gates with plan-based
 * enforcement; route code stacks the same middleware either way.
 */

import { Request, Response, NextFunction } from 'express';

// ─── Flag Definitions ───────────────────────────────────────

export type FeatureFlag =
  | 'advanced_conditions'   // Complex rule conditions (regex, nested paths)
  | 'api_access'            // REST API for external integrations
  | 'custom_branding'       // White-label emails/notifications
  | 'audit_log'             // Full audit trail access
  | 'priority_support'      // Priority support channel
  | 'unlimited_connections' // No connection cap
  | 'sso';                  // SAML/SSO

export const ALL_FEATURES: FeatureFlag[] = [
  'advanced_conditions',
  'api_access',
  'custom_branding',
  'audit_log',
  'priority_support',
  'unlimited_connections',
  'sso',
];

// ─── Helpers ────────────────────────────────────────────────

/** Open core: every feature is enabled. */
export function hasFeature(_flag: FeatureFlag): boolean {
  return true;
}

/** Open core: the full feature list, unconditionally. */
export function getFeatures(): FeatureFlag[] {
  return ALL_FEATURES;
}

// ─── Middleware ──────────────────────────────────────────────

/**
 * Express middleware that gates a route behind a feature flag.
 * Open core: pass-through — everything is unlocked.
 */
export function requireFeature(_flag: FeatureFlag) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

/**
 * Express middleware that gates a route behind an active subscription.
 * Open core: pass-through — there is no subscription to check.
 */
export function requireActiveSubscription() {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

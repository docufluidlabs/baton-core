/**
 * Feature Flags — Baton
 *
 * Plan-based feature gating. Maps plan tiers to available features.
 * No external service needed — flags are derived from org plan.
 */

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Request, Response, NextFunction } from 'express';
import { getDocClient, TableNames } from '../db/client';
import { ForbiddenError } from '../middleware/error-handler';
import type { OrgPlan, SubscriptionStatus } from './types';

// ─── Flag Definitions ───────────────────────────────────────

export type FeatureFlag =
  | 'advanced_conditions'   // Complex rule conditions (regex, nested paths)
  | 'api_access'            // REST API for external integrations
  | 'custom_branding'       // White-label emails/notifications
  | 'audit_log'             // Full audit trail access
  | 'priority_support'      // Priority support channel
  | 'unlimited_connections' // No connection cap
  | 'sso';                  // SAML/SSO via Clerk

export const PLAN_FEATURES: Record<OrgPlan, FeatureFlag[]> = {
  // Free Demo unlocks everything for 14 days so prospects can fully evaluate.
  free_demo:  ['advanced_conditions', 'api_access', 'audit_log', 'custom_branding', 'unlimited_connections'],
  starter:    ['advanced_conditions', 'api_access'],
  growth:     ['advanced_conditions', 'api_access', 'audit_log', 'custom_branding', 'unlimited_connections', 'priority_support'],
  enterprise: ['advanced_conditions', 'api_access', 'audit_log', 'custom_branding', 'unlimited_connections', 'priority_support', 'sso'],
};

// ─── Helpers ────────────────────────────────────────────────

export function hasFeature(plan: OrgPlan, flag: FeatureFlag): boolean {
  return (PLAN_FEATURES[plan] || []).includes(flag);
}

export function getFeaturesForPlan(plan: OrgPlan): FeatureFlag[] {
  return PLAN_FEATURES[plan] || [];
}

// ─── Per-request plan cache (#17) ───────────────────────────
// Org plan changes at most monthly, but requireFeature was making a DynamoDB
// GetItem on EVERY gated request. We now use a short-TTL in-process cache
// so the hot path is a Map lookup (< 1µs) instead of a remote DB read.

interface CachedOrgBilling {
  plan: OrgPlan;
  subscriptionStatus?: SubscriptionStatus;
  trialEndsAt?: string;
  expiresAt: number;
}

const planCache = new Map<string, CachedOrgBilling>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getOrgBilling(
  orgId: string,
  reqAuth: { plan?: string; subscriptionStatus?: string; trialEndsAt?: string } | null | undefined,
): Promise<CachedOrgBilling> {
  // 1. Cheapest: already attached to req.auth by a prior middleware call
  if (reqAuth?.plan) {
    return {
      plan: reqAuth.plan as OrgPlan,
      subscriptionStatus: reqAuth.subscriptionStatus as SubscriptionStatus | undefined,
      trialEndsAt: reqAuth.trialEndsAt,
      expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
    };
  }

  // 2. In-process cache (avoids repeated DynamoDB reads within the TTL window)
  const cached = planCache.get(orgId);
  if (cached && Date.now() < cached.expiresAt) return cached;

  // 3. DynamoDB fallback (first request per org per 5-minute window)
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    ProjectionExpression: '#p, subscriptionStatus, trialEndsAt',
    ExpressionAttributeNames: { '#p': 'plan' },
  }));

  const fresh: CachedOrgBilling = {
    plan: (result.Item?.plan || 'free_demo') as OrgPlan,
    subscriptionStatus: result.Item?.subscriptionStatus as SubscriptionStatus | undefined,
    trialEndsAt: result.Item?.trialEndsAt,
    expiresAt: Date.now() + PLAN_CACHE_TTL_MS,
  };

  planCache.set(orgId, fresh);
  if (reqAuth) {
    reqAuth.plan = fresh.plan;
    reqAuth.subscriptionStatus = fresh.subscriptionStatus;
    reqAuth.trialEndsAt = fresh.trialEndsAt;
  }

  return fresh;
}


// ─── Middleware ──────────────────────────────────────────────

/**
 * Express middleware that gates a route behind a feature flag.
 * Returns 403 if the org's plan doesn't include the feature.
 *
 * #17: Uses a 5-minute in-process cache to avoid a DynamoDB read on every
 * gated request. Plan is also stored in req.auth so multiple requireFeature
 * calls in the same request chain share the same cached value.
 */
export function requireFeature(flag: FeatureFlag) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new ForbiddenError('Authentication required'));
    }

    try {
      const { plan } = await getOrgBilling(req.auth.orgId, req.auth);

      if (!hasFeature(plan, flag)) {
        return next(new ForbiddenError(
          `Feature '${flag}' requires a higher plan. Current plan: ${plan}`,
        ));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Express middleware that gates a route behind an active subscription.
 *
 * Orthogonal to requireFeature: that one checks "does the plan include this
 * capability?"; this one checks "is the org currently allowed to spend money?"
 *
 * Allowed when:
 *   - plan is enterprise (manual contract — never gated)
 *   - plan is free_demo and trialEndsAt is still in the future
 *   - subscriptionStatus is active, trialing, or past_due (past_due = grace period)
 *
 * Stack on rule/automation **create** routes only. Reads stay open so canceled
 * orgs can still view dashboards and update their billing.
 */
export function requireActiveSubscription() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new ForbiddenError('Authentication required'));
    }

    try {
      const billing = await getOrgBilling(req.auth.orgId, req.auth);

      // Enterprise contracts are never gated by status.
      if (billing.plan === 'enterprise') return next();

      // Free demo: gate by trial expiry rather than subscriptionStatus.
      if (billing.plan === 'free_demo') {
        if (billing.trialEndsAt && new Date(billing.trialEndsAt) > new Date()) {
          return next();
        }
        return next(new ForbiddenError(
          'Free trial has ended. Pick a plan in Settings → Billing to continue.',
        ));
      }

      // Paid plans: active / trialing / past_due (grace) all pass.
      const status = billing.subscriptionStatus;
      if (status === 'active' || status === 'trialing' || status === 'past_due') {
        return next();
      }

      const reason = status === 'paused_overcap'
        ? 'Your hard cap is reached. Raise it in Settings → Billing or wait for the cycle to reset.'
        : 'Subscription is not active. Update billing in Settings → Billing.';
      return next(new ForbiddenError(reason));
    } catch (error) {
      next(error);
    }
  };
}

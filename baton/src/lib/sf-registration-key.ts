/**
 * SF Registration Key Helpers — Baton
 *
 * HMAC secrets for the Salesforce managed package are persisted per
 * (sfOrgId, webhookKey) under `OrgApp.sfRegistrations`, using the composite
 * map key `<sfOrgId>#<webhookKey>`.
 *
 * Why composite: the Apex package caches one secret per webhookKey (per
 * automation rule), while the original backend keying stored one secret per
 * sfOrgId (shared across ALL rules of the app). With two rules under one app,
 * each rule's registration overwrote the other's secret → deterministic
 * HTTP 401 "Invalid signature" on the older rule's next dispatch, and the
 * Apex auto-heal could never recover (idempotent token replay returns the
 * original — now stale — secret). Composite keying makes the backend's unit
 * of storage match the package's unit of caching.
 *
 * Legacy entries keyed by bare `<sfOrgId>` (written before this fix) remain
 * readable as a fallback in `resolveSfRegistration` so existing installs keep
 * verifying until their next (re-)registration migrates them.
 *
 * '#' is safe as a separator: sfOrgId is alphanumeric (15/18 chars) and
 * webhookKey is 64 lowercase hex chars — neither can contain '#'.
 */

import { OrgApp } from './types';

export type SfRegistrationEntry = NonNullable<OrgApp['sfRegistrations']>[string];

/** Composite sfRegistrations map key: `<sfOrgId>#<webhookKey>`. */
export function sfRegKey(sfOrgId: string, webhookKey: string): string {
  return `${sfOrgId}#${webhookKey}`;
}

export interface ResolvedSfRegistration {
  entry: SfRegistrationEntry;
  /** The sfRegistrations map key the entry was found under. */
  key: string;
  /** true when resolved from a legacy bare `<sfOrgId>` entry. */
  isLegacy: boolean;
}

/**
 * Resolve the HMAC secret entry for an incoming SF webhook.
 * Precedence: composite `<sfOrgId>#<webhookKey>` → legacy bare `<sfOrgId>`.
 * Returns undefined when neither exists (caller should 401 so the Apex
 * auto-heal / re-registration path triggers).
 */
export function resolveSfRegistration(
  app: Pick<OrgApp, 'sfRegistrations'>,
  sfOrgId: string,
  webhookKey: string,
): ResolvedSfRegistration | undefined {
  const compositeKey = sfRegKey(sfOrgId, webhookKey);
  const composite = app.sfRegistrations?.[compositeKey];
  if (composite) {
    return { entry: composite, key: compositeKey, isLegacy: false };
  }
  const legacy = app.sfRegistrations?.[sfOrgId];
  if (legacy) {
    return { entry: legacy, key: sfOrgId, isLegacy: true };
  }
  return undefined;
}

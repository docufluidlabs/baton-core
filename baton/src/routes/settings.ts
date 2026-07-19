/**
 * Settings Routes — Baton
 * /api/settings — Organization settings, members, billing
 */
import { Router, Request, Response, NextFunction } from 'express';
import { GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  UpdateOrgInput,
  UpdateRoleInput,
  CheckoutInput,
  HardCapInput,
} from '../docs/schemas/settings';
import { requireAuth, getClerkClient } from '../middleware/auth';
import { requireAdmin, requireViewer } from '../middleware/rbac';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logError } from '../lib/logger';
import { NotFoundError } from '../middleware/error-handler';
import {
  PLAN_INFO,
  CHECKOUTABLE_PLANS,
  isCheckoutablePlan,
  planFromPriceId,
} from '../services/stripe.service';
import { projectChargeCents } from '../services/billing.service';
import { requireFeature } from '../lib/feature-flags';
import type { OrgPlan } from '../lib/types';
import env from '../env';

const router = Router();
router.use(requireAuth);

// Validation schemas live in src/docs/schemas/settings.ts.

// ─── GET /api/settings/org — Organization details ────────────

router.get('/org', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
    }));

    if (!result.Item) throw new NotFoundError('Organization');

    res.json({ organization: result.Item });
  } catch (e) { next(e); }
});

// ─── PATCH /api/settings/org — Update organization ───────────

router.patch('/org', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const updates = UpdateOrgInput.parse(req.body);
    const doc = getDocClient();

    const updateParts: string[] = ['updatedAt = :updatedAt'];
    const exprValues: Record<string, any> = { ':updatedAt': new Date().toISOString() };
    const exprNames: Record<string, string> = {};

    if (updates.name !== undefined) {
      updateParts.push('#name = :name');
      exprValues[':name'] = updates.name;
      exprNames['#name'] = 'name';
    }
    if (updates.timezone !== undefined) {
      updateParts.push('timezone = :tz');
      exprValues[':tz'] = updates.timezone;
    }
    if (updates.webhookRetryPolicy !== undefined) {
      updateParts.push('webhookRetryPolicy = :wrp');
      exprValues[':wrp'] = updates.webhookRetryPolicy;
    }
    if (updates.notificationEmail !== undefined) {
      updateParts.push('notificationEmail = :ne');
      exprValues[':ne'] = updates.notificationEmail;
    }
    await doc.send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
      ReturnValues: 'ALL_NEW',
    }));

    logInfo('Organization updated', { orgId, fields: Object.keys(updates) });
    res.json({ message: 'Organization updated' });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/members — List members ────────────────

router.get('/members', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.USERS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const members = (result.Items || []).map((user: any) => ({
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role || 'member',
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
    }));

    res.json({ members, total: members.length });
  } catch (e) { next(e); }
});

// ─── PATCH /api/settings/members/:id/role — Change role ──────

router.patch('/members/:id/role', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = UpdateRoleInput.parse(req.body);
    const memberId = req.params.id;
    const doc = getDocClient();

    // Prevent changing own role
    if (memberId === req.auth!.userId) {
      res.status(400).json({ error: 'Cannot change your own role' });
      return;
    }

    await doc.send(new UpdateCommand({
      TableName: TableNames.USERS,
      Key: { id: memberId },
      UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':role': role,
        ':updatedAt': new Date().toISOString(),
      },
      ExpressionAttributeNames: { '#role': 'role' },
      ConditionExpression: 'attribute_exists(id)',
    }));

    logInfo('Member role updated', { memberId, role, updatedBy: req.auth!.userId });
    res.json({ message: 'Role updated', memberId, role });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/billing — Billing info ────────────────

router.get('/billing', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const [orgResult, connectionsResult] = await Promise.all([
      doc.send(new GetCommand({
        TableName: TableNames.ORGANIZATIONS,
        Key: { id: orgId },
      })),
      doc.send(new QueryCommand({
        TableName: TableNames.PLATFORM_CONNECTIONS,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        ExpressionAttributeValues: { ':orgId': orgId },
        Select: 'COUNT',
      })),
    ]);

    const org = orgResult.Item || {};
    const plan = (org.plan || 'free_demo') as OrgPlan;
    const cfg = PLAN_INFO[plan] || PLAN_INFO.free_demo;
    const executionsUsed = org.executionsUsed || 0;
    const charge = projectChargeCents(plan, executionsUsed);
    const includedRelays = Number.isFinite(cfg.includedRelays) ? cfg.includedRelays : null;

    // Backfill trialEndsAt for orgs created before trial tracking was added.
    // Source order: DB.trialEndsAt → derive from DB.createdAt → derive from
    // Clerk org createdAt (self-heal: persist back so next call is fast).
    // The relay gate enforces limits independently — a derived end date is
    // purely cosmetic for the countdown banner.
    let trialEndsAt: string | null = org.trialEndsAt || null;
    if (!trialEndsAt && plan === 'free_demo' && cfg.trialDays > 0) {
      let createdAt: string | undefined = org.createdAt;

      // Clerk org id: prefer stored field, fall back to the request orgId which
      // is itself a Clerk id (DynamoDB primary key equals Clerk org id in this app).
      const clerkOrgId = org.clerkOrgId || orgId;
      if (!createdAt && clerkOrgId) {
        try {
          const clerk = await getClerkClient();
          if (clerk) {
            const clerkOrg = await clerk.organizations.getOrganization({ organizationId: clerkOrgId });
            if (clerkOrg?.createdAt) {
              createdAt = new Date(clerkOrg.createdAt).toISOString();
              await doc.send(new UpdateCommand({
                TableName: TableNames.ORGANIZATIONS,
                Key: { id: orgId },
                UpdateExpression: 'SET createdAt = if_not_exists(createdAt, :ca)',
                ExpressionAttributeValues: { ':ca': createdAt },
              }));
            }
          }
        } catch (err) {
          logError('Clerk org createdAt backfill failed', err as Error, { orgId });
        }
      }

      if (createdAt) {
        trialEndsAt = new Date(new Date(createdAt).getTime() + cfg.trialDays * 86_400_000).toISOString();
      }
    }

    res.json({
      billing: {
        plan,
        planName: cfg.name,
        subscriptionStatus: org.subscriptionStatus || (plan === 'free_demo' ? 'trialing' : 'active'),
        trialEndsAt,
        currentUsage: {
          relays: executionsUsed,
          successfulExecutions: org.successfulExecutions || 0,
          connections: connectionsResult.Count || 0,
        },
        includedRelays,
        overageEnabled: !!org.overageEnabled,
        overageRateCents: org.overageRateCents ?? cfg.overageRateCents,
        basePriceCents: cfg.basePriceCents,
        projectedCharge: charge,
        hardCap: org.hardCap ?? null,
        billingCycleStart: org.billingCycleStart || null,
        stripeCustomerId: org.stripeCustomerId ? '***' : null,
        hasStripe: !!org.stripeCustomerId,
      },
    });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/billing/plans — Available plans ──────────

router.get('/billing/plans', requireViewer, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Expose all plans for the UI plan-switcher; the checkout endpoint enforces
    // which ones can actually be purchased (free_demo + enterprise excluded).
    const plans = (Object.values(PLAN_INFO)).map((cfg) => ({
      slug: cfg.slug,
      name: cfg.name,
      basePriceCents: cfg.basePriceCents,
      includedRelays: Number.isFinite(cfg.includedRelays) ? cfg.includedRelays : null,
      overageRateCents: cfg.overageRateCents,
      checkoutable: CHECKOUTABLE_PLANS.includes(cfg.slug),
      features: cfg.features,
    }));
    res.json({ plans });
  } catch (e) { next(e); }
});

// ─── POST /api/settings/billing/portal — Stripe Customer Portal ──

router.post('/billing/portal', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
    }));

    const org = result.Item;
    if (!org?.stripeCustomerId) {
      res.status(400).json({ error: 'No Stripe customer associated with this organization' });
      return;
    }

    const { getStripe } = await import('../services/stripe.service');
    const stripe = getStripe();

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${req.headers.origin || env.FRONTEND_URL}/settings?tab=billing`,
    });

    res.json({ url: session.url });
  } catch (e) { next(e); }
});

// ─── POST /api/settings/billing/checkout — Stripe Checkout ──
//
// Accepts either { planSlug } (new) or { priceId } (legacy — one-release shim).
// Either way, we resolve to the (base, overage) price pair so the subscription
// always carries both: a licensed flat base + a graduated tiered metered price.

router.post('/billing/checkout', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const parsed = CheckoutInput.parse(req.body);
    const doc = getDocClient();

    // Resolve plan slug — prefer explicit, fall back to legacy priceId lookup.
    let planSlug = parsed.planSlug;
    if (!planSlug && parsed.priceId) {
      const resolved = planFromPriceId(parsed.priceId);
      if (resolved && isCheckoutablePlan(resolved)) {
        planSlug = resolved;
        logInfo('Deprecated priceId-based checkout call — resolve via planSlug going forward', {
          orgId, priceId: parsed.priceId, resolved,
        });
      } else {
        res.status(400).json({
          error: 'Unknown priceId. Use planSlug ("starter" | "growth") instead.',
        });
        return;
      }
    }
    if (!planSlug) {
      res.status(400).json({ error: 'Could not resolve plan' });
      return;
    }

    const cfg = PLAN_INFO[planSlug];
    if (!cfg.basePriceId || !cfg.overagePriceId) {
      res.status(500).json({
        error: `Stripe price IDs not configured for plan "${planSlug}". Set STRIPE_PRICE_${planSlug.toUpperCase()}_BASE and _OVERAGE.`,
      });
      return;
    }

    const [orgResult, userResult] = await Promise.all([
      doc.send(new GetCommand({
        TableName: TableNames.ORGANIZATIONS,
        Key: { id: orgId },
      })),
      doc.send(new GetCommand({
        TableName: TableNames.USERS,
        Key: { id: req.auth!.userId },
      })),
    ]);

    const org = orgResult.Item;
    const user = userResult.Item;
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const { getStripe } = await import('../services/stripe.service');
    const stripe = getStripe();

    const frontendUrl = req.headers.origin || env.FRONTEND_URL;

    const session = await stripe.checkout.sessions.create({
      customer: org.stripeCustomerId || undefined,
      customer_email: org.stripeCustomerId ? undefined : user?.email,
      // Two line items: flat licensed base (quantity 1) + metered overage
      // (no quantity — Stripe pulls usage from the meter at invoice close).
      line_items: [
        { price: cfg.basePriceId, quantity: 1 },
        { price: cfg.overagePriceId },
      ],
      mode: 'subscription',
      // Surface Stripe's native "Add promotion code" field. Coupons + codes
      // are managed entirely in the Stripe Dashboard — admin adds new codes
      // without code changes / redeploys.
      allow_promotion_codes: true,
      success_url: `${frontendUrl}/settings?tab=billing&checkout=success`,
      cancel_url: `${frontendUrl}/settings?tab=billing`,
      metadata: { orgId: org.id, planSlug },
      subscription_data: {
        metadata: { orgId: org.id, planSlug },
      },
    });

    res.json({ url: session.url });
  } catch (e) { next(e); }
});

// ─── PUT /api/settings/billing/hard-cap — set/clear opt-in hard cap ─

router.put('/billing/hard-cap', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const { hardCap } = HardCapInput.parse(req.body);
    const doc = getDocClient();

    await doc.send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: hardCap === null
        ? 'REMOVE hardCap SET updatedAt = :now'
        : 'SET hardCap = :hc, updatedAt = :now',
      ExpressionAttributeValues: hardCap === null
        ? { ':now': new Date().toISOString() }
        : { ':hc': hardCap, ':now': new Date().toISOString() },
    }));

    logInfo('Hard cap updated', { orgId, hardCap });
    res.json({ message: 'Hard cap updated', hardCap });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/audit — Audit log ─────────────────────

router.get('/audit', requireAdmin, requireFeature('audit_log'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.AUDIT_LOG,
      IndexName: 'orgId-createdAt-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }));

    res.json({ auditLog: result.Items || [], count: result.Count || 0 });
  } catch (e) { next(e); }
});

export default router;

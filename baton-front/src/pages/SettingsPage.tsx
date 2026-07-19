/**
 * Settings Page — Baton
 * Organization settings, members, billing, audit log
 */
import { useState, useEffect, useMemo } from 'react';
import { useOrganization } from '@clerk/clerk-react';
import { api, fetcher } from '@/lib/api';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Settings,
  CreditCard,
  Shield,
  Users,
  Save,
  Loader2,
  Crown,
  ExternalLink,
  Check,
  CheckCircle2,
  Sparkles,
  Hourglass,
} from 'lucide-react';
import clsx from 'clsx';
import { timeAgo, formatDateFull } from '@/lib/utils';
import { type BillingResponse, type BillingPlansResponse } from '@/hooks/useApi';
import { Modal } from '@/components/ui/Modal';

type Tab = 'general' | 'members' | 'billing' | 'audit';


export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'audit', label: 'Audit Log', icon: Shield },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto max-w-full">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              tab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'general' && <GeneralSettings />}
      {tab === 'members' && <MembersSettings />}
      {tab === 'billing' && <BillingSettings />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

// ─── General Settings ────────────────────────────────────────

interface OrgSettings { name: string; timezone: string; notificationEmail: string; }

function GeneralSettings() {
  const { data, isLoading } = useSWR<{ organization: OrgSettings }>('/settings/org', fetcher);
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OrgSettings>({ name: '', timezone: 'UTC', notificationEmail: '' });

  useEffect(() => {
    if (data?.organization) {
      const org = data.organization;
      setForm({
        name: org.name || '',
        timezone: org.timezone || 'UTC',
        notificationEmail: org.notificationEmail || '',
      });
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/settings/org', form);
      toast.success('Settings saved');
      mutate('/settings/org');
    } catch {
      // error shown by global handler
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-5">
      <Field label="Organization Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <Field
        label="Timezone"
        value={form.timezone}
        onChange={(v) => setForm({ ...form, timezone: v })}
        type="select"
        options={['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Kyiv']}
      />
      <Field
        label="Notification Email"
        value={form.notificationEmail}
        onChange={(v) => setForm({ ...form, notificationEmail: v })}
        placeholder="alerts@yourcompany.com"
      />
      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

// ─── Billing ─────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  trialing:        { label: 'Free trial',     tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  active:          { label: 'Active',         tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  past_due:        { label: 'Payment failed', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  canceled:        { label: 'Canceled',       tone: 'bg-gray-100 text-gray-700 border-gray-200' },
  paused_overcap:  { label: 'Hard cap reached', tone: 'bg-red-50 text-red-800 border-red-200' },
};

function fmtCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

function fmtNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function BillingSettings() {
  const { mutate } = useSWRConfig();
  const { data, isLoading } = useSWR<BillingResponse>('/settings/billing', fetcher);
  const { data: plansData } = useSWR<BillingPlansResponse>('/settings/billing/plans', fetcher);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  // Detect ?checkout=success on mount, open modal, scrub the query param.
  // We re-fetch billing data on a short retry loop because the Stripe webhook
  // that activates the subscription may land a beat after the redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;

    setSuccessOpen(true);
    params.delete('checkout');
    const newSearch = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`,
    );

    // Poll billing for up to ~6s in case webhook is slightly behind the redirect.
    let attempts = 0;
    const interval = setInterval(() => {
      mutate('/settings/billing');
      if (++attempts >= 6) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [mutate]);

  if (isLoading) return <SettingsSkeleton />;

  const billing = data?.billing;
  if (!billing) return <SettingsSkeleton />;

  const plans = (plansData?.plans || []).filter((p) => p.slug !== 'free_demo');
  const status = STATUS_LABEL[billing.subscriptionStatus] || STATUS_LABEL.active;

  async function openBillingPortal() {
    setPortalLoading(true);
    try {
      const result = await api.post<{ url: string }>('/settings/billing/portal');
      window.open(result.url, '_blank');
    } catch {
      // global error handler
    } finally {
      setPortalLoading(false);
    }
  }

  async function startCheckout(planSlug: string) {
    setCheckoutLoading(planSlug);
    try {
      const result = await api.post<{ url: string }>('/settings/billing/checkout', { planSlug });
      window.location.href = result.url;
    } catch {
      setCheckoutLoading(null);
    }
  }

  const trialDaysLeft =
    billing.plan === 'free_demo' && billing.trialEndsAt
      ? Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / 86_400_000)
      : null;

  const trialTier = (() => {
    if (trialDaysLeft === null) return null;
    if (trialDaysLeft < 0) return {
      container: 'bg-red-50 border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      title: 'text-red-900',
      headline: 'Your free trial has ended',
    };
    if (trialDaysLeft === 0) return {
      container: 'bg-red-50 border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      title: 'text-red-900',
      headline: 'Your free trial ends today',
    };
    if (trialDaysLeft === 1) return {
      container: 'bg-orange-50 border-orange-200',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      title: 'text-orange-900',
      headline: 'Your free trial ends tomorrow',
    };
    if (trialDaysLeft <= 3) return {
      container: 'bg-orange-50 border-orange-200',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      title: 'text-orange-900',
      headline: `${trialDaysLeft} days left in your free trial`,
    };
    if (trialDaysLeft <= 7) return {
      container: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      title: 'text-amber-900',
      headline: `${trialDaysLeft} days left in your free trial`,
    };
    return {
      container: 'bg-indigo-50 border-indigo-200',
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-600',
      title: 'text-indigo-900',
      headline: `${trialDaysLeft} days left in your free trial`,
    };
  })();

  return (
    <div className="max-w-4xl space-y-6">
      {/* Trial countdown banner */}
      {trialTier && (
        <div className={clsx('rounded-xl border p-4 flex items-center gap-3', trialTier.container)}>
          <div className={clsx('p-2.5 rounded-lg shrink-0', trialTier.iconBg)}>
            <Hourglass className={clsx('w-5 h-5', trialTier.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={clsx('text-sm font-semibold', trialTier.title)}>{trialTier.headline}</p>
            {billing.trialEndsAt && (
              <p className="text-xs text-gray-600 mt-0.5">
                Ends {formatDateFull(billing.trialEndsAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Current plan card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              <h3 className="text-sm font-semibold text-gray-900">Current Plan</h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-2xl font-bold text-gray-900">{billing.planName}</span>
              <span className={clsx('text-xs px-2.5 py-0.5 rounded-full font-medium border', status.tone)}>
                {status.label}
              </span>
            </div>
          </div>
          {billing.hasStripe && (
            <button
              onClick={openBillingPortal}
              disabled={portalLoading}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 whitespace-nowrap"
            >
              {portalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
              Manage Billing
            </button>
          )}
        </div>
      </div>

      {/* Usage + projected charge */}
      <UsageMeterCard billing={billing} />

      {/* Plan switcher */}
      {plans.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Plans</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {plans.map((p) => {
              const isCurrent = p.slug === billing.plan;
              const isContactPlan = !p.checkoutable;
              return (
                <div
                  key={p.slug}
                  className={clsx(
                    'rounded-xl border p-6 flex flex-col bg-white',
                    isCurrent ? 'border-brand-300 ring-1 ring-brand-200' : 'border-gray-200',
                  )}
                >
                  <h4 className="text-lg font-bold text-gray-900">{p.name}</h4>
                  <div className="mt-1 mb-4">
                    {isContactPlan ? (
                      <span className="text-3xl font-bold text-gray-900">Custom</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold text-gray-900">{fmtCents(p.basePriceCents)}</span>
                        <span className="text-sm ml-1 text-gray-500">/mo</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 mb-4">
                    <strong className="font-semibold text-gray-900">{p.includedRelays != null ? fmtNumber(p.includedRelays) : 'Unlimited'}</strong>
                    {' relays included'}
                    {p.overageRateCents > 0 && (
                      <>, then <strong className="font-semibold text-gray-900">{fmtCents(p.overageRateCents)}</strong> per relay</>
                    )}
                  </div>

                  <ul className="space-y-2 mb-6 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                        <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-brand-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <div className="text-center text-xs font-medium py-2.5 rounded-lg border text-brand-600 border-brand-200 bg-brand-50">
                      Current plan
                    </div>
                  ) : isContactPlan ? (
                    <div className="text-center text-xs font-medium py-2.5 rounded-lg border text-gray-500 border-gray-200 bg-gray-50">
                      Contact us
                    </div>
                  ) : (
                    <button
                      onClick={() => startCheckout(p.slug)}
                      disabled={checkoutLoading !== null}
                      className="flex items-center justify-center gap-1.5 text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors bg-brand-600 text-white hover:bg-brand-700"
                    >
                      {checkoutLoading === p.slug && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {billing.hasStripe ? 'Switch to ' + p.name : 'Get started'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Have a promo code? Enter it on the Stripe Checkout page after clicking{' '}
            {billing.hasStripe ? 'Switch' : 'Get started'}.
          </p>
        </div>
      )}

      {/* Hard cap toggle */}
      <HardCapCard
        billing={billing}
        onSaved={() => mutate('/settings/billing')}
      />

      <CheckoutSuccessModal
        open={successOpen}
        onClose={() => setSuccessOpen(false)}
        billing={billing}
      />
    </div>
  );
}

function CheckoutSuccessModal({
  open,
  onClose,
  billing,
}: {
  open: boolean;
  onClose: () => void;
  billing: BillingResponse['billing'];
}) {
  // While the webhook is still en route, billing.subscriptionStatus may still
  // read as the pre-checkout value. Show a softer "Processing…" state then.
  const pending =
    billing.subscriptionStatus !== 'active' && billing.subscriptionStatus !== 'trialing';

  return (
    <Modal open={open} onClose={onClose} title="" className="max-w-md">
      <div className="text-center py-2">
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
          {pending ? (
            <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
          ) : (
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          )}
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center justify-center gap-1.5">
          {pending ? 'Finalizing…' : (
            <>
              <Sparkles className="w-5 h-5 text-amber-500" />
              Welcome to {billing.planName}
            </>
          )}
        </h2>

        {pending ? (
          <p className="text-sm text-gray-600 mb-5">
            Your payment went through. We're activating your subscription — this usually takes a few seconds.
          </p>
        ) : (
          <p className="text-sm text-gray-600 mb-5">
            Your subscription is active. You're all set to keep routing relays.
          </p>
        )}

        {!pending && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-5 text-left">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600">Plan</span>
              <span className="font-medium text-gray-900">{billing.planName}</span>
            </div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600">Base price</span>
              <span className="font-medium text-gray-900">{fmtCents(billing.basePriceCents)} / mo</span>
            </div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-600">Included relays</span>
              <span className="font-medium text-gray-900">
                {billing.includedRelays != null ? fmtNumber(billing.includedRelays) : 'Unlimited'}
              </span>
            </div>
            {billing.overageRateCents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Overage</span>
                <span className="font-medium text-gray-900">
                  {fmtCents(billing.overageRateCents)} / relay
                </span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full text-sm font-semibold py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          {pending ? 'Got it' : 'Start using Baton'}
        </button>
      </div>
    </Modal>
  );
}

function UsageMeterCard({ billing }: { billing: BillingResponse['billing'] }) {
  const used = billing.currentUsage.relays;
  const included = billing.includedRelays;
  const overage = included != null ? Math.max(0, used - included) : 0;
  const charge = billing.projectedCharge;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Relays this cycle</h3>
        <span className="text-sm font-medium text-gray-900">
          {fmtNumber(used)}{included != null ? ` / ${fmtNumber(included)}` : ''}
        </span>
      </div>
      <UsageBar
        used={used}
        total={included ?? Infinity}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-sm">
        <div>
          <div className="text-xs text-gray-500">Base</div>
          <div className="font-medium text-gray-900">{fmtCents(charge.baseCents)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">
            Overage ({fmtNumber(overage)} × {fmtCents(billing.overageRateCents)})
          </div>
          <div className="font-medium text-gray-900">{fmtCents(charge.overageCents)}</div>
        </div>
        <div className="sm:text-right">
          <div className="text-xs text-gray-500">Projected charge</div>
          <div className="font-semibold text-gray-900">{fmtCents(charge.totalCents)}</div>
        </div>
      </div>
    </div>
  );
}

function HardCapCard({
  billing,
  onSaved,
}: {
  billing: BillingResponse['billing'];
  onSaved: () => void;
}) {
  const { hardCap: currentCap, basePriceCents, overageRateCents, includedRelays } = billing;

  // Hard cap is meaningful only on plans that actually have a metered overage.
  // free_demo / enterprise are exempt → cap can't be translated into $.
  const hasOverage = overageRateCents > 0 && includedRelays !== null;

  // Convert the existing stored cap (relay count) back into an overage-only
  // $ amount so the input pre-fills with what's currently set.
  const initialDollar = useMemo(() => {
    if (currentCap === null || !hasOverage) return '';
    const overageRelays = Math.max(0, currentCap - (includedRelays || 0));
    const overageCents = overageRelays * overageRateCents;
    return (overageCents / 100).toFixed(2);
  }, [currentCap, overageRateCents, includedRelays, hasOverage]);

  const [enabled, setEnabled] = useState(currentCap !== null);
  const [dollarValue, setDollarValue] = useState<string>(initialDollar);
  const [saving, setSaving] = useState(false);

  // Input represents the overage budget on top of the plan base — how much
  // extra the org is willing to spend before automations pause.
  const dollarsTyped = parseFloat(dollarValue) || 0;
  const overageBudgetCents = Math.max(0, Math.round(dollarsTyped * 100));
  const overageRelays = hasOverage ? Math.floor(overageBudgetCents / overageRateCents) : 0;
  const totalRelays = (includedRelays || 0) + overageRelays;
  const effectiveOverageCents = overageRelays * overageRateCents;
  const effectiveTotalCents = basePriceCents + effectiveOverageCents;

  async function save() {
    setSaving(true);
    try {
      let hardCap: number | null = null;
      if (enabled) {
        if (!dollarValue || dollarsTyped <= 0) {
          toast.error('Enter a positive amount');
          setSaving(false);
          return;
        }
        hardCap = totalRelays;
      }
      await api.put('/settings/billing/hard-cap', { hardCap });
      toast.success(
        hardCap === null
          ? 'Hard cap removed'
          : `Cap set to ${fmtCents(effectiveOverageCents)} overage / cycle (~${fmtNumber(totalRelays)} relays)`,
      );
      onSaved();
    } catch {
      // global handler
    } finally {
      setSaving(false);
    }
  }

  // Exempt plans: render the card but disable the controls with an explanation.
  if (!hasOverage) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Hard cap</h3>
        <p className="text-xs text-gray-500">
          {billing.plan === 'free_demo'
            ? "Hard caps apply once you're on a paid plan. During the free trial there's nothing to cap."
            : 'Your plan is exempt from metered billing — no cap needed.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">Hard cap</h3>
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-gray-300"
          />
          Enable
        </label>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Set a maximum overage spend per cycle, on top of your <strong>{fmtCents(basePriceCents)}</strong> plan base.
        When overage charges reach this budget, new automations are paused until the cycle resets or the cap is raised.
        Off by default — without a cap, overage simply continues to bill at your plan rate.
      </p>
      {enabled && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={dollarValue}
                onChange={(e) => setDollarValue(e.target.value)}
                placeholder={(overageRateCents * 100 / 100).toFixed(0)}
                className="w-32 pl-6 pr-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </div>
            <span className="text-xs text-gray-500">/ cycle (overage budget)</span>
          </div>

          {dollarsTyped > 0 && (
            <div className="rounded-lg p-3 text-xs bg-gray-50 text-gray-700">
              ≈ <strong className="text-gray-900">{fmtNumber(totalRelays)}</strong> relays / cycle at this budget
              <div className="text-gray-500 mt-1">
                {fmtNumber(includedRelays || 0)} included + {fmtNumber(overageRelays)} overage × {fmtCents(overageRateCents)} = <strong className="text-gray-700">{fmtCents(effectiveOverageCents)}</strong> overage
                {' · total bill ≤ '}
                <strong className="text-gray-700">{fmtCents(effectiveTotalCents)}</strong>
              </div>
              {effectiveOverageCents < overageBudgetCents && (
                <div className="text-gray-400 mt-0.5">
                  ({fmtCents(overageBudgetCents - effectiveOverageCents)} unused — overage charges in whole-relay increments.)
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isHigh = pct > 80;

  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={clsx('h-full rounded-full transition-all', isHigh ? 'bg-red-500' : 'bg-brand-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Members ─────────────────────────────────────────────────

function MembersSettings() {
  const { memberships, isLoaded } = useOrganization({ memberships: true });
  const items = memberships?.data ?? [];
  const count = memberships?.count ?? 0;

  if (!isLoaded) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-4xl">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Members</h3>
          <p className="text-xs text-gray-500 mt-0.5">People with access to this organization.</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">{count} member{count !== 1 ? 's' : ''}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 px-6 py-8 text-center">No members found.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {items.map((m) => {
            const ud = m.publicUserData;
            const firstName = ud?.firstName ?? '';
            const lastName = ud?.lastName ?? '';
            const identifier = ud?.identifier ?? '';
            const displayName = [firstName, lastName].filter(Boolean).join(' ') || identifier;
            const initials = [firstName[0], lastName[0]].filter(Boolean).join('').toUpperCase() || identifier[0]?.toUpperCase() || '?';
            const isAdmin = m.role === 'org:admin';
            return (
              <div key={m.id} className="flex items-center gap-4 px-6 py-3.5">
                {ud?.imageUrl ? (
                  <img src={ud.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {initials}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                  <p className="text-xs text-gray-500 truncate">{identifier}</p>
                </div>
                <span className={clsx(
                  'text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0',
                  isAdmin ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-600',
                )}>
                  {m.roleName || (isAdmin ? 'Admin' : 'Member')}
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">
                  {timeAgo(m.createdAt.toISOString())}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log ───────────────────────────────────────────────

interface AuditEntry { id: string; action: string; entityType: string; userId?: string; createdAt: string; metadata?: Record<string, unknown>; }

function AuditLog() {
  const { data, isLoading } = useSWR<{ auditLog: AuditEntry[] }>('/settings/audit', fetcher);

  const entries = data?.auditLog || [];

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-4xl">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Audit Log</h3>
        <p className="text-xs text-gray-500 mt-0.5">Recent actions performed in your organization.</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 px-6 py-8 text-center">No audit entries yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-4 px-6 py-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">
                  <span className="font-medium">{entry.action}</span>{' '}
                  <span className="text-gray-500">on {entry.entityType}</span>
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap" title={formatDateFull(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'select';
  options?: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {type === 'select' && options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-brand-500"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
        />
      )}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl animate-pulse">
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-10 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}


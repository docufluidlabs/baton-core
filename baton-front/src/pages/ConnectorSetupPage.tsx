/**
 * Connector Setup Page — Baton
 *
 * Generic, in-app install + onboarding guide for any webhook connector in the
 * catalog (HubSpot, Zoho CRM, Zendesk, Greenhouse, monday.com, BambooHR, …).
 * It mirrors the bespoke Salesforce Setup page, but is data-driven: every
 * connector renders the same walkthrough (get a Baton webhook URL → configure
 * the webhook in the external platform → send a test event), built from the
 * platform's catalog template (`/platforms/catalog`).
 *
 * Route: /setup/:slug. Salesforce keeps its own bespoke setup page at
 * /salesforce-setup, so /setup/salesforce redirects there.
 */
import { useParams, Navigate, Link } from 'react-router-dom';
import {
  Link2,
  Settings,
  Webhook,
  KeyRound,
  MousePointerClick,
  PlayCircle,
  ListChecks,
  LifeBuoy,
  GitBranch,
  Plug,
  ArrowLeft,
} from 'lucide-react';
import { usePlatformTemplates, type PlatformTemplate } from '@/hooks/useApi';
import { PlatformIcon, PLATFORM_BRAND_COLORS } from '@/components/ui/PlatformIcon';

export default function ConnectorSetupPage() {
  const { slug = '' } = useParams();
  const { data, isLoading } = usePlatformTemplates();

  // Salesforce has its own bespoke setup guide.
  if (slug === 'salesforce') return <Navigate to="/salesforce-setup" replace />;

  const template = data?.templates.find((t) => t.slug === slug);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading setup guide…</div>;
  }

  if (!template) return <NotFound slug={slug} />;

  return <Guide template={template} />;
}

function Guide({ template }: { template: PlatformTemplate }) {
  const { name, slug, description, category } = template;
  const accent = PLATFORM_BRAND_COLORS[slug] ?? '#0077b0';

  // Secret model — inferred from the catalog labels (the catalog endpoint never
  // exposes the raw verification method).
  const isBasicAuth = !!(template.secretUsernameLabel || template.secretPasswordLabel);
  const hasNoSecret = /no secret/i.test(template.secretKeyLabel);

  // Build the numbered walkthrough: a Baton-side "get your webhook URL" step,
  // the external-platform steps from the catalog, then a test step.
  const steps: { title: string; body: React.ReactNode; icon: typeof Link2 }[] = [
    {
      title: 'Get your Baton webhook URL',
      icon: Link2,
      body: (
        <>
          In Baton open{' '}
          <Link to="/flows" className="text-brand-600 font-medium hover:text-brand-700">
            Flow Builder
          </Link>{' '}
          → <strong>New Automation</strong>, set <strong>Source = {name}</strong>, fill in the name
          and workflow, then <strong>Save</strong>. Copy the generated <strong>Webhook URL</strong> -
          you'll paste it into {name} in the next steps.
        </>
      ),
    },
    ...template.setupInstructions.map((s, i) => ({
      title: s.title,
      icon: STEP_ICONS[i % STEP_ICONS.length],
      body: <>{s.description}</>,
    })),
    {
      title: 'Send a test event',
      icon: PlayCircle,
      body: (
        <>
          Trigger one of the events below in {name} (for example, create or update a record). Within
          a few seconds it shows up in Baton's event log and any matching automation runs.
        </>
      ),
    },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to="/connections"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Connections
      </Link>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
          style={{ backgroundColor: `${accent}1a` }}
        >
          <PlatformIcon platform={slug} size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{name} Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">How Baton connects to {name}</h2>
          {category && (
            <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-brand-700 bg-brand-50 rounded-full">
              {category}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 max-w-2xl leading-relaxed">
          Baton receives {name} events through a <strong>webhook</strong>. You set it up once: create
          an automation in Baton to get a unique Webhook URL, then register that URL in {name} and
          choose which events should fire it. After that, every matching event flows straight into
          your automations.
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/flows"
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors"
          >
            <GitBranch className="w-4 h-4" />
            Create an automation
          </Link>
          <Link
            to="/connections"
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plug className="w-4 h-4" />
            Manage connections
          </Link>
        </div>

        {/* Secret model note */}
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5">
          <KeyRound className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            {hasNoSecret ? (
              <>
                {name} doesn't sign its webhook payloads - <strong>no secret to configure</strong>.
                Baton accepts events on the unique, hard-to-guess Webhook URL.
              </>
            ) : isBasicAuth ? (
              <>
                {name} authenticates with <strong>Basic Authentication</strong>. Pick a{' '}
                {template.secretUsernameLabel ?? 'username'} and{' '}
                {template.secretPasswordLabel ?? 'password'} and enter the <strong>same values</strong>{' '}
                in both Baton and {name} so Baton can verify each request.
              </>
            ) : (
              <>
                Copy the <strong>{template.secretKeyLabel}</strong> from {name} into Baton so it can
                verify every payload. {template.secretKeyHint}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Step-by-step</h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <Step key={i} n={i + 1} icon={s.icon} title={s.title} accent={accent}>
              {s.body}
            </Step>
          ))}
        </ol>
      </div>

      {/* Supported events */}
      {template.supportedEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Events you can trigger on</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {template.supportedEvents.map((e) => (
              <div key={e.eventType} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{e.label}</p>
                  <code className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                    {e.eventType}
                  </code>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{e.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Troubleshooting */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
          <LifeBuoy className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Troubleshooting</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {troubleshooting(name, { isBasicAuth, hasNoSecret, secretKeyLabel: template.secretKeyLabel }).map(
            (row) => (
              <div key={row.symptom} className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-4 px-6 py-3">
                <p className="text-sm font-medium text-gray-900">{row.symptom}</p>
                <p className="text-sm text-gray-600">{row.fix}</p>
              </div>
            ),
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Need a hand? Email{' '}
        <a href="mailto:app-support@fluidlabs.com" className="text-brand-600 hover:text-brand-700">
          app-support@fluidlabs.com
        </a>
        .
      </p>
    </div>
  );
}

const STEP_ICONS = [Settings, MousePointerClick, Webhook, KeyRound] as const;

function troubleshooting(
  name: string,
  opts: { isBasicAuth: boolean; hasNoSecret: boolean; secretKeyLabel: string },
): { symptom: string; fix: string }[] {
  const rows: { symptom: string; fix: string }[] = [
    {
      symptom: `${name} reports the webhook failed (non-2xx response)`,
      fix: 'The automation may be paused or the Webhook URL has a typo - re-copy the URL from the automation in Baton and make sure the automation is Active.',
    },
    {
      symptom: `An event happened in ${name} but nothing arrived in Baton`,
      fix: `Make sure the webhook in ${name} is enabled and subscribed to that event type (see the list above).`,
    },
  ];

  if (!opts.hasNoSecret) {
    rows.push(
      opts.isBasicAuth
        ? {
            symptom: 'Baton returns 401 Unauthorized',
            fix: `The Basic Auth username / password in ${name} doesn't match what you entered in Baton - re-enter the same values in both.`,
          }
        : {
            symptom: 'Baton returns 401 Invalid signature',
            fix: `The ${opts.secretKeyLabel} in Baton doesn't match the one in ${name} - re-copy it and save again.`,
          },
    );
  }

  rows.push({
    symptom: "Events arrive but the automation doesn't run",
    fix: 'Confirm the automation is Active and its trigger conditions match the record you changed.',
  });

  return rows;
}

function Step({
  n,
  icon: Icon,
  title,
  accent,
  children,
}: {
  n: number;
  icon: typeof Link2;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 bg-white rounded-xl border border-gray-200 p-5">
      <div
        className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        {n}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4 text-gray-400 shrink-0" />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

function NotFound({ slug }: { slug: string }) {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <Link
        to="/connections"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Connections
      </Link>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-lg font-semibold text-gray-900">No setup guide for “{slug}”</h1>
        <p className="text-sm text-gray-500 mt-1">
          This connector isn't in the catalog. If you think this is a mistake, email{' '}
          <a href="mailto:app-support@fluidlabs.com" className="text-brand-600 hover:text-brand-700">
            app-support@fluidlabs.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}

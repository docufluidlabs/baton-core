/**
 * Salesforce Setup Page — Baton
 *
 * In-app install + onboarding guide for the "Baton for Salesforce" managed
 * package. Gives admins a one-click install link for the current package
 * version and a step-by-step walkthrough (assign permission set → create a
 * webhook URL in Baton → build the Flow → test the trigger), plus a
 * troubleshooting cheat-sheet. Mirrors sf-managed-package-baton/QUICKSTART.md.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Cloud,
  Download,
  Copy,
  Check,
  ExternalLink,
  UserCheck,
  Link2,
  Workflow,
  PlayCircle,
  LifeBuoy,
} from 'lucide-react';
import clsx from 'clsx';
import {
  SF_PACKAGE_VERSION,
  SF_PERMISSION_SET,
  SF_BATON_HOST,
  sfInstallUrl,
  type SfOrgEnv,
} from '@/lib/salesforcePackage';

export default function SalesforceSetupPage() {
  const [env, setEnv] = useState<SfOrgEnv>('production');
  const [copied, setCopied] = useState(false);
  const installUrl = sfInstallUrl(env);

  async function copyInstallUrl() {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      toast.success('Install URL copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — copy the URL manually');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#00A1E0]/10 text-[#00A1E0] shrink-0">
          <Cloud className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Salesforce Setup</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Install the Baton managed package and connect Salesforce Flows as an automation source.
          </p>
        </div>
      </div>

      {/* Install card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Baton for Salesforce</h2>
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-brand-700 bg-brand-50 rounded-full">
                v{SF_PACKAGE_VERSION}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-lg leading-relaxed">
              Adds a <strong>Send to Baton</strong> action to Flow Builder. Install into the org
              you want to connect — you must be a <strong>System Administrator</strong>.
            </p>
          </div>

          {/* Production / Sandbox toggle */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg shrink-0">
            {(['production', 'sandbox'] as SfOrgEnv[]).map((e) => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
                  env === e ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Install URL + actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Install in Salesforce
            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </a>
          <button
            onClick={copyInstallUrl}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy URL'}
          </button>
        </div>

        <code className="block w-full text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 break-all">
          {installUrl}
        </code>

        <p className="text-xs text-gray-400">
          Log into the target {env} org in this browser first, then choose{' '}
          <strong className="text-gray-500">Install for Admins Only</strong>. If prompted, allow access to{' '}
          <span className="text-gray-500">{SF_BATON_HOST}</span>.
        </p>
      </div>

      {/* Steps */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">After installing</h2>
        <ol className="space-y-3">
          <Step
            n={1}
            icon={UserCheck}
            title={`Assign the “${SF_PERMISSION_SET}” permission set`}
          >
            In Salesforce: <Path>Setup → Permission Sets → {SF_PERMISSION_SET} → Manage Assignments → Add Assignment</Path>.
            Add every user who runs Flows that dispatch to Baton (usually all sales / service).
          </Step>

          <Step n={2} icon={Link2} title="Create a webhook URL in Baton">
            Open{' '}
            <Link to="/flows" className="text-brand-600 font-medium hover:text-brand-700">
              Flow Builder
            </Link>{' '}
            → <strong>New Automation</strong>, set <strong>Source = Salesforce</strong>, fill in the name and
            workflow, then <strong>Save</strong>. Copy the generated <strong>Webhook URL</strong> — it already
            contains a one-time bootstrap token, so no secret is entered manually.
          </Step>

          <Step n={3} icon={Workflow} title="Build the Flow">
            In Salesforce open <Path>Setup → Flows</Path>. Clone the bundled{' '}
            <em>“Sample — Send Opportunity to Baton”</em> template (or create a Record-Triggered Flow), add the{' '}
            <strong>Send to Baton</strong> action, set <strong>Webhook URL</strong> to the URL from step 2 and{' '}
            <strong>Record ID</strong> to <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{!$Record.Id}'}</code>,
            then <strong>Save</strong> and <strong>Activate</strong>.
          </Step>

          <Step n={4} icon={PlayCircle} title="Test the trigger">
            Edit a matching record (e.g. change an Opportunity stage) and save. Within ~30s the Apex job completes
            in <Path>Setup → Apex Jobs</Path> and the event appears in Baton's Trigger Pipeline with status{' '}
            <strong>completed</strong>. The package auto-registers its HMAC secret on this first dispatch.
          </Step>
        </ol>
      </div>

      {/* Troubleshooting */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
          <LifeBuoy className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Troubleshooting</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {TROUBLESHOOTING.map((row) => (
            <div key={row.symptom} className="grid grid-cols-1 sm:grid-cols-2 gap-1 sm:gap-4 px-6 py-3">
              <p className="text-sm font-medium text-gray-900">{row.symptom}</p>
              <p className="text-sm text-gray-600">{row.fix}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Need a hand? Email{' '}
        <a href="mailto:app-support@fluidlabs.com" className="text-brand-600 hover:text-brand-700">
          app-support@fluidlabs.com
        </a>.
      </p>
    </div>
  );
}

const TROUBLESHOOTING = [
  {
    symptom: 'Send to Baton action is missing in Flow Builder',
    fix: `Permission set not assigned — add the user under Setup → Permission Sets → ${SF_PERMISSION_SET}.`,
  },
  {
    symptom: 'Apex Job fails with “Unauthorized endpoint”',
    fix: 'Custom Baton host — add a Remote Site Setting for your host under Setup → Remote Site Settings.',
  },
  {
    symptom: 'Apex Job completes but Baton receives nothing',
    fix: 'Webhook URL is missing the ?bootstrap= token or has a typo — re-copy it fresh from the Baton automation.',
  },
  {
    symptom: 'Baton returns 401 Invalid signature',
    fix: 'Bootstrap token expired (24h) or already redeemed — reopen the automation in Baton to get a fresh URL.',
  },
];

function Step({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number;
  icon: typeof Cloud;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-50 text-brand-700 text-sm font-semibold shrink-0">
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

function Path({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-gray-700">{children}</span>;
}

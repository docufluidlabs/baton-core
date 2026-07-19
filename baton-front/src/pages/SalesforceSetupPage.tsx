/**
 * Salesforce Setup Page — Baton
 *
 * Manual, in-app setup guide for connecting Salesforce as a webhook source.
 * Salesforce has no native "send webhook" button, so the walkthrough covers
 * building the outbound call yourself: get the automation's webhook URL, save
 * a shared HMAC secret in Baton, allow the Baton host in Salesforce, then send
 * signed events from a Flow + Apex callout (or an Outbound Message), plus a
 * troubleshooting cheat-sheet. Mirrors the generic ConnectorSetupPage layout.
 */
import { Link } from 'react-router-dom';
import {
  Cloud,
  Link2,
  KeyRound,
  Settings,
  Workflow,
  PlayCircle,
  LifeBuoy,
  GitBranch,
  Plug,
} from 'lucide-react';

export default function SalesforceSetupPage() {
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
            Send Salesforce events to Baton with an outbound webhook you configure in your org.
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">How Baton connects to Salesforce</h2>
        <p className="text-xs text-gray-500 max-w-2xl leading-relaxed">
          Baton receives Salesforce events through a <strong>webhook</strong>. Salesforce has no
          built-in &ldquo;send webhook&rdquo; switch, so you build the outbound call in your org — a
          record-triggered <strong>Flow with an Apex callout</strong> (or an Outbound Message) that
          POSTs the record to your automation's unique Webhook URL. Each request is signed with a
          shared secret so Baton can verify it is genuine.
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
            Salesforce requests are verified with <strong>HMAC-SHA256</strong>. Pick a strong secret,
            save it as the <strong>Webhook Secret</strong> in Baton, and use the <strong>same value</strong>{' '}
            in Salesforce to sign every request (base64 signature in the{' '}
            <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">X-Salesforce-Signature</code>{' '}
            header).
          </span>
        </div>
      </div>

      {/* Steps */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Step-by-step</h2>
        <ol className="space-y-3">
          <Step n={1} icon={Link2} title="Get your Baton webhook URL">
            In Baton open{' '}
            <Link to="/flows" className="text-brand-600 font-medium hover:text-brand-700">
              Flow Builder
            </Link>{' '}
            → <strong>New Automation</strong>, set <strong>Source = Salesforce</strong>, fill in the
            name and target workflow, then <strong>Save</strong>. Copy the generated{' '}
            <strong>Webhook URL</strong> — your Salesforce callout will POST to it.
          </Step>

          <Step n={2} icon={KeyRound} title="Save the webhook secret in Baton">
            Generate a strong random string (for example 32+ characters) and paste it into the{' '}
            <strong>Webhook Secret</strong> field on the same automation panel, then{' '}
            <strong>Save</strong>. Keep it handy — Salesforce signs each request with this exact
            value, and Baton rejects anything it can't verify.
          </Step>

          <Step n={3} icon={Settings} title="Allow your Baton host in Salesforce">
            In Salesforce open <Path>Setup → Security → Remote Site Settings → New Remote Site</Path>{' '}
            and add your Baton server's base URL (the origin of the Webhook URL from step 1).
            Salesforce blocks Apex callouts to hosts that aren't allow-listed here.
          </Step>

          <Step n={4} icon={Workflow} title="Build the outbound call">
            Create a <strong>Record-Triggered Flow</strong> on the object you care about that calls a
            small invocable <strong>Apex</strong> method (or use an <strong>Outbound Message</strong>).
            The Apex callout POSTs a JSON body such as{' '}
            <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">
              {'{"objectType":"opportunity","action":"updated","recordId":"{!$Record.Id}"}'}
            </code>{' '}
            to the Webhook URL, and sets{' '}
            <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">X-Salesforce-Signature</code>{' '}
            to the base64 HMAC-SHA256 of the exact request body, computed with the secret from step 2
            (in Apex: <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">Crypto.generateMac('hmacSHA256', body, secret)</code>).
            Then <strong>Activate</strong> the Flow.
          </Step>

          <Step n={5} icon={PlayCircle} title="Test the trigger">
            Edit a matching record (for example, change an Opportunity stage) and save. Within a few
            seconds the event appears in Baton's Trigger Pipeline and any matching automation runs.
            If nothing shows up, check <Path>Setup → Apex Jobs</Path> and your debug logs for the
            callout result.
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
    symptom: 'Apex callout fails with “Unauthorized endpoint”',
    fix: 'Your Baton host isn’t allow-listed — add it under Setup → Security → Remote Site Settings.',
  },
  {
    symptom: 'Baton returns 401 Invalid signature',
    fix: 'The secret in Salesforce doesn’t match the Webhook Secret saved in Baton, or the signature isn’t the base64 HMAC-SHA256 of the exact raw request body. Re-check both and sign the same bytes you send.',
  },
  {
    symptom: 'Nothing arrives in Baton',
    fix: 'The Flow isn’t Active, the callout is failing (check Apex Jobs and debug logs), or the Webhook URL has a typo — re-copy it from the automation in Baton.',
  },
  {
    symptom: 'Events arrive but the automation doesn’t run',
    fix: 'Confirm the automation is Active and its event type matches the payload (for example opportunity.updated), then check its trigger conditions.',
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

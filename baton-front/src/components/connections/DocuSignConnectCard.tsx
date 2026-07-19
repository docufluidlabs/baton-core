/**
 * Docusign Connect Card — Baton
 *
 * Shown on the Connections page when no Docusign connection exists yet.
 * When the server's DocuSign OAuth app is configured this is the plain
 * "Connect Docusign" button. On a fresh self-host (no integration key /
 * secret key) that button would start a doomed redirect with an empty
 * client_id, so instead we render an n8n-style guided setup: the exact
 * redirect URI to copy, the env keys to set, and a "Check again" affordance
 * that flips the card to the Connect button once the API restarts with
 * credentials — no full page reload needed.
 */
import { toast } from 'sonner';
import { Plug, Loader2, Copy, ExternalLink, RefreshCw, Info } from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { useDocusignSetupStatus, type DocusignSetupStatus } from '@/hooks/useApi';

interface DocuSignConnectCardProps {
  connecting: boolean;
  onConnect: () => void;
}

export function DocuSignConnectCard({ connecting, onConnect }: DocuSignConnectCardProps) {
  const { data: setup, mutate, isValidating } = useDocusignSetupStatus();

  // Guided one-time setup — only when the server has told us it is unconfigured.
  // While loading (or if the status call fails) we keep today's Connect button.
  if (setup && !setup.configured) {
    return <SetupGuide setup={setup} onRecheck={() => mutate()} isRechecking={isValidating} />;
  }

  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <PlatformIcon platform="docusign" size={32} />
        <div>
          <h3 className="font-medium text-gray-900">Docusign</h3>
          <p className="text-xs text-gray-500 mt-0.5">Connect your Docusign account to enable envelope workflows.</p>
        </div>
      </div>
      <button
        onClick={onConnect}
        disabled={connecting}
        className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 shrink-0"
      >
        {connecting ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
        ) : (
          <><Plug className="w-4 h-4" /> Connect Docusign</>
        )}
      </button>
    </div>
  );
}

// ─── Guided setup (unconfigured self-host) ───────────────────

function StepNumber({ n }: { n: number }) {
  return (
    <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
      {n}
    </div>
  );
}

function SetupGuide({
  setup,
  onRecheck,
  isRechecking,
}: {
  setup: DocusignSetupStatus;
  onRecheck: () => void;
  isRechecking: boolean;
}) {
  const isSandbox = setup.oauthBase.includes('account-d');

  async function handleCopy() {
    await navigator.clipboard.writeText(setup.redirectUri);
    toast.success('Copied');
  }

  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 space-y-4">
      <div className="flex items-center gap-3">
        <PlatformIcon platform="docusign" size={32} />
        <div>
          <h3 className="font-medium text-gray-900">Docusign</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            One-time setup: register Baton as a Docusign OAuth app before you can connect.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        <li className="flex gap-3">
          <StepNumber n={1} />
          <div>
            <p className="text-sm font-medium text-gray-900">Create a free DocuSign developer account</p>
            <a
              href={setup.developerPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 mt-0.5"
            >
              developers.docusign.com <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber n={2} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Create an app under Apps &amp; Keys and add this redirect URI
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                readOnly
                value={setup.redirectUri}
                aria-label="OAuth Redirect URI"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg text-gray-700"
              />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0"
              >
                <Copy className="w-3 h-3" /> Copy
              </button>
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber n={3} />
          <p className="text-sm text-gray-700">
            Paste the <strong>Integration Key</strong> and <strong>Secret Key</strong> into{' '}
            <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">baton/.env</code> as{' '}
            <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_INTEGRATION_KEY</code> /{' '}
            <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_SECRET_KEY</code>, then
            restart the API.
          </p>
        </li>
      </ol>

      {isSandbox && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Defaults point at DocuSign&apos;s developer sandbox — right for trying Baton out.
        </div>
      )}

      <button
        onClick={onRecheck}
        disabled={isRechecking}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-700"
      >
        {isRechecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Check again
      </button>
    </div>
  );
}

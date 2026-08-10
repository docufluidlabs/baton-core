/**
 * Docusign Connect Card — Baton
 *
 * Shown on the Connections page when no Docusign connection exists yet.
 * When the server's Docusign OAuth app is configured this is the plain
 * "Connect Docusign" button. On a fresh self-host (no integration key /
 * secret key) that button would start a doomed redirect with an empty
 * client_id, so instead we render an n8n-style guided setup: the exact
 * redirect URI to copy, the env keys to set, and a "Check again" affordance
 * that flips the card to the Connect button once the API restarts with
 * credentials — no full page reload needed.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Plug, Loader2, Copy, ExternalLink, RefreshCw, Info, AlertTriangle, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { useDocusignSetupStatus, type DocusignSetupStatus } from '@/hooks/useApi';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The redirect URI is built server-side from API_URL. If the operator deployed
 * publicly but never set APP_URL/API_URL, the server still thinks it lives on
 * localhost — and every generated URL (this redirect URI, webhook URLs) is
 * confidently wrong. The browser knows the origin actually in use, so we can
 * detect the dangerous direction: browsing from a real domain while the
 * server-built URI points at loopback.
 */
export function isLikelyMisconfiguredApiUrl(redirectUri: string, browserHostname: string): boolean {
  try {
    const uriHost = new URL(redirectUri).hostname;
    return LOOPBACK_HOSTS.has(uriHost) && !LOOPBACK_HOSTS.has(browserHostname);
  } catch {
    return false;
  }
}

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
  const apiUrlMismatch = isLikelyMisconfiguredApiUrl(setup.redirectUri, window.location.hostname);
  const [showFillGuide, setShowFillGuide] = useState(false);

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
            <p className="text-sm font-medium text-gray-900">Create a free Docusign developer account</p>
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

            <button
              type="button"
              onClick={() => setShowFillGuide((v) => !v)}
              aria-expanded={showFillGuide}
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              <ChevronRight className={clsx('w-3 h-3 transition-transform duration-150', showFillGuide && 'rotate-90')} />
              What to fill on that page
            </button>

            {showFillGuide && (
              <div className="mt-2 space-y-2.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="font-medium text-gray-800">On that page, fill exactly this:</p>
                <ul className="space-y-1.5 list-disc pl-4">
                  <li>
                    <strong className="text-gray-800">App Name:</strong> anything, e.g. &quot;Baton&quot;.
                  </li>
                  <li>
                    <strong className="text-gray-800">Integration Key:</strong> copy it - this is your{' '}
                    <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_INTEGRATION_KEY</code>{' '}
                    for step 3.
                  </li>
                  <li>
                    <strong className="text-gray-800">Integration Type:</strong> Private custom integration
                    (only required for go-live; picking it now avoids the warning).
                  </li>
                  <li>
                    <strong className="text-gray-800">&quot;Able to securely store a client secret?&quot;:</strong>{' '}
                    Yes (Authorization Code Grant).
                  </li>
                  <li>
                    <strong className="text-gray-800">Secret Keys &rarr; Add Secret Key:</strong> copy it
                    immediately - Docusign shows it once, masked forever after. This is your{' '}
                    <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_SECRET_KEY</code>.
                  </li>
                  <li>
                    <strong className="text-gray-800">Redirect URIs &rarr; Add URI:</strong> paste the URI above.
                  </li>
                </ul>

                <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Leave <strong>Require Proof Key for Code Exchange (PKCE)</strong> unchecked, despite the
                    &quot;Recommended&quot; badge. Baton authenticates with the secret key and does not send a
                    PKCE challenge - enabling it breaks every connect.
                  </span>
                </div>

                <p>
                  Everything else (RSA Keypairs, CORS, policy links): leave untouched. Click{' '}
                  <strong className="text-gray-800">Save</strong> at the bottom - the page is long and the URI
                  is not saved until you do.
                </p>

                <a
                  href="/docs/connect-docusign"
                  className="text-brand-600 hover:underline inline-flex items-center gap-1 font-medium"
                >
                  Full walkthrough &rarr;
                </a>
              </div>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber n={3} />
          <div className="text-sm text-gray-700 space-y-2">
            <p>
              Paste the <strong>Integration Key</strong> and <strong>Secret Key</strong> into your config file
              as{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_INTEGRATION_KEY</code>{' '}
              and{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">DOCUSIGN_SECRET_KEY</code>.
              The file is{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">baton/.env</code> in the
              folder you installed Baton into - the same folder as{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">docker-compose.yml</code>.
              Nothing else on this page needs a value.
            </p>
            <p className="text-xs text-gray-600">
              Then recreate the API container so it picks up the new values - a plain restart reuses the old
              ones:
            </p>
            <code className="block text-xs font-mono bg-gray-100 text-gray-800 rounded px-2 py-1.5">
              docker compose up -d --force-recreate baton-api
            </code>
          </div>
        </li>
      </ol>

      {apiUrlMismatch && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            You&apos;re browsing from <strong>{window.location.hostname}</strong>, but the server built this
            redirect URI from a localhost <code className="font-mono">API_URL</code>. Registering it in Docusign
            will not work - set <code className="font-mono">APP_URL</code> and{' '}
            <code className="font-mono">API_URL</code> in{' '}
            <code className="font-mono">baton/.env</code> to this install&apos;s public URL and restart, so OAuth
            and webhook URLs are generated correctly.
          </span>
        </div>
      )}

      {isSandbox && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          Defaults point at Docusign&apos;s developer sandbox - right for trying Baton out.
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

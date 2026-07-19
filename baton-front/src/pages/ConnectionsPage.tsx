import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useConnections,
  usePlatforms,
  useInstalledPlatforms,
  usePlatformTemplates,
  useAutomations,
  useMe,
  connectPlatform,
  disconnectConnection,
  testConnection,
  removePlatform,
  type Connection,
  type InstalledPlatform,
  type Automation,
  type PlatformTemplate,
} from '@/hooks/useApi';
import { useSWRConfig } from 'swr';
import { ConnectionDetailModal } from '@/components/connections/ConnectionDetailModal';
import { DocuSignSidePanel } from '@/components/connections/DocuSignSidePanel';
import { AddPlatformModal } from '@/components/connections/AddPlatformModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Plug,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Trash2,
  Loader2,
  Plus,
  AlertCircle,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

/** Where the step-by-step install guide for a connector lives. Salesforce has
 * its own bespoke managed-package page; every other connector uses the
 * data-driven /setup/:slug guide. */
function setupHref(slug: string): string {
  return slug === 'salesforce' ? '/salesforce-setup' : `/setup/${slug}`;
}

/**
 * Primary call-to-action on each platform card: link to a connector's
 * step-by-step install guide. Styled as the prominent filled button so the
 * install guide leads over the secondary "Create New Automation" action.
 * Opens the guide page in a new tab.
 */
function ConnectorSetupLink({ slug, name }: { slug: string; name: string }) {
  return (
    <a
      href={setupHref(slug)}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-2 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700"
    >
      How to install {name}
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}

export default function ConnectionsPage() {
  const { data, isLoading } = useConnections();
  const { data: platformsData } = usePlatforms();
  const { data: installedPlatformsData } = useInstalledPlatforms();
  const { data: templatesData } = usePlatformTemplates();
  const { data: automationsData } = useAutomations();
  const { data: meData } = useMe();
  const { mutate } = useSWRConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [connecting, setConnecting] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { name?: string; email?: string }>>({});
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [docuSignPanelOpen, setDocuSignPanelOpen] = useState(false);

  // Confirm dialog state
  const [confirmDisconnect, setConfirmDisconnect] = useState<{ id: string; displayName: string } | null>(null);
  const [confirmRemovePlatform, setConfirmRemovePlatform] = useState<{ id: string; name: string } | null>(null);
  const [removingPlatform, setRemovingPlatform] = useState<string | null>(null);

  // Add Platform modal
  const [addPlatformOpen, setAddPlatformOpen] = useState(false);

  // Smart delete warning
  const [deleteWarning, setDeleteWarning] = useState<{ platform: InstalledPlatform; activeAutomations: Automation[] } | null>(null);

  const connections = data?.connections || [];
  const platforms = platformsData?.platforms || [];
  const installedPlatforms = installedPlatformsData?.platforms ?? [];
  const activePlatforms = installedPlatforms.filter((a) => a.status === 'active');
  const templates = templatesData?.templates ?? [];
  const automations = automationsData?.automations ?? [];
  const userRole = meData?.user?.role ?? '';
  const canInstall = ['superuser', 'owner', 'admin'].includes(userRole);
  const installedSlugs = new Set(activePlatforms.map((a) => a.appSlug));
  const connectedPlatforms = new Set(connections.map((c) => c.platform));
  const selectedConnection = connections.find((c) => c.id === selectedConnectionId) || null;

  // DocuSign — always show, even when DB is empty
  const docusignConnection = connections.find((c) => c.platform === 'docusign');

  // ─── Handle OAuth redirect result ─────────────────────────
  useEffect(() => {
    const status = searchParams.get('status');
    const platform = searchParams.get('platform');
    if (status === 'success' && platform) {
      toast.success(`${platform} connected successfully!`);
      setSearchParams({}, { replace: true });
      mutate('/connections');
    } else if (status === 'error') {
      toast.error(searchParams.get('error') || `Failed to connect ${platform}`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, mutate]);

  // ─── Auto-open detail modal after OAuth ───────────────────
  useEffect(() => {
    const platform = searchParams.get('platform');
    if (!platform || !connections.length) return;
    const conn = connections.find((c) => c.platform === platform);
    if (conn && !selectedConnectionId) {
      setSelectedConnectionId(conn.id);
    }
  }, [connections, searchParams, selectedConnectionId]);

  // ─── Action handlers ──────────────────────────────────────

  async function handleConnect(platform: string) {
    setConnecting(platform);
    try {
      await connectPlatform(platform);
    } catch {
      setConnecting(null);
    }
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const res = await testConnection(id);
      if (res.details) setTestResults((prev) => ({ ...prev, [id]: res.details! }));
      mutate('/connections');
    } finally {
      setTesting(null);
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) return;
    await disconnectConnection(confirmDisconnect.id);
    mutate('/connections');
    setConfirmDisconnect(null);
    setDocuSignPanelOpen(false);
    setSelectedConnectionId(null);
  }

  function handleDeletePlatformClick(plat: InstalledPlatform) {
    const activeOnes = automations.filter(
      (a) => (a.appSlug === plat.appSlug || a.sourcePlatform === plat.appSlug) && a.status === 'active',
    );
    if (activeOnes.length > 0) {
      setDeleteWarning({ platform: plat, activeAutomations: activeOnes });
    } else {
      setConfirmRemovePlatform({ id: plat.id, name: plat.displayName });
    }
  }

  async function handleRemovePlatform() {
    if (!confirmRemovePlatform) return;
    setRemovingPlatform(confirmRemovePlatform.id);
    try {
      await removePlatform(confirmRemovePlatform.id);
      mutate('/platforms');
      mutate('/automations');
    } catch {
      // error shown by global handler
    } finally {
      setRemovingPlatform(null);
      setConfirmRemovePlatform(null);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Connections</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your connected platforms and view webhook status.
        </p>
      </div>

      {/* ─── Docusign Connection ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <PlatformIcon platform="docusign" size={18} />
          <h2 className="text-sm font-semibold text-gray-700">Docusign Connection</h2>
        </div>

        {docusignConnection ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <ConnectionCard
              connection={docusignConnection}
              onClick={() => setDocuSignPanelOpen(true)}
              onTest={() => handleTest(docusignConnection.id)}
              onDisconnect={() => setConfirmDisconnect({ id: docusignConnection.id, displayName: docusignConnection.displayName })}
              onReconnect={() => handleConnect('docusign')}
              isTesting={testing === docusignConnection.id}
            />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PlatformIcon platform="docusign" size={32} />
              <div>
                <h3 className="font-medium text-gray-900">Docusign</h3>
                <p className="text-xs text-gray-500 mt-0.5">Connect your Docusign account to enable envelope workflows.</p>
              </div>
            </div>
            <button
              onClick={() => handleConnect('docusign')}
              disabled={connecting === 'docusign'}
              className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {connecting === 'docusign' ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
              ) : (
                <><Plug className="w-4 h-4" /> Connect Docusign</>
              )}
            </button>
          </div>
        )}
      </section>

      {/* ─── OAuth Connections ─────────────────────────────── */}
      {(connections.filter((c) => c.platform !== 'docusign').length > 0 || platforms.length > 0) && (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">OAuth Connections</h2>
        </div>

        {connections.filter((c) => c.platform !== 'docusign').length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connections.filter((c) => c.platform !== 'docusign').map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                onClick={() => setSelectedConnectionId(conn.id)}
                onTest={() => handleTest(conn.id)}
                onDisconnect={() => setConfirmDisconnect({ id: conn.id, displayName: conn.displayName })}
                onReconnect={() => handleConnect(conn.platform)}
                isTesting={testing === conn.id}
              />
            ))}
          </div>
        )}

        {platforms.filter((p) => !connectedPlatforms.has(p.platform)).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms
              .filter((p) => !connectedPlatforms.has(p.platform))
              .map((p) => (
                <div key={p.platform} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <PlatformIcon platform={p.platform} size={28} />
                    <div>
                      <h3 className="font-medium text-gray-900">{p.displayName}</h3>
                      <p className="text-xs text-gray-500">{p.eventTypes.length} event types</p>
                    </div>
                  </div>
                  <ConnectorSetupLink slug={p.platform} name={p.displayName} />
                  <button
                    onClick={() => handleConnect(p.platform)}
                    disabled={connecting === p.platform}
                    className="w-full mt-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {connecting === p.platform ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
                    ) : (
                      <><Plug className="w-4 h-4" /> Connect</>
                    )}
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>
      )}

      {/* ─── Connected Platforms ──────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <h2 className="text-sm font-semibold text-gray-700">Connected Platforms</h2>
            <span className="text-xs text-gray-400">Platforms receiving webhooks</span>
            {activePlatforms.length > 0 && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                {activePlatforms.length}
              </span>
            )}
          </div>
          {canInstall && (
            <button
              onClick={() => setAddPlatformOpen(true)}
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Platform
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : activePlatforms.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No platforms connected"
            description={canInstall
              ? 'Add a platform to start receiving webhooks and building automations.'
              : 'Ask a superuser or owner to add platforms for your organization.'}
            action={canInstall ? (
              <button
                onClick={() => setAddPlatformOpen(true)}
                className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Platform
              </button>
            ) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activePlatforms.map((plat) => {
              const template = templates.find((t: PlatformTemplate) => t.slug === plat.appSlug);
              return (
                <ConnectedPlatformCard
                  key={plat.id}
                  platform={plat}
                  template={template}
                  canRemove={canInstall}
                  isRemoving={removingPlatform === plat.id}
                  automationCount={automations.filter((a) => a.appSlug === plat.appSlug && a.status !== 'disabled').length}
                  onSetup={() => navigate('/flows', { state: { setupPlatform: plat.appSlug } })}
                  onRemove={() => handleDeletePlatformClick(plat)}
                />
              );
            })}
          </div>
        )}
      </section>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      {/* Add Platform modal */}
      <AddPlatformModal
        open={addPlatformOpen}
        onClose={() => setAddPlatformOpen(false)}
        templates={templates}
        installedSlugs={installedSlugs}
        canInstall={canInstall}
      />

      {docusignConnection && (
        <DocuSignSidePanel
          connection={docusignConnection}
          open={docuSignPanelOpen}
          onClose={() => setDocuSignPanelOpen(false)}
          onTest={() => handleTest(docusignConnection.id)}
          onDisconnect={() => setConfirmDisconnect({ id: docusignConnection.id, displayName: docusignConnection.displayName })}
          isTesting={testing === docusignConnection.id}
          testResult={testResults[docusignConnection.id]}
        />
      )}

      <ConnectionDetailModal
        connection={selectedConnection}
        open={selectedConnectionId !== null}
        onClose={() => setSelectedConnectionId(null)}
        onRefresh={() => mutate('/connections')}
        lastTestResult={selectedConnectionId ? testResults[selectedConnectionId] : undefined}
      />

      {/* Confirm: disconnect connection */}
      <ConfirmModal
        open={confirmDisconnect !== null}
        title="Disconnect platform"
        message={`Disconnect "${confirmDisconnect?.displayName}"? Active automations using this connection will stop working.`}
        confirmLabel="Disconnect"
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmDisconnect(null)}
      />

      {/* Confirm: remove platform (when no active automations) */}
      <ConfirmModal
        open={confirmRemovePlatform !== null}
        title="Remove platform"
        message={`Remove "${confirmRemovePlatform?.name}"? This platform will stop receiving webhooks. Event logs will remain available.`}
        confirmLabel="Remove"
        onConfirm={handleRemovePlatform}
        onCancel={() => setConfirmRemovePlatform(null)}
      />

      {/* Warning: active automations block deletion */}
      <Modal
        open={deleteWarning !== null}
        onClose={() => setDeleteWarning(null)}
        title="Cannot remove platform"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            You have {deleteWarning?.activeAutomations.length} active automation(s) using &quot;{deleteWarning?.platform.displayName}&quot;. Please pause them first.
          </div>
          <ul className="text-sm text-gray-700 space-y-1.5 pl-1">
            {deleteWarning?.activeAutomations.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                {a.name}
              </li>
            ))}
          </ul>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setDeleteWarning(null)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── OAuth Connection Card ────────────────────────────────────

function ConnectionCard({
  connection,
  onClick,
  onTest,
  onDisconnect,
  onReconnect,
  isTesting,
}: {
  connection: Connection;
  onClick: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  isTesting: boolean;
}) {
  const statusConfig: Record<string, {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    label: string;
  }> = {
    healthy: { icon: CheckCircle, color: 'text-green-500', label: 'Healthy' },
    warning: { icon: AlertTriangle, color: 'text-yellow-500', label: 'Warning' },
    error:   { icon: XCircle,      color: 'text-red-500',    label: 'Error'   },
    pending: { icon: RefreshCw,    color: 'text-gray-400',   label: 'Pending' },
  };

  const { icon: StatusIcon, color, label } =
    statusConfig[connection.status] || statusConfig.pending;

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:border-brand-200 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={connection.platform} size={28} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-gray-900">{connection.displayName}</h3>
              <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-brand-50 text-brand-600 rounded">
                {connection.platform}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusIcon className={clsx('w-3.5 h-3.5', color)} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            {typeof connection.metadata?.accountName === 'string' && (
              <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[200px]">
                {connection.metadata.accountName}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onTest}
          disabled={isTesting}
          className="flex-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Check Connection Status
        </button>
        {connection.status === 'error' ? (
          <button
            onClick={onReconnect}
            className="px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        ) : (
          <button
            onClick={onDisconnect}
            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" /> Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Connected Platform Card ──────────────────────────────────

function ConnectedPlatformCard({
  platform: plat,
  template,
  canRemove,
  isRemoving,
  automationCount,
  onSetup,
  onRemove,
}: {
  platform: InstalledPlatform;
  template?: PlatformTemplate;
  canRemove: boolean;
  isRemoving: boolean;
  automationCount: number;
  onSetup: () => void;
  onRemove: () => void;
}) {
  const category = template?.category ?? plat.category ?? '';
  const hasAutomations = automationCount > 0;

  const STABLE_SLUGS = new Set(['zohocrm', 'hubspot', 'bamboohr', 'zendesk']);
  const isBeta = !STABLE_SLUGS.has(plat.appSlug);

  return (
    <div className="relative bg-white rounded-xl border border-gray-200 p-5">
      {isBeta && (
        <span className="absolute top-4 right-4 text-xs bg-gray-100 text-gray-500 px-2.5 py-0.5 rounded-full font-medium">
          auto-secure
        </span>
      )}
      <div className="flex items-center gap-3 mb-4">
        <PlatformIcon platform={plat.appSlug} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900">{plat.displayName}</h3>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {category && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
                {category}
              </span>
            )}
            {hasAutomations ? (
              <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full font-medium">
                {automationCount} automation{automationCount !== 1 ? 's' : ''}
              </span>
            ) : (
              <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                No automations
              </span>
            )}
          </div>
        </div>
      </div>

      <ConnectorSetupLink slug={plat.appSlug} name={plat.displayName} />
      <div className="flex gap-2">
        <button
          onClick={onSetup}
          className="flex-1 px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1.5"
        >
          <GitBranch className="w-3 h-3" /> Create New Automation
        </button>
        {canRemove && (
          <button
            onClick={onRemove}
            disabled={isRemoving}
            className="px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            {isRemoving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

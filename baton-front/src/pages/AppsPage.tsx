/**
 * Platforms Page — Baton
 *
 * Two sections:
 *  1. "Installed Platforms" — table with webhook URL, stats, remove (superuser/owner)
 *  2. "Available Platforms" — catalog grid, install via 3-step wizard
 *
 * Non-superuser/owner users see disabled Install buttons with tooltips.
 */
import { useState } from 'react';
import {
  useInstalledPlatforms,
  usePlatformTemplates,
  removePlatform,
  useMe,
  type InstalledPlatform,
  type PlatformTemplate,
} from '@/hooks/useApi';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { InstallAppWizard } from '@/components/apps/InstallAppWizard';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  Grid3X3, Plus, Copy, Trash2, Loader2, CheckCircle,
  Clock, Webhook, ExternalLink, ShieldCheck, AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import clsx from 'clsx';

export default function AppsPage() {
  const { data: platformsData, isLoading: platformsLoading } = useInstalledPlatforms();
  const { data: templatesData, isLoading: templatesLoading } = usePlatformTemplates();
  const { data: meData } = useMe();
  const { mutate } = useSWRConfig();

  const [installing, setInstalling] = useState<PlatformTemplate | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const installedPlatforms = platformsData?.platforms ?? [];
  const templates = templatesData?.templates ?? [];
  const userRole = meData?.user?.role ?? '';
  const canInstall = ['superuser', 'owner'].includes(userRole);

  // slugs already installed (active only)
  const installedSlugs = new Set(
    installedPlatforms.filter((a: InstalledPlatform) => a.status === 'active').map((a: InstalledPlatform) => a.appSlug),
  );

  function copyWebhookUrl(url: string) {
    navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied to clipboard');
  }

  async function handleRemove() {
    if (!confirmRemove) return;
    setRemoving(confirmRemove.id);
    try {
      await removePlatform(confirmRemove.id);
      mutate('/platforms');
    } catch {
      // error shown by global handler
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  }

  const isLoading = platformsLoading || templatesLoading;

  return (
    <div className="p-6 space-y-8 max-w-6xl">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Platforms</h1>
        <p className="text-sm text-gray-500 mt-1">
          Webhook-based integrations — no OAuth required. Baton verifies HMAC signatures on
          every incoming request using your platform's secret key.
        </p>
      </div>

      {/* ── Installed platforms ────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <h2 className="text-sm font-semibold text-gray-700">Installed Platforms</h2>
          {installedPlatforms.length > 0 && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
              {installedPlatforms.length}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : installedPlatforms.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
            <Grid3X3 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-1 font-medium">No platforms installed yet</p>
            <p className="text-xs text-gray-400">
              {canInstall
                ? 'Install a platform from the catalog below to start receiving webhooks.'
                : 'Ask a superuser or owner to install platforms for your organization.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-48">Platform</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Webhook URL</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Stats</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Status</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {installedPlatforms.map((plat: InstalledPlatform) => {
                  const template = templates.find((t) => t.slug === plat.appSlug);
                  return (
                    <InstalledPlatformRow
                      key={plat.id}
                      platform={plat}
                      template={template}
                      canRemove={canInstall}
                      isRemoving={removing === plat.id}
                      onCopy={() => copyWebhookUrl(plat.webhookUrl)}
                      onRemove={() => setConfirmRemove({ id: plat.id, name: plat.displayName })}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Available catalog ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Available Platforms</h2>
        </div>

        {!canInstall && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            You need the <strong className="mx-0.5">superuser</strong> or{' '}
            <strong className="mx-0.5">owner</strong> role to install platforms. Contact your
            organization owner.
          </div>
        )}

        {templatesLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <CatalogCard
                key={template.slug}
                template={template}
                isInstalled={installedSlugs.has(template.slug)}
                canInstall={canInstall}
                onInstall={() => setInstalling(template)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Install wizard */}
      {installing && (
        <InstallAppWizard
          template={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            setInstalling(null);
            mutate('/platforms');
          }}
        />
      )}

      {/* Confirm remove */}
      <ConfirmModal
        open={confirmRemove !== null}
        title="Remove platform"
        message={`Remove "${confirmRemove?.name}"? Active automations using this platform will stop receiving webhooks.`}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

// ── Installed platform table row ──────────────────────────────────

function InstalledPlatformRow({
  platform: plat, template, canRemove, isRemoving, onCopy, onRemove,
}: {
  platform: InstalledPlatform;
  template?: PlatformTemplate;
  canRemove: boolean;
  isRemoving: boolean;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const name = template?.name ?? plat.name ?? plat.appSlug;

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Platform identity */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <PlatformIcon platform={plat.appSlug} size={22} />
          <div>
            <p className="font-medium text-gray-900">{plat.displayName}</p>
            <p className="text-xs text-gray-400">
              {name} · {template?.category ?? plat.category ?? plat.appSlug}
            </p>
          </div>
        </div>
      </td>

      {/* Webhook URL */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Webhook className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="font-mono text-xs text-gray-600 truncate max-w-[220px]">
            {plat.webhookUrl}
          </span>
          <button
            onClick={onCopy}
            className="p-1 hover:bg-gray-100 rounded shrink-0"
            title="Copy webhook URL"
          >
            <Copy className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
      </td>

      {/* Stats */}
      <td className="px-4 py-3">
        <p className="text-xs text-gray-700">
          <span className="font-semibold">{(plat.webhookCount ?? 0).toLocaleString()}</span>{' '}
          webhooks
        </p>
        {plat.lastWebhookAt ? (
          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
            <Clock className="w-3 h-3" />
            {new Date(plat.lastWebhookAt).toLocaleDateString()}
          </p>
        ) : (
          <p className="text-xs text-gray-400 mt-0.5">No webhooks yet</p>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {plat.status === 'active' ? (
            <Badge variant="green">Active</Badge>
          ) : (
            <Badge variant="gray">Inactive</Badge>
          )}
          <ShieldCheck className="w-3.5 h-3.5 text-green-400" title="HMAC verified" />
        </div>
      </td>

      {/* Remove */}
      <td className="px-4 py-3">
        {canRemove && (
          <button
            onClick={onRemove}
            disabled={isRemoving}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            title="Remove platform"
          >
            {isRemoving
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />}
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Catalog card ─────────────────────────────────────────────

function CatalogCard({
  template, isInstalled, canInstall, onInstall,
}: {
  template: PlatformTemplate;
  isInstalled: boolean;
  canInstall: boolean;
  onInstall: () => void;
}) {
  return (
    <div className={clsx(
      'bg-white rounded-xl border p-5 flex flex-col transition-colors',
      isInstalled
        ? 'border-green-200 bg-green-50/30'
        : 'border-gray-200 hover:border-brand-200',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={template.slug} size={26} />
          <div>
            <h3 className="font-medium text-gray-900">{template.name}</h3>
            <p className="text-xs text-gray-400">{template.category}</p>
          </div>
        </div>
        {isInstalled && (
          <Badge variant="green" className="shrink-0">Installed</Badge>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-3 flex-none" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{template.description}</p>

      {/* Event types preview */}
      <div className="flex flex-wrap gap-1 mb-4">
        {template.supportedEvents.slice(0, 3).map((ev) => (
          <span
            key={ev.eventType}
            className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
          >
            {ev.label}
          </span>
        ))}
        {template.supportedEvents.length > 3 && (
          <span className="text-[10px] text-gray-400 px-1 py-0.5">
            +{template.supportedEvents.length - 3} more
          </span>
        )}
      </div>

      {/* HMAC badge */}
      <div className="flex items-center gap-1.5 mb-4 text-xs text-gray-500">
        <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
        HMAC-SHA256 verified
      </div>

      {/* Action */}
      <div className="mt-auto">
        {isInstalled ? (
          <div className="flex items-center gap-2 text-xs text-green-700 font-medium py-2">
            <CheckCircle className="w-4 h-4" />
            Receiving webhooks
          </div>
        ) : canInstall ? (
          <button
            onClick={onInstall}
            className="w-full px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Install
          </button>
        ) : (
          <div className="relative group">
            <button
              disabled
              className="w-full px-4 py-2 text-sm font-medium bg-gray-100 text-gray-400 rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Install
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg px-3 py-1.5 whitespace-nowrap z-10 shadow-lg">
              Requires superuser or owner role
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        {template.setupInstructions.length}-step setup guide included
      </p>
    </div>
  );
}

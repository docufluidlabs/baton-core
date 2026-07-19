/**
 * Webhook Endpoint Sidebar — Create / Edit / View webhook endpoints
 *
 * Fixes applied:
 * - API key is NEVER shown in plain text in edit mode.
 *   The backend returns a masked value (e.g. "••••••••") for existing keys.
 *   The full key is only revealed once: immediately after creation/regeneration.
 * - window.confirm() removed. Delete button now calls onDeleteRequest() prop.
 *   Parent (FlowBuilderPage) shows ConfirmModal before executing the delete.
 * - PLATFORM_ICONS imported from src/lib/utils.ts (was duplicated locally).
 * - timeAgo imported from src/lib/utils.ts instead of re-declared inline.
 */
import { useState, useEffect } from 'react';
import {
  useConnections,
  useWorkflows,
  useInstalledPlatforms,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  regenerateEndpointKey,
  type WebhookEndpoint,
} from '@/hooks/useApi';
import {
  X,
  Webhook,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import clsx from 'clsx';
import { timeAgo } from '@/lib/utils';

interface WebhookEndpointSidebarProps {
  open: boolean;
  onClose: () => void;
  editingEndpoint?: WebhookEndpoint | null;
  onSaved: () => void;
  /** Called when the user clicks Delete — parent shows confirmation modal. */
  onDeleteRequest?: (endpoint: WebhookEndpoint) => void;
}

export function WebhookEndpointSidebar({
  open,
  onClose,
  editingEndpoint,
  onSaved,
  onDeleteRequest,
}: WebhookEndpointSidebarProps) {
  const { data: connectionsData } = useConnections();
  const { data: workflowsData } = useWorkflows();
  const { data: platformsData } = useInstalledPlatforms();

  const connections = connectionsData?.connections || [];
  const workflows = workflowsData?.workflows || [];
  const platforms = platformsData?.platforms || [];

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [payloadFieldPath, setPayloadFieldPath] = useState('');
  const [useApiKey, setUseApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(60);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Full API key shown ONCE after creation or regeneration. Never persisted. */
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);

  // Build platform options from connections + installed platforms
  const platformOptions: Array<{ value: string; label: string }> = [];
  const seenPlatforms = new Set<string>();

  for (const conn of connections) {
    if (!seenPlatforms.has(conn.platform)) {
      seenPlatforms.add(conn.platform);
      platformOptions.push({ value: conn.platform, label: conn.displayName });
    }
  }
  for (const plat of platforms) {
    if (!seenPlatforms.has(plat.appSlug)) {
      seenPlatforms.add(plat.appSlug);
      platformOptions.push({ value: plat.appSlug, label: plat.displayName });
    }
  }

  useEffect(() => {
    if (editingEndpoint) {
      setName(editingEndpoint.name);
      setPlatform(editingEndpoint.platform);
      setWorkflowId(editingEndpoint.workflowId);
      setPayloadFieldPath(editingEndpoint.payloadFieldPath);
      setUseApiKey(!!editingEndpoint.hasApiKey);
      setApiKey('');
      setRateLimitPerMinute(editingEndpoint.rateLimitPerMinute);
      setRevealedApiKey(null);
    } else {
      setName('');
      setPlatform('');
      setWorkflowId('');
      setPayloadFieldPath('');
      setUseApiKey(false);
      setApiKey('');
      setRateLimitPerMinute(60);
      setRevealedApiKey(null);
    }
  }, [editingEndpoint, open]);

  async function handleSave() {
    if (!name || !platform || !workflowId || !payloadFieldPath) return;

    setSaving(true);
    try {
      if (editingEndpoint) {
        await updateWebhookEndpoint(editingEndpoint.id, {
          name,
          workflowId,
          payloadFieldPath,
          rateLimitPerMinute,
        });
        onSaved();
        onClose();
      } else {
        const result = await createWebhookEndpoint({
          name,
          platform,
          workflowId,
          payloadFieldPath,
          generateApiKey: useApiKey,
          apiKey: !useApiKey ? undefined : apiKey || undefined,
          rateLimitPerMinute,
        });
        // Show full key ONCE if backend returned it (one-time reveal)
        if (result.endpoint.apiKey && result.endpoint.apiKey !== '••••••••') {
          setRevealedApiKey(result.endpoint.apiKey);
        } else {
          onSaved();
          onClose();
        }
      }
    } catch {
      // error shown by global handler
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateKey() {
    if (!editingEndpoint) return;
    try {
      const result = await regenerateEndpointKey(editingEndpoint.id);
      setRevealedApiKey(result.apiKey);
    } catch {
      // error shown by global handler
    }
  }

  async function handleToggleEnabled() {
    if (!editingEndpoint) return;
    try {
      await updateWebhookEndpoint(editingEndpoint.id, {
        enabled: !editingEndpoint.enabled,
      });
      onSaved();
    } catch {
      // error shown by global handler
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleClosedAfterReveal() {
    setRevealedApiKey(null);
    onSaved();
    onClose();
  }

  // ─── One-time API key reveal screen ──────────────────────────
  if (revealedApiKey) {
    return (
      <>
        {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={handleClosedAfterReveal} />}
        <div className={clsx(
          'fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl border-l border-gray-200 z-50 transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900">Save Your API Key</h2>
            </div>
            <button onClick={handleClosedAfterReveal} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800 font-medium mb-1">Copy this API key now</p>
              <p className="text-xs text-amber-700">This is the only time you'll see the full key. Store it securely.</p>
            </div>
            <div className="relative">
              <input
                type="text"
                value={revealedApiKey}
                readOnly
                className="w-full px-3 py-2.5 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg pr-10"
              />
              <button
                onClick={() => copyToClipboard(revealedApiKey, 'apiKey')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-gray-200"
              >
                {copied === 'apiKey' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-400" />}
              </button>
            </div>
            <button
              onClick={handleClosedAfterReveal}
              className="w-full px-4 py-2.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700"
            >
              Done
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}

      <div className={clsx(
        'fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl border-l border-gray-200 z-50 transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">
              {editingEndpoint ? 'Edit Webhook Endpoint' : 'New Webhook Endpoint'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {editingEndpoint && (
              <>
                <button
                  onClick={handleToggleEnabled}
                  className="p-1.5 rounded-lg hover:bg-gray-100"
                  title={editingEndpoint.enabled ? 'Disable endpoint' : 'Enable endpoint'}
                >
                  {editingEndpoint.enabled
                    ? <ToggleRight className="w-5 h-5 text-green-500" />
                    : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                </button>
                {/* Delete delegates to parent — no window.confirm() */}
                <button
                  onClick={() => onDeleteRequest?.(editingEndpoint)}
                  className="p-1.5 rounded-lg hover:bg-red-50"
                  title="Delete endpoint"
                >
                  <Trash2 className="w-5 h-5 text-red-400" />
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-5 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 140px)' }}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Endpoint Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Salesforce New Vendor"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Workspace / Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              disabled={!!editingEndpoint}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 bg-white outline-none disabled:bg-gray-100"
            >
              <option value="">Select platform...</option>
              {platformOptions.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Target Maestro Workflow</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 bg-white outline-none"
            >
              <option value="">Select workflow...</option>
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Payload ID Field</label>
            <input
              type="text"
              value={payloadFieldPath}
              onChange={(e) => setPayloadFieldPath(e.target.value)}
              placeholder="e.g. object_id, data.id, resource_id"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Dot-notation path to the record ID in the incoming payload.
            </p>
          </div>

          {/* API Key — creation */}
          {!editingEndpoint && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-gray-700">API Key Authentication</label>
                <button
                  type="button"
                  onClick={() => setUseApiKey(!useApiKey)}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {useApiKey ? 'Disable' : 'Enable'}
                </button>
              </div>
              {useApiKey && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Leave empty to auto-generate"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono"
                  />
                  <p className="text-xs text-gray-400">
                    Callers must include this key in the <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* API Key — edit mode: always masked, regeneration reveals new key */}
          {editingEndpoint && editingEndpoint.hasApiKey && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">API Key</label>
              <div className="flex items-center gap-2">
                {/* Always masked — full key is never shown again after initial creation */}
                <span className="text-sm text-gray-500 font-mono">
                  {editingEndpoint.apiKey || '••••••••'}
                </span>
                <button
                  onClick={handleRegenerateKey}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" /> Regenerate
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                To view the full key, regenerate it — the new key will be shown once.
              </p>
            </div>
          )}

          {/* Rate Limit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Rate Limit <span className="text-gray-400 font-normal">(requests/min)</span>
            </label>
            <input
              type="number"
              value={rateLimitPerMinute}
              onChange={(e) => setRateLimitPerMinute(Math.max(1, parseInt(e.target.value) || 60))}
              min={1}
              max={10000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Webhook URL */}
          {(editingEndpoint || (name && platform)) && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-xs font-medium text-gray-600 mb-2">Webhook URL</p>
              {editingEndpoint ? (
                <div className="flex items-center gap-2">
                  <code className="text-xs text-gray-800 bg-white px-2 py-1.5 rounded border border-gray-200 flex-1 overflow-x-auto whitespace-nowrap">
                    {editingEndpoint.webhookUrl}
                  </code>
                  <button
                    onClick={() => copyToClipboard(editingEndpoint.webhookUrl, 'url')}
                    className="p-1.5 rounded hover:bg-gray-200 shrink-0"
                  >
                    {copied === 'url' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic">URL will be generated after creation</p>
              )}
            </div>
          )}

          {/* Stats */}
          {editingEndpoint && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <p className="text-xs text-gray-500">Total Requests</p>
                <p className="text-lg font-semibold text-gray-900">{editingEndpoint.requestCount}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <p className="text-xs text-gray-500">Last Request</p>
                <p className="text-sm font-medium text-gray-900">
                  {editingEndpoint.lastRequestAt ? timeAgo(editingEndpoint.lastRequestAt) : 'Never'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-4 border-t border-gray-100 bg-white">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name || !platform || !workflowId || !payloadFieldPath}
              className="flex-1 px-4 py-2.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
              {editingEndpoint ? 'Update' : 'Create Endpoint'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

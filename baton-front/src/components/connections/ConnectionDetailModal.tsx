/**
 * Connection Detail Modal — Baton
 * Shows connection info, account selection for multi-account platforms,
 * webhook URL display, and diagnostic details.
 */
import { useState } from 'react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { toast } from 'sonner';
import type { Connection } from '@/hooks/useApi';
import {
  X,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Copy,
  Globe,
} from 'lucide-react';
import clsx from 'clsx';

interface Props {
  connection: Connection | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  lastTestResult?: { name?: string; email?: string };
}

export function ConnectionDetailModal({ connection, open, onClose, onRefresh, lastTestResult }: Props) {
  const [selecting, setSelecting] = useState(false);

  // Fetch available accounts for multi-account platforms
  const { data: accountsData } = useSWR<{ accounts: Array<{ id: string; name: string; baseUri?: string; isDefault?: boolean }>; selectedAccountId?: string }>(
    connection && open ? `/connections/${connection.id}/accounts` : null,
    fetcher,
  );

  const accounts = accountsData?.accounts || [];
  const selectedAccountId = accountsData?.selectedAccountId;
  const activeAccountId = selectedAccountId || connection?.accountId;
  const activeAccountName =
    (connection?.metadata?.accountName as string | undefined) ||
    accounts.find((a) => a.id === activeAccountId)?.name;

  async function handleSelectAccount(accountId: string, accountName: string, baseUri?: string) {
    if (!connection) return;
    setSelecting(true);
    try {
      await api.post(`/connections/${connection.id}/select-account`, { accountId, accountName, baseUri });
      toast.success(`Selected account: ${accountName}`);
      onRefresh();
    } catch {
      // error shown by global handler
    } finally {
      setSelecting(false);
    }
  }

  function copyWebhookUrl() {
    // Prefer the webhookUrl returned by the backend; fall back to a derived URL
    const url = connection?.webhookUrl || `${window.location.origin}/api/webhooks/${connection?.platform}`;
    navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied');
  }

  if (!open || !connection) return null;

  const statusConfig = {
    healthy: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', label: 'Healthy' },
    warning: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50', label: 'Warning' },
    error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: 'Error' },
    pending: { icon: RefreshCw, color: 'text-gray-400', bg: 'bg-gray-50', label: 'Pending' },
  };
  const cfg = statusConfig[connection.status] || statusConfig.pending;
  const StatusIcon = cfg.icon;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[440px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">{connection.displayName ?? ''}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status */}
          <div className={clsx('flex items-center gap-3 px-4 py-3 rounded-lg', cfg.bg)}>
            <StatusIcon className={clsx('w-5 h-5', cfg.color)} />
            <div>
              <p className="text-sm font-medium text-gray-900">{cfg.label}</p>
              <p className="text-xs text-gray-500">
                Connected {new Date(connection.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Info grid */}
          <div className="space-y-3">
            <InfoRow label="Platform" value={connection.platform} />
            {activeAccountName && (
              <InfoRow label="Account Name" value={activeAccountName} />
            )}
            <InfoRow label="Account ID" value={connection.accountId || '—'} />
            <InfoRow label="Has Access Token" value={connection.hasAccessToken ? 'Yes' : 'No'} />
            <InfoRow label="Has Refresh Token" value={connection.hasRefreshToken ? 'Yes' : 'No'} />
            {lastTestResult?.name && (
              <InfoRow label="Connected as" value={lastTestResult.name} />
            )}
            {lastTestResult?.email && (
              <InfoRow label="User Email" value={lastTestResult.email} />
            )}
          </div>

          {/* Webhook URL */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Webhook URL</label>
            <div className="flex gap-2">
              <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 truncate">
                {connection.webhookUrl || `${window.location.origin}/api/webhooks/${connection.platform}`}
              </code>
              <button onClick={copyWebhookUrl} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                <Copy className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Multi-account selection */}
          {accounts.length > 1 && (
            <div>
              {!connection.accountId && (
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800">Select an account to continue</p>
                  <p className="text-xs text-yellow-700 mt-0.5">
                    Multiple accounts found. Please select which one to use for webhooks and workflows.
                  </p>
                </div>
              )}
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Select Account / Tenant
              </label>
              <div className="space-y-2">
                {accounts.map((acct) => (
                  <button
                    key={acct.id}
                    onClick={() => handleSelectAccount(acct.id, acct.name, acct.baseUri)}
                    disabled={selecting || acct.id === (selectedAccountId || connection.accountId)}
                    className={clsx(
                      'w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors',
                      acct.id === (selectedAccountId || connection.accountId)
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-gray-200 hover:border-brand-200 hover:bg-brand-50/30',
                    )}
                  >
                    <p className="font-medium">{acct.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{acct.id}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {connection.metadata && Object.keys(connection.metadata).length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Metadata</label>
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-40 text-gray-600">
                {JSON.stringify(connection.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

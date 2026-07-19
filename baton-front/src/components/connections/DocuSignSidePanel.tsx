import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { X, CheckCircle, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import type { Connection } from '@/hooks/useApi';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

interface Props {
  connection: Connection;
  open: boolean;
  onClose: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  isTesting: boolean;
  testResult?: { name?: string; email?: string };
}

export function DocuSignSidePanel({
  connection,
  open,
  onClose,
  onTest,
  onDisconnect,
  isTesting,
  testResult,
}: Props) {
  const { data: accountsData } = useSWR<{
    accounts: Array<{ id: string; name: string; baseUri?: string }>;
    selectedAccountId?: string;
  }>(open ? `/connections/${connection.id}/accounts` : null, fetcher);

  useEffect(() => {
    if (open && !testResult) {
      onTest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const connectedDate = new Date(connection.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const activeAccountId = accountsData?.selectedAccountId || connection.accountId;
  const accountName =
    (connection.metadata?.accountName as string | undefined) ||
    accountsData?.accounts.find((a) => a.id === activeAccountId)?.name ||
    '—';

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[440px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <PlatformIcon platform="docusign" size={24} />
            <h2 className="text-base font-semibold text-gray-900">Docusign</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Healthy status banner */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Healthy</p>
              <p className="text-xs text-green-600">Connected · {connectedDate}</p>
            </div>
          </div>

          {/* Account section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Account</h3>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              <Row label="Account Name" value={accountName} />
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-500">Status</span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Connected
                </span>
              </div>
              <Row
                label="Connected by"
                value={isTesting ? null : (testResult?.name || '—')}
                loading={isTesting}
              />
              <Row
                label="Email"
                value={isTesting ? null : (testResult?.email || '—')}
                loading={isTesting}
              />
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button
            onClick={onTest}
            disabled={isTesting}
            className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Check Connection Status
          </button>
          <button
            onClick={onDisconnect}
            className="px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Row({ label, value, loading }: { label: string; value: string | null; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-gray-500">{label}</span>
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
      ) : (
        <span className="text-sm font-medium text-gray-900">{value}</span>
      )}
    </div>
  );
}

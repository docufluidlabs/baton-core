/**
 * ConfirmModal — Baton
 * Replaces all native window.confirm() dialogs throughout the app.
 * Supports async confirmation with loading state.
 */
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-sm mx-4 p-5">
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Contact Support Modal — Baton
 * Modal form for submitting a support ticket for a failed workflow instance.
 * Shows success/error result screens after submission.
 */
import { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { reportInstance, type WorkflowInstance } from '@/hooks/useApi';
import { X, Loader2, Send, CheckCircle, XCircle } from 'lucide-react';

type ModalState =
  | { step: 'form' }
  | { step: 'success' }
  | { step: 'error'; message: string };

interface ReportIssueModalProps {
  instance: WorkflowInstance;
  onClose: () => void;
  onSubmitted: (instanceId: string) => void;
}

export function ReportIssueModal({ instance, onClose, onSubmitted }: ReportIssueModalProps) {
  const { user } = useUser();
  const defaultEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<ModalState>({ step: 'form' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !consent) return;
    setSending(true);
    try {
      await reportInstance(instance.id, {
        title: title.trim(),
        description: description.trim(),
        email: email.trim(),
      });
      setState({ step: 'success' });
      onSubmitted(instance.id);
    } catch (err: any) {
      const msg = err?.message || err?.error || 'Something went wrong. Please try again.';
      setState({ step: 'error', message: msg });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full mx-4 md:mx-0 md:w-[440px] max-h-[90vh] overflow-y-auto z-10">

        {state.step === 'form' && (
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Contact Support</h3>
                <p className="text-xs text-gray-400 mt-0.5">Describe the problem and we'll create a support ticket</p>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Context preview */}
            <div className="px-6 py-3 bg-red-50/50 border-b border-gray-100">
              <p className="text-[11px] font-medium text-red-600 truncate">{instance.instanceName}</p>
              {instance.errorMessage && (
                <p className="text-[10px] text-red-400 mt-0.5 line-clamp-2">{instance.errorMessage}</p>
              )}
            </div>

            {/* Form fields */}
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  What went wrong? <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Workflow fails after contact lookup"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Your email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Additional details
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what you expected to happen and what happened instead..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none"
                />
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-[11px] text-gray-500 leading-relaxed">
                  I agree to share data related to this issue for support purposes
                </span>
              </label>

              <p className="text-[10px] text-gray-400">
                Error details, parameters, and payload will be automatically attached to the ticket.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !consent || sending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send to Support
              </button>
            </div>
          </form>
        )}

        {state.step === 'success' && (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Ticket Created</h3>
            <p className="text-sm text-gray-500 mt-1.5 max-w-[300px] mx-auto">
              Your support ticket has been submitted. Our team will review it shortly.
            </p>

            <div className="flex items-center justify-center mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {state.step === 'error' && (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Failed to Create Ticket</h3>
            <p className="text-sm text-gray-500 mt-1.5 max-w-[300px] mx-auto">
              {state.message}
            </p>

            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setState({ step: 'form' })}
                className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

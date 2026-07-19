/**
 * Action Logs Sidebar — Baton
 * Unified view: one Action = one webhook → one automation trigger.
 * Shows webhook verification status + Maestro trigger status in one card.
 */
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import {
  useAutomationActions, resolveRuleFailures, retryInstance, reportInstance, type AutomationAction,
  useAutomationQueue, releaseQueuedWebhook, cancelQueuedWebhook, type QueuedWebhook,
} from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';
import {
  X, Loader2, Clock, AlertTriangle, Copy,
  RefreshCw, CheckCircle2, XCircle, Loader, MessageSquareWarning,
  ChevronRight, Play, Trash2, Pause, Search,
} from 'lucide-react';
import clsx from 'clsx';
import batonLogo from '@/assets/baton.svg';
import { uselegacyTogglesActive } from '@/lib/editorTools';
import { usePagination, PaginationFooter } from '@/components/ui/Pagination';
import { matchesQuery, inputsToText } from '@/components/flows/instanceFilters';

// ─── Status config ───────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  completed: 'border-l-green-500',
  running:   'border-l-blue-500',
  failed:    'border-l-red-500',
  cancelled: 'border-l-gray-400',
};

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  running:   'bg-blue-500 animate-pulse',
  failed:    'bg-red-500',
  cancelled: 'bg-gray-400',
};

type FilterStatus = 'running' | 'completed' | 'failed' | 'cancelled';
const FILTER_ORDER: FilterStatus[] = ['running', 'completed', 'failed', 'cancelled'];
const FILTER_CFG: Record<FilterStatus, { bg: string; text: string; dot: string; label: string }> = {
  running:   { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Running/Queued' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Completed'      },
  failed:    { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Failed'         },
  cancelled: { bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400',    label: 'Cancelled'      },
};

// Action's responsibility ends at triggering the workflow. Whatever happens to
// the Maestro instance afterwards belongs to the workflow-instance view, not
// here — so instance.status is intentionally ignored for the Action badge.
function getDisplayStatus(action: AutomationAction): FilterStatus {
  if (action.status === 'failed') return 'failed';
  if (action.status === 'launched') return 'completed';
  return 'running';
}

// ─── Sidebar ─────────────────────────────────────────────────

interface ActionLogsSidebarProps {
  open: boolean;
  ruleId: string | null;
  ruleName: string | null;
  ruleStatus?: string | null;
  initialActionNumber?: number | null;
  onClose: () => void;
}

export function ActionLogsSidebar({ open, ruleId, ruleName, ruleStatus, initialActionNumber, onClose }: ActionLogsSidebarProps) {
  const { data, isLoading, mutate: mutateActions } = useAutomationActions(ruleId);
  const isPaused = ruleStatus === 'paused';
  const { data: queueData, mutate: mutateQueue } = useAutomationQueue(ruleId, isPaused);
  const queueItems: QueuedWebhook[] = queueData?.items || [];
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // const { mutate } = useSWRConfig();
  const actions = data?.actions || [];
  const [activeFilters, setActiveFilters] = useState<Set<FilterStatus>>(new Set());
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The relay log never dims the rest of the screen — the canvas (and the
  // Activity Log, when open alongside) stays interactive. Close via ESC/X
  // instead of click-outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleRelease(itemId: string) {
    if (!ruleId) return;
    setReleasingId(itemId);
    try {
      await releaseQueuedWebhook(ruleId, itemId);
      toast.success('Webhook released — workflow will launch shortly');
      mutateQueue();
      mutateActions();
    } catch {
      toast.error('Failed to release webhook');
    } finally {
      setReleasingId(null);
    }
  }

  async function handleCancel(itemId: string) {
    if (!ruleId) return;
    setCancellingId(itemId);
    try {
      await cancelQueuedWebhook(ruleId, itemId);
      toast.success('Webhook cancelled');
      mutateQueue();
    } catch {
      toast.error('Failed to cancel webhook');
    } finally {
      setCancellingId(null);
    }
  }
  // legacyToggle: bulk-resolve failed instances for this rule.
  const cheatsActive = uselegacyTogglesActive();
  const { mutate } = useSWRConfig();
  const [resolving, setResolving] = useState(false);
  async function handleResolveFailures() {
    if (!ruleId) return;
    setResolving(true);
    try {
      const { resolved } = await resolveRuleFailures(ruleId);
      toast.success(`Resolved ${resolved} failed instance${resolved !== 1 ? 's' : ''}`);
      mutateActions();
      mutate('/instances/counts');
      mutate('/workflows');
    } catch {
      toast.error('Failed to resolve instances');
    } finally {
      setResolving(false);
    }
  }

  useEffect(() => {
    if (initialActionNumber != null && actions.length > 0) {
      const match = actions.find((a) => a.actionNumber === initialActionNumber);
      if (match) setExpandedId(match.pipelineEntryId);
    }
  }, [initialActionNumber, actions]);
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('baton-reported-ids') || '[]')); } catch { return new Set(); }
  });

  function toggleFilter(s: FilterStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = actions.filter((a) => {
    if (activeFilters.size > 0 && !activeFilters.has(getDisplayStatus(a))) return false;
    if (q) {
      const matches = matchesQuery([
        a.actionNumber != null ? `Relay ${a.actionNumber}` : null,
        a.webhookEventId,
        a.pipelineEntryId,
        a.userMessage,
        a.errorMessage,
        a.instance?.id,
        a.instance?.maestroInstanceId,
        a.instance?.errorMessage,
        a.payload ? inputsToText(a.payload) : null,
        a.instance?.inputData ? inputsToText(a.instance.inputData) : null,
      ], q);
      if (!matches) return false;
    }
    return true;
  });

  const counts: Record<FilterStatus, number> = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const a of actions) counts[getDisplayStatus(a)]++;

  const pagination = usePagination(filtered, {
    storageKey: 'baton-relays-page-size',
    resetKey: `${ruleId ?? ''}|${[...activeFilters].sort().join(',')}|${q}`,
  });
  const { pageItems } = pagination;

  return (
    <>
      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full md:w-[520px] bg-[#f8f9fb] z-50 transition-transform duration-300 ease-out flex flex-col',
          'border-l border-gray-200 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200/80">
          <div className="flex items-center gap-3 px-5 pt-5 pb-4">
            <div className="p-2.5 bg-gradient-to-br from-brand-50 to-indigo-50 rounded-xl shrink-0 ring-1 ring-brand-100/60">
              <img src={batonLogo} alt="Baton" className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-gray-900 truncate leading-tight">{ruleName}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {actions.length} relay{actions.length !== 1 ? 's' : ''}
              </p>
            </div>
            {cheatsActive && (
              <button
                onClick={handleResolveFailures}
                disabled={resolving}
                title="legacyToggle — bulk-resolve failed instances for this rule"
                className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-md shrink-0 transition-colors flex items-center gap-1"
              >
                {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Fix
              </button>
            )}
            <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-gray-100 shrink-0 transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Search */}
          {actions.length > 0 && (
            <div className="px-5 pb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by relay, ID, message, payload…"
                  className="w-full pl-8 pr-8 py-1.5 text-[12px] bg-gray-50 border border-gray-200 rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-300 focus:bg-white transition-colors"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Filter chips */}
          {actions.length > 0 && (
            <div className="flex items-center gap-1.5 px-5 pb-3.5 flex-wrap">
              {FILTER_ORDER.map((s) => {
                const c = counts[s];
                const active = activeFilters.has(s);
                const fc = FILTER_CFG[s];
                return (
                  <button
                    key={s}
                    onClick={() => toggleFilter(s)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                      active
                        ? `${fc.bg} ${fc.text} border-current/15`
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                    )}
                  >
                    <span className={clsx('w-1.5 h-1.5 rounded-full', active ? fc.dot : 'bg-gray-300')} />
                    {c} {fc.label}
                  </button>
                );
              })}
              {activeFilters.size > 0 && (
                <button
                  onClick={() => setActiveFilters(new Set())}
                  className="text-[10px] text-gray-400 hover:text-gray-600 ml-1 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Paused queue banner */}
        {isPaused && (
          <div className="mx-3 mt-3 rounded-xl border border-yellow-200 bg-yellow-50 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-yellow-100">
              <Pause className="w-3.5 h-3.5 text-yellow-600 shrink-0" />
              <span className="text-[12px] font-semibold text-yellow-800 flex-1">Paused — webhooks in queue</span>
              {queueItems.length > 0 && (
                <span className="text-[10px] font-medium bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded-full">
                  {queueItems.length}
                </span>
              )}
            </div>
            {queueItems.length === 0 ? (
              <p className="px-4 py-3 text-[11px] text-yellow-700">No webhooks queued yet.</p>
            ) : (
              <div className="divide-y divide-yellow-100">
                {queueItems.map((item) => (
                  <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-yellow-900 truncate">{item.eventSummary || item.eventType}</p>
                      <p className="text-[10px] text-yellow-600 mt-0.5">{timeAgo(item.queuedAt)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRelease(item.id)}
                        disabled={releasingId === item.id || cancellingId === item.id}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 disabled:opacity-50 transition-colors"
                        title="Let through"
                      >
                        {releasingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Let through
                      </button>
                      <button
                        onClick={() => handleCancel(item.id)}
                        disabled={cancellingId === item.id || releasingId === item.id}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50 transition-colors"
                        title="Cancel"
                      >
                        {cancellingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : actions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center px-8">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">No relays yet</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-[220px]">
                Relays appear here when this automation processes incoming webhooks.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <p className="text-sm font-medium text-gray-600">No matches</p>
              <p className="text-xs text-gray-400 mt-1">No relays match the current search or filters</p>
            </div>
          ) : (
            <div className="bg-white mx-3 my-3 rounded-xl border border-gray-200 overflow-hidden">
              {pageItems.map((action, i) => (
                <ActionCard
                  key={action.pipelineEntryId}
                  action={action}
                  isLast={i === pageItems.length - 1}
                  expanded={expandedId === action.pipelineEntryId}
                  onToggle={() => setExpandedId(expandedId === action.pipelineEntryId ? null : action.pipelineEntryId)}
                  reported={reportedIds.has(action.instance?.id || '')}
                  onReported={(id) => setReportedIds((prev) => {
                    const next = new Set(prev).add(id);
                    try { localStorage.setItem('baton-reported-ids', JSON.stringify([...next])); } catch {}
                    return next;
                  })}
                  onRetried={() => mutateActions()}
                />
              ))}
            </div>
          )}
        </div>

        {filtered.length > 0 && <PaginationFooter {...pagination} />}
      </div>
    </>
  );
}

// ─── Action Card ─────────────────────────────────────────────

function ActionCard({ action, isLast, expanded, onToggle, reported, onReported, onRetried }: {
  action: AutomationAction;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  reported: boolean;
  onReported: (instanceId: string) => void;
  onRetried?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const borderColor = STATUS_BORDER[getDisplayStatus(action)] || 'border-l-gray-300';
  const label = action.actionNumber != null ? `Relay ${action.actionNumber}` : 'Relay';

  const isAutoRetrying = action.instance?.status === 'running' && (action.instance.retryCount ?? 0) > 0;
  const retriesExhausted = action.instance?.status === 'failed'
    && (action.instance.retryCount ?? 0) >= (action.instance.retryMaxAttempts ?? 6);
  const canRetry = (isAutoRetrying || action.instance?.status === 'failed') && !!action.instance;

  async function handleRetry() {
    if (!action.instance) return;
    setRetrying(true);
    try {
      await retryInstance(action.instance.id);
      toast.success('Retry initiated');
      onRetried?.();
    } catch {
      // error shown by global handler
    } finally {
      setRetrying(false);
    }
  }

  async function handleReport() {
    if (!action.instance) return;
    setReporting(true);
    try {
      const result = await reportInstance(action.instance.id, {
        title: `Failed: Relay ${action.actionNumber ?? ''}`,
        description: action.instance.errorMessage || action.errorMessage || '',
      });
      toast.success('Support ticket created', { description: result.taskUrl });
      onReported(action.instance.id);
    } catch {
      // error shown by global handler
    } finally {
      setReporting(false);
    }
  }

  function copyId(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  // If instance exists, the Maestro workflow was triggered successfully → always "Launched"
  const maestroTriggerState: StageState =
    !action.instance ? 'pending' : 'success';

  return (
    <div className={clsx(
      'bg-white rounded-lg border border-gray-200/80 overflow-hidden transition-all hover:shadow-sm hover:border-gray-300/80 border-l-[3px]',
      borderColor,
      !isLast && 'mb-2',
    )}>
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/80 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{timeAgo(action.triggeredAt)}</p>
        </div>

        <StatusBadge status={getDisplayStatus(action)} />

        <ChevronRight className={clsx(
          'w-4 h-4 text-gray-400 shrink-0 transition-transform duration-150',
          expanded && 'rotate-90',
        )} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2.5">

          {/* IDs + meta block */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex flex-col gap-y-1.5 text-xs">
              <IdRow
                label="Webhook ID"
                value={action.webhookEventId}
                onCopy={() => action.webhookEventId && copyId(action.webhookEventId, 'Webhook ID')}
              />
              <IdRow
                label="Relay ID"
                value={action.pipelineEntryId}
                onCopy={() => copyId(action.pipelineEntryId, 'Relay ID')}
              />
              <IdRow
                label="Maestro Instance ID"
                value={action.instance?.maestroInstanceId ?? null}
                onCopy={() => action.instance?.maestroInstanceId && copyId(action.instance.maestroInstanceId, 'Maestro Instance ID')}
              />
              <div className="border-t border-gray-200/60 mt-1 pt-1.5 flex flex-col gap-y-1">
                <MetaRow label="Triggered" value={new Date(action.triggeredAt).toLocaleString()} />
                {action.instance?.status === 'completed' && (
                  <MetaRow label="Completed" value="✓ Completed" green />
                )}
                {isAutoRetrying && (
                  <MetaRow
                    label="Retry"
                    value={`${action.instance?.retryCount}/${action.instance?.retryMaxAttempts ?? 6}`}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Stage indicators */}
          <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-2">
            <StageIndicator
              label="Webhook verification"
              state={action.signatureValid === false ? 'error' : 'success'}
              successText="Verified"
              errorText="Verification failed"
            />
            <StageIndicator
              label="Maestro Trigger"
              state={maestroTriggerState}
              successText="Completed"
              runningText={isAutoRetrying
                ? `Retry ${action.instance?.retryCount}/${action.instance?.retryMaxAttempts ?? 6}`
                : 'In progress'
              }
              errorText="Failed"
            />
          </div>

          {/* Payload — collapsible */}
          {action.payload && Object.keys(action.payload).length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={(e) => { e.stopPropagation(); setPayloadOpen(!payloadOpen); }}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-xs font-medium text-gray-700"
              >
                <span>View Payload</span>
                <div className="flex items-center gap-2">
                  {payloadOpen && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(JSON.stringify(action.payload, null, 2));
                        toast.success('Copied to clipboard');
                      }}
                      className="p-1 hover:bg-gray-200 rounded transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3 text-gray-500" />
                    </span>
                  )}
                  <ChevronRight className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform duration-150', payloadOpen && 'rotate-90')} />
                </div>
              </button>
              {payloadOpen && (
                <pre className="p-3 text-[11px] text-gray-700 font-mono bg-white overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(action.payload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Error/user message */}
          {action.userMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-yellow-50 rounded-lg text-yellow-800 text-xs border border-yellow-100">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{action.userMessage}</span>
            </div>
          )}
          {action.errorMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-red-50 rounded-lg text-red-700 text-xs border border-red-100">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <pre className="font-mono whitespace-pre-wrap break-all flex-1">{action.errorMessage}</pre>
            </div>
          )}

          {/* Action buttons */}
          {(canRetry || retriesExhausted) && (
            <div className="flex items-center gap-2 pt-0.5">
              {canRetry && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50 rounded-lg border border-brand-200 transition-colors disabled:opacity-50"
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Retry now
                </button>
              )}
              {isAutoRetrying && action.instance?.nextRetryAt && (
                <span className="text-[10px] text-gray-400">
                  Next retry in <RetryCountdown nextRetryAt={action.instance.nextRetryAt} />
                </span>
              )}
              {retriesExhausted && action.instance && (
                <button
                  onClick={handleReport}
                  disabled={reporting || reported}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50 rounded-lg border border-amber-200 transition-colors disabled:opacity-50 ml-auto"
                >
                  {reporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquareWarning className="w-3 h-3" />}
                  {reported ? 'Reported' : 'Contact Support'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatusBadge({ status }: { status: FilterStatus }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full min-w-[78px] justify-center',
      status === 'completed' ? 'bg-green-50 text-green-700' :
      status === 'failed'    ? 'bg-red-50 text-red-700' :
      status === 'running'   ? 'bg-blue-50 text-blue-700' :
      'bg-gray-100 text-gray-600',
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[status] || 'bg-gray-400')} />
      {status}
    </span>
  );
}

function MetaRow({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 w-20 shrink-0">{label}</span>
      <span className={clsx('text-[11px]', green ? 'text-green-600 font-medium' : 'text-gray-500')}>{value}</span>
    </div>
  );
}

function IdRow({ label, value, onCopy }: { label: string; value: string | null | undefined; onCopy?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 w-24 shrink-0">{label}</span>
      {value ? (
        <span className="text-gray-700 font-mono text-[11px] break-all flex-1">{value}</span>
      ) : (
        <span className="text-gray-300">—</span>
      )}
      {value && onCopy && (
        <button onClick={onCopy} className="p-0.5 hover:bg-gray-200 rounded transition-colors shrink-0">
          <Copy className="w-3 h-3 text-gray-400" />
        </button>
      )}
    </div>
  );
}

type StageState = 'success' | 'running' | 'error' | 'pending';

function StageIndicator({ label, state, successText, runningText, errorText }: {
  label: string;
  state: StageState;
  successText?: string;
  runningText?: string;
  errorText?: string;
}) {
  const icon =
    state === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> :
    state === 'running' ? <Loader className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" /> :
    state === 'error'   ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> :
    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 shrink-0" />;

  const text =
    state === 'success' ? (successText ?? 'Done') :
    state === 'running' ? (runningText ?? 'In progress') :
    state === 'error'   ? (errorText ?? 'Failed') :
    '—';

  const textColor =
    state === 'success' ? 'text-green-700' :
    state === 'running' ? 'text-blue-600' :
    state === 'error'   ? 'text-red-600' :
    'text-gray-400';

  return (
    <div className="flex items-center gap-2 text-xs">
      {icon}
      <span className="text-gray-600 flex-1">{label}</span>
      <span className={clsx('font-medium', textColor)}>{text}</span>
    </div>
  );
}

function RetryCountdown({ nextRetryAt }: { nextRetryAt: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function calc() {
      const diff = new Date(nextRetryAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('now'); return; }
      const secs = Math.ceil(diff / 1000);
      if (secs < 60) setLabel(`${secs}s`);
      else {
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        setLabel(s > 0 ? `${mins}m ${s}s` : `${mins}m`);
      }
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [nextRetryAt]);

  return <>{label}</>;
}

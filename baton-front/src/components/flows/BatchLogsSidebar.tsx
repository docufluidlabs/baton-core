/**
 * Batch Logs Sidebar - Bulk Upload runs and rows
 *
 * Two-level drawer patterned on ActionLogsSidebar:
 *  Level 1 - run cards (counts, settings, Pause/Resume, Cancel all with scope dialog)
 *  Level 2 - drill-in rows for one run (filter chips, expandable row cards)
 *
 * Run-level "Cancel all" lives HERE, on purpose - never on the canvas bubble.
 * Opening the sidebar while a run is active lands directly on that run's rows.
 */
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import {
  useBatchRuns, useBatchRows,
  pauseBatchRun, resumeBatchRun, cancelBatchRun, cancelBatchRow,
  type BatchProcessor, type BatchRunSummary, type BatchRow, type BatchRowStatus,
} from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';
import {
  X, Loader2, Clock, Copy, CheckCircle2, XCircle, Loader,
  ChevronRight, ChevronLeft, Play, Pause, Ban, ExternalLink, Download, AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import batonLogo from '@/assets/baton.svg';
import { useFlowStore } from '@/stores/flowStore';
import { usePagination, PaginationFooter } from '@/components/ui/Pagination';

// ─── Status config ───────────────────────────────────────────

const RUN_BADGE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  queued:    'bg-blue-50 text-blue-600',
  running:   'bg-blue-50 text-blue-700',
  paused:    'bg-yellow-50 text-yellow-700',
  completed: 'bg-green-50 text-green-700',
  stopped:   'bg-amber-50 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const ROW_CFG: Record<BatchRowStatus, { border: string; dot: string; bg: string; text: string; label: string }> = {
  staged:    { border: 'border-l-gray-300', dot: 'bg-gray-400',               bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Staged'    },
  queued:    { border: 'border-l-gray-300', dot: 'bg-gray-400',               bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Queued'    },
  launching: { border: 'border-l-blue-400', dot: 'bg-blue-400 animate-pulse', bg: 'bg-blue-50',    text: 'text-blue-700',   label: 'Launching' },
  launched:  { border: 'border-l-blue-500', dot: 'bg-blue-500',               bg: 'bg-blue-50',    text: 'text-blue-700',   label: 'Launched'  },
  running:   { border: 'border-l-blue-500', dot: 'bg-blue-500 animate-pulse', bg: 'bg-blue-50',    text: 'text-blue-700',   label: 'Running'   },
  completed: { border: 'border-l-green-500', dot: 'bg-green-500',             bg: 'bg-green-50',   text: 'text-green-700',  label: 'Completed' },
  failed:    { border: 'border-l-red-500',  dot: 'bg-red-500',                bg: 'bg-red-50',     text: 'text-red-700',    label: 'Failed'    },
  cancelled: { border: 'border-l-gray-400', dot: 'bg-gray-400',               bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Cancelled' },
  skipped:   { border: 'border-l-amber-400', dot: 'bg-amber-400',             bg: 'bg-amber-50',   text: 'text-amber-700',  label: 'Skipped'   },
};

const ROW_FILTER_ORDER: BatchRowStatus[] = [
  'staged', 'queued', 'launching', 'running', 'launched', 'completed', 'failed', 'cancelled', 'skipped',
];

const CANCELLABLE_ROW_STATUSES = new Set<BatchRowStatus>(['queued', 'launching', 'launched', 'running']);

function countsLine(run: BatchRunSummary): string {
  const c = run.counts;
  const parts: string[] = [];
  if (c.queued > 0) parts.push(`${c.queued} queued`);
  if (c.running > 0) parts.push(`${c.running} running`);
  if (c.completed > 0) parts.push(`${c.completed} completed`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.cancelled > 0) parts.push(`${c.cancelled} cancelled`);
  if (c.skipped > 0) parts.push(`${c.skipped} skipped`);
  return parts.length > 0 ? parts.join(' · ') : `${run.selectedRows} of ${run.totalRows} rows selected`;
}

// ─── Sidebar ─────────────────────────────────────────────────

interface BatchLogsSidebarProps {
  open: boolean;
  processor: BatchProcessor | null;
  workflowName?: string | null;
  onClose: () => void;
}

export function BatchLogsSidebar({ open, processor, workflowName, onClose }: BatchLogsSidebarProps) {
  const processorId = open && processor ? processor.id : null;
  const { data: runsData, isLoading: runsLoading, mutate: mutateRuns } = useBatchRuns(processorId);
  const runs = (runsData?.runs || []).filter((r) => r.status !== 'draft');
  const { mutate } = useSWRConfig();
  const openActivityLog = useFlowStore((s) => s.openActivityLog);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [cancellingRun, setCancellingRun] = useState<BatchRunSummary | null>(null);
  const [pausingRunId, setPausingRunId] = useState<string | null>(null);

  // Land directly on the active run's rows when one is live.
  useEffect(() => {
    if (!open) return;
    setSelectedRunId(processor?.activeRun?.id ?? null);
  }, [open, processor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on ESC - like ActionLogsSidebar, the canvas stays interactive.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function refresh() {
    mutateRuns();
    mutate('/batch-processors');
  }

  async function handlePauseResume(run: BatchRunSummary) {
    if (!processor) return;
    setPausingRunId(run.id);
    try {
      if (run.status === 'running') await pauseBatchRun(processor.id, run.id);
      else await resumeBatchRun(processor.id, run.id);
      refresh();
    } catch {
      // error shown by global handler
    } finally {
      setPausingRunId(null);
    }
  }

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

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
            <div className="p-2.5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shrink-0 ring-1 ring-blue-100/60">
              <img src={batonLogo} alt="Baton" className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-gray-900 truncate leading-tight">{processor?.name}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                Bulk Upload · {runs.length} run{runs.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-gray-100 shrink-0 transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        {selectedRun && processor ? (
          <RunRowsView
            processor={processor}
            run={selectedRun}
            workflowName={workflowName}
            onBack={() => setSelectedRunId(null)}
            onOpenInstance={() => openActivityLog(processor.targetWorkflowId, workflowName ?? null)}
            onChanged={refresh}
          />
        ) : (
          /* ── Level 1: run cards ─────────────────────── */
          <div className="flex-1 overflow-y-auto">
            {runsLoading && runs.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center px-8">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <Clock className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-600">No runs yet</p>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-[220px]">
                  Upload a file to start the first run.
                </p>
              </div>
            ) : (
              <div className="px-3 py-3 space-y-2">
                {runs.map((run) => {
                  const isActive = run.status === 'running' || run.status === 'paused' || run.status === 'stopped';
                  // A queued run can be cancelled (it never launched anything)
                  // but not paused/resumed - it is not running yet.
                  const canCancel = isActive || run.status === 'queued';
                  return (
                    <div key={run.id} className="bg-white rounded-xl border border-gray-200/80 overflow-hidden hover:shadow-sm hover:border-gray-300/80 transition-all">
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">Run {run.runNumber}</p>
                          <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full', RUN_BADGE[run.status] || RUN_BADGE.draft)}>
                            {run.status}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                            {run.startedAt ? timeAgo(run.startedAt) : ''}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">{run.fileName}</p>
                        <p className="text-[11px] text-gray-400 mt-1">{countsLine(run)}</p>
                        {run.settings && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            Release {run.settings.releaseCount} every {run.settings.intervalMinutes} min · stop
                            after {run.settings.stopAfterFailures} failures
                          </p>
                        )}
                      </div>
                      <div className="flex items-center border-t border-gray-100 divide-x divide-gray-100">
                        <button
                          onClick={() => setSelectedRunId(run.id)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-gray-500 hover:text-brand-600 hover:bg-gray-50 transition-colors"
                        >
                          Rows ({run.selectedRows}) <ChevronRight className="w-3 h-3" />
                        </button>
                        {isActive && (
                          <button
                            onClick={() => handlePauseResume(run)}
                            disabled={pausingRunId === run.id}
                            className={clsx(
                              'flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50',
                              run.status === 'running'
                                ? 'text-amber-600 hover:bg-amber-50/50'
                                : 'text-green-600 hover:bg-green-50/50',
                            )}
                          >
                            {pausingRunId === run.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : run.status === 'running' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            {run.status === 'running' ? 'Pause' : 'Resume'}
                          </button>
                        )}
                        {canCancel && (
                          <button
                            onClick={() => setCancellingRun(run)}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50/50 transition-colors"
                          >
                            <Ban className="w-3 h-3" /> Cancel all
                          </button>
                        )}
                        <button
                          disabled
                          title="Export CSV is coming soon"
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-gray-300 cursor-not-allowed"
                        >
                          <Download className="w-3 h-3" /> Export · soon
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel-all scope dialog */}
      {cancellingRun && processor && (
        <CancelRunModal
          run={cancellingRun}
          onCancel={() => setCancellingRun(null)}
          onConfirm={async (scope) => {
            try {
              await cancelBatchRun(processor.id, cancellingRun.id, scope);
              refresh();
            } catch {
              // error shown by global handler
            } finally {
              setCancellingRun(null);
            }
          }}
        />
      )}
    </>
  );
}

// ─── Cancel scope dialog ─────────────────────────────────────
// Patterned on ui/ConfirmModal, extended with a scope choice - ConfirmModal
// itself has no option slot.

function CancelRunModal({ run, onCancel, onConfirm }: {
  run: BatchRunSummary;
  onCancel: () => void;
  onConfirm: (scope: 'queued' | 'all') => Promise<void>;
}) {
  const [scope, setScope] = useState<'queued' | 'all'>('queued');
  const [loading, setLoading] = useState(false);
  const queuedCount = run.counts.queued;
  const allCount = run.counts.queued + run.counts.running;

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(scope);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-sm mx-4 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Cancel run {run.runNumber}?</h3>
            <p className="text-sm text-gray-500 mt-1">Choose what to cancel. This cannot be undone.</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              checked={scope === 'queued'}
              onChange={() => setScope('queued')}
              className="accent-red-600 mt-0.5"
            />
            <span>
              Queue only ({queuedCount})
              <span className="block text-[11px] text-gray-400">Rows not launched yet are cancelled; launched instances keep running</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
              className="accent-red-600 mt-0.5"
            />
            <span>
              Queue and launched ({allCount})
              <span className="block text-[11px] text-gray-400">Also cancels workflow instances that are still running</span>
            </span>
          </label>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Keep running
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors bg-red-600 text-white hover:bg-red-700"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel rows
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Level 2: rows of one run ────────────────────────────────

function RunRowsView({ processor, run, workflowName, onBack, onOpenInstance, onChanged }: {
  processor: BatchProcessor;
  run: BatchRunSummary;
  workflowName?: string | null;
  onBack: () => void;
  onOpenInstance: () => void;
  onChanged: () => void;
}) {
  const { data, isLoading, mutate: mutateRows } = useBatchRows(processor.id, run.id);
  const rows = data?.rows || [];
  const [activeFilters, setActiveFilters] = useState<Set<BatchRowStatus>>(new Set());
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [cancellingRow, setCancellingRow] = useState<number | null>(null);

  const counts = new Map<BatchRowStatus, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const presentStatuses = ROW_FILTER_ORDER.filter((s) => (counts.get(s) ?? 0) > 0);

  function toggleFilter(s: BatchRowStatus) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const filtered = rows.filter((r) => activeFilters.size === 0 || activeFilters.has(r.status));

  const pagination = usePagination(filtered, {
    storageKey: 'baton-batch-rows-page-size',
    resetKey: `${run.id}|${[...activeFilters].sort().join(',')}`,
  });
  const { pageItems } = pagination;

  async function handleCancelRow(row: BatchRow) {
    setCancellingRow(row.rowNumber);
    try {
      await cancelBatchRow(processor.id, run.id, row.rowNumber);
      mutateRows();
      onChanged();
    } catch {
      // error shown by global handler
    } finally {
      setCancellingRow(null);
    }
  }

  return (
    <>
      {/* Breadcrumb + chips */}
      <div className="bg-white border-b border-gray-200/80">
        <div className="px-5 pt-3 pb-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> All runs
          </button>
          <div className="flex items-center gap-2 mt-1.5">
            <p className="text-[13px] font-semibold text-gray-900 truncate">
              Run {run.runNumber} · {run.fileName}
            </p>
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0', RUN_BADGE[run.status] || RUN_BADGE.draft)}>
              {run.status}
            </span>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center gap-1.5 px-5 pb-3 flex-wrap">
            {presentStatuses.map((s) => {
              const c = counts.get(s) ?? 0;
              const active = activeFilters.has(s);
              const rc = ROW_CFG[s];
              return (
                <button
                  key={s}
                  onClick={() => toggleFilter(s)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                    active
                      ? `${rc.bg} ${rc.text} border-current/15`
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                  )}
                >
                  <span className={clsx('w-1.5 h-1.5 rounded-full', active ? rc.dot : 'bg-gray-300')} />
                  {c} {rc.label}
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

      {/* Row list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <p className="text-sm font-medium text-gray-600">No rows</p>
            <p className="text-xs text-gray-400 mt-1">No rows match the current filters</p>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-1.5">
            {pageItems.map((row) => (
              <RowCard
                key={row.rowNumber}
                row={row}
                workflowName={workflowName}
                expanded={expandedRow === row.rowNumber}
                onToggle={() => setExpandedRow(expandedRow === row.rowNumber ? null : row.rowNumber)}
                onOpenInstance={onOpenInstance}
                cancelling={cancellingRow === row.rowNumber}
                onCancel={() => handleCancelRow(row)}
              />
            ))}
          </div>
        )}
      </div>

      {filtered.length > 0 && <PaginationFooter {...pagination} />}
    </>
  );
}

// ─── Row card ────────────────────────────────────────────────

function RowCard({ row, workflowName, expanded, onToggle, onOpenInstance, cancelling, onCancel }: {
  row: BatchRow;
  workflowName?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenInstance: () => void;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const rc = ROW_CFG[row.status] ?? ROW_CFG.staged;
  const hasProblems = row.problems.length > 0;
  const canCancel = CANCELLABLE_ROW_STATUSES.has(row.status);

  // Workflow trigger stage: launched once an instance id exists.
  const triggerState: 'success' | 'running' | 'error' | 'pending' =
    row.workflowInstanceId ? 'success' :
    row.status === 'launching' ? 'running' :
    row.status === 'failed' ? 'error' :
    'pending';

  const stepLine = row.instance?.status === 'running' && row.instance.totalSteps
    ? `step ${Math.min((row.instance.lastCompletedStep ?? 0) + 1, row.instance.totalSteps)} of ${row.instance.totalSteps}${row.instance.currentStep ? ` - ${row.instance.currentStep}` : ''}`
    : null;

  function copyId(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  return (
    <div className={clsx(
      'bg-white rounded-lg border border-gray-200/80 overflow-hidden transition-all hover:shadow-sm hover:border-gray-300/80 border-l-[3px]',
      rc.border,
    )}>
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/80 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
          {row.launchedAt && <p className="text-xs text-gray-400 mt-0.5">{timeAgo(row.launchedAt)}</p>}
        </div>
        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0', rc.bg, rc.text)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', rc.dot)} />
          {rc.label}
        </span>
        <ChevronRight className={clsx('w-4 h-4 text-gray-400 shrink-0 transition-transform duration-150', expanded && 'rotate-90')} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2.5">
          {/* File row values */}
          <div className="bg-gray-50 rounded-lg p-3 max-h-[180px] overflow-y-auto">
            <div className="flex flex-col gap-y-1 text-xs">
              {Object.entries(row.data).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2">
                  <span className="text-gray-400 w-28 shrink-0 truncate" title={k}>{k}</span>
                  <span className="text-gray-700 font-mono text-[11px] break-all flex-1">{v || '·'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stages */}
          <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-2">
            <BatchStageIndicator
              label="Row validation"
              state={hasProblems ? 'error' : 'success'}
              text={hasProblems ? `${row.problems.length} problem${row.problems.length !== 1 ? 's' : ''}` : 'Valid'}
            />
            {hasProblems && (
              <ul className="pl-5 space-y-0.5">
                {row.problems.map((p) => (
                  <li key={p} className="text-[11px] text-red-600">{p}</li>
                ))}
              </ul>
            )}
            <BatchStageIndicator
              label="Workflow Trigger"
              state={triggerState}
              text={
                triggerState === 'success' ? 'Launched' :
                triggerState === 'running' ? 'Launching' :
                triggerState === 'error' ? 'Failed' :
                row.status === 'skipped' ? 'Skipped' :
                row.status === 'cancelled' ? 'Cancelled' :
                'Queued'
              }
            />
            {stepLine && (
              <p className="text-[11px] text-blue-600 pl-5">{stepLine}</p>
            )}
          </div>

          {/* Instance ID */}
          {(row.maestroInstanceId || row.workflowInstanceId) && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-24 shrink-0">Instance ID</span>
                <span className="text-gray-700 font-mono text-[11px] break-all flex-1">
                  {row.maestroInstanceId || row.workflowInstanceId}
                </span>
                <button
                  onClick={() => copyId(row.maestroInstanceId || row.workflowInstanceId || '', 'Instance ID')}
                  className="p-0.5 hover:bg-gray-200 rounded transition-colors shrink-0"
                >
                  <Copy className="w-3 h-3 text-gray-400" />
                </button>
              </div>
            </div>
          )}

          {row.errorMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-red-50 rounded-lg text-red-700 text-xs border border-red-100">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <pre className="font-mono whitespace-pre-wrap break-all flex-1">{row.errorMessage}</pre>
            </div>
          )}

          {/* Actions */}
          {(row.workflowInstanceId || canCancel) && (
            <div className="flex items-center gap-2 pt-0.5">
              {row.workflowInstanceId && (
                <button
                  onClick={onOpenInstance}
                  title={workflowName ? `Open ${workflowName} instances` : 'Open instances'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50 rounded-lg border border-brand-200 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Open instance
                </button>
              )}
              {canCancel && (
                <button
                  onClick={onCancel}
                  disabled={cancelling}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50 rounded-lg border border-red-200 transition-colors disabled:opacity-50 ml-auto"
                >
                  {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                  Cancel row
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BatchStageIndicator({ label, state, text }: {
  label: string;
  state: 'success' | 'running' | 'error' | 'pending';
  text: string;
}) {
  const icon =
    state === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> :
    state === 'running' ? <Loader className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" /> :
    state === 'error'   ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" /> :
    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 shrink-0" />;

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

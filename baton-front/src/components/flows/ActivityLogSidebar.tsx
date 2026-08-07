import { useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import {
  useWorkflows,
  useAutomations,
  useBatchProcessors,
  cancelInstance,
  retryInstance,
  type WorkflowInstance,
} from '@/hooks/useApi';
import { InstanceCard, STATUS, FILTER_ORDER, resolveDisplayInputs, type Status } from './InstancesSidebar';
import { monthRangeBounds, withinBounds, matchesQuery, inputsToText, byStartedAtDesc } from './instanceFilters';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { usePagination, PaginationFooter } from '@/components/ui/Pagination';
import { X, Loader2, Activity, Clock, Search, GitBranch, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';

interface ActivityLogSidebarProps {
  open: boolean;
  onClose: () => void;
  onActionClick?: (ruleId: string, ruleName: string, actionNumber: number) => void;
  /** When set, the feed opens pre-filtered to a single workflow (removable chip). */
  workflowId?: string | null;
  workflowName?: string | null;
}

export function ActivityLogSidebar({ open, onClose, onActionClick, workflowId, workflowName }: ActivityLogSidebarProps) {
  const { mutate } = useSWRConfig();

  // Fetch all instances across all workflows. SWR is gated on `open` so we
  // don't poll in the background when the sidebar is closed.
  const { data, isLoading, mutate: mutateInstances } = useSWR<{ instances: WorkflowInstance[] }>(
    open ? '/instances?limit=200' : null,
    fetcher,
    { refreshInterval: open ? 10_000 : 0 },
  );
  const { data: wfData } = useWorkflows();
  const { data: autoData } = useAutomations();
  const { data: batchData } = useBatchProcessors();

  const workflows = wfData?.workflows ?? [];
  const workflowMap = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows]);

  // Only show instances that map to something currently on the canvas. The
  // canvas is keyed on automations (pair nodes), and Bulk Upload processors'
  // target workflows count too (Bulk Upload lives on its own page, but its
  // instances belong in the Activity Log all the same):
  //  • rule-launched instances must belong to an automation that still exists
  //    (triggerRuleId match) — this drops instances from a deleted automation
  //    even if a new automation later reuses the same target workflow;
  //  • rule-less instances (manual and Bulk Upload launches) fall back to the
  //    workflow, which counts while an automation or a Bulk Upload
  //    processor targets it.
  // Anything else is historical and must not appear in the Activity Log.
  const canvasAutomationIds = useMemo(
    () => new Set((autoData?.automations ?? []).map((a) => a.id)),
    [autoData],
  );
  const canvasWorkflowIds = useMemo(
    () => new Set([
      ...(autoData?.automations ?? []).map((a) => a.targetWorkflowId),
      ...(batchData?.processors ?? []).map((p) => p.targetWorkflowId),
    ]),
    [autoData, batchData],
  );
  const instances = useMemo(
    () => (data?.instances ?? []).filter((i) =>
      i.triggerRuleId
        ? canvasAutomationIds.has(i.triggerRuleId)
        : canvasWorkflowIds.has(i.workflowId),
    ),
    [data, canvasAutomationIds, canvasWorkflowIds],
  );

  // workflowId → expected duration (days), so running cards can flag overdue
  // instances the same way the single-workflow Instances sidebar does.
  const expectedDurationMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of autoData?.automations ?? []) {
      const raw = a.actionConfig?.expectedDurationDays;
      if (typeof raw === 'number' && raw > 0) map.set(a.targetWorkflowId, raw);
    }
    return map;
  }, [autoData]);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<Status>>(
    () => new Set<Status>(['running', 'completed', 'failed']),
  );
  const [activePlatformFilters, setActivePlatformFilters] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [monthsRange, setMonthsRange] = useState<'this' | 'prev' | 'all'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Single-workflow filter. Seeded from props whenever the panel is opened (or
  // re-targeted at a different workflow), and clearable via its chip.
  const [workflowFilter, setWorkflowFilter] = useState<string | null>(workflowId ?? null);
  // Bulk Upload run filter (batchRunId) - see the instances a given run
  // launched, with everything the Activity Log already offers (QA round 2).
  const [runFilter, setRunFilter] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setWorkflowFilter(workflowId ?? null);
      setRunFilter(null);
    }
  }, [open, workflowId]);
  const workflowFilterName = workflowFilter
    ? workflowMap.get(workflowFilter)?.name ?? workflowName ?? 'Selected workflow'
    : null;

  // ESC closes the panel. Click-outside-to-close was removed alongside the
  // backdrop so the canvas remains interactive while the log is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function toggleFilter(s: Status) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  function togglePlatformFilter(p: string) {
    setActivePlatformFilters((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of instances) {
      const p = i.sourcePlatform;
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return counts;
  }, [instances]);

  const platforms = useMemo(
    () => [...platformCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    [platformCounts],
  );

  // Workflows that actually have instances, most-active first — the options
  // shown in the Workflow filter section. Nested under Platform: scoped to the
  // currently-selected platform(s) so the list only offers relevant workflows.
  const workflowOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of instances) {
      if (activePlatformFilters.size > 0 && (!i.sourcePlatform || !activePlatformFilters.has(i.sourcePlatform))) continue;
      counts.set(i.workflowId, (counts.get(i.workflowId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: workflowMap.get(id)?.name ?? 'Unknown workflow' }))
      .sort((a, b) => b.count - a.count);
  }, [instances, workflowMap, activePlatformFilters]);

  // Bulk Upload runs with instances in the current workflow/platform scope,
  // newest run first. Empty unless batch instances are present.
  const runOptions = useMemo(() => {
    const byRun = new Map<string, { runNumber?: number; count: number }>();
    for (const i of instances) {
      if (!i.batchRunId) continue;
      if (workflowFilter && i.workflowId !== workflowFilter) continue;
      if (activePlatformFilters.size > 0 && (!i.sourcePlatform || !activePlatformFilters.has(i.sourcePlatform))) continue;
      const entry = byRun.get(i.batchRunId) ?? { runNumber: i.batchRunNumber, count: 0 };
      entry.count++;
      if (entry.runNumber == null) entry.runNumber = i.batchRunNumber;
      byRun.set(i.batchRunId, entry);
    }
    return [...byRun.entries()]
      .map(([id, v]) => ({ id, runNumber: v.runNumber, count: v.count }))
      .sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0));
  }, [instances, workflowFilter, activePlatformFilters]);

  // Badge count for the filter menu — how many filter dimensions are narrowing
  // the feed away from its defaults (status defaults to running/completed/failed).
  const DEFAULT_STATUS: Status[] = ['running', 'completed', 'failed'];
  const statusNarrowed =
    activeFilters.size !== DEFAULT_STATUS.length || !DEFAULT_STATUS.every((s) => activeFilters.has(s));
  const activeFilterCount =
    (monthsRange !== 'all' ? 1 : 0) +
    (activePlatformFilters.size > 0 ? 1 : 0) +
    (workflowFilter ? 1 : 0) +
    (runFilter ? 1 : 0) +
    (statusNarrowed ? 1 : 0);

  const q = query.trim().toLowerCase();
  const dateBounds = monthRangeBounds(monthsRange, new Date());

  // Everything EXCEPT the status facet — workflow, platform, period, search.
  // This is the scope the status counts are measured against, so toggling a
  // status chip never changes the others, but selecting a workflow/platform/
  // period does.
  const scoped = instances.filter((i) => {
    if (workflowFilter && i.workflowId !== workflowFilter) return false;
    if (runFilter && i.batchRunId !== runFilter) return false;
    if (activePlatformFilters.size > 0 && (!i.sourcePlatform || !activePlatformFilters.has(i.sourcePlatform))) return false;
    if (!withinBounds(i.startedAt, dateBounds)) return false;
    if (q) {
      const wf = workflowMap.get(i.workflowId);
      const inputs = i.inputData ? resolveDisplayInputs(i.inputData, wf?.triggerInputSchema) : {};
      const matches = matchesQuery([
        i.instanceName,
        i.triggerRuleName,
        i.startedByName,
        i.sourcePlatform,
        i.errorMessage,
        i.lastCompletedStepName,
        wf?.name,
        inputsToText(inputs),
      ], q);
      if (!matches) return false;
    }
    return true;
  });

  // Status counts reflect the scoped set so they track the selected workflow.
  const counts: Record<Status, number> = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const i of scoped) if (i.status in counts) counts[i.status as Status]++;

  // The feed additionally honors the status toggles.
  const filteredBase = scoped.filter(
    (i) => activeFilters.size === 0 || activeFilters.has(i.status as Status),
  );

  // Sort newest first across the whole feed — strictly by creation time so
  // recently-completed older instances don't jump above newly-started ones.
  const filtered = useMemo(
    () => [...filteredBase].sort(byStartedAtDesc),
    [filteredBase],
  );

  const pagination = usePagination(filtered, {
    storageKey: 'baton-activity-page-size',
    resetKey: `${workflowFilter ?? ''}|${runFilter ?? ''}|${[...activeFilters].sort().join(',')}|${[...activePlatformFilters].sort().join(',')}|${q}|${monthsRange}`,
  });
  const { pageItems } = pagination;

  return (
    <>
      {/* Overlay drawer sliding in from the left on every breakpoint. It used
          to push main content sideways on desktop, but the right-side panels
          overlay - QA round 2 flagged the two models, so both overlay now. */}
      <div
        className={clsx(
          'fixed top-0 left-0 h-full w-full md:w-[480px] z-50',
          'transform transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
          'border-r border-gray-200 bg-[#f8f9fb] shadow-[8px_0_24px_-12px_rgba(0,0,0,0.12)]',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
      <div className="w-full md:w-[480px] h-full flex flex-col">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="bg-white border-b border-gray-200/80">
          <div className="flex items-center gap-3 px-5 pt-5 pb-4">
            <div className="p-2.5 bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl shrink-0 ring-1 ring-violet-100/60">
              <Activity className="w-5 h-5 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-gray-900 truncate leading-tight">Activity Log</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {workflowFilter
                  ? `${filteredBase.length} instance${filteredBase.length !== 1 ? 's' : ''} in ${workflowFilterName}`
                  : `${instances.length} instance${instances.length !== 1 ? 's' : ''} across all workflows`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-gray-100 shrink-0 transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Search + filter menu toggle */}
          {instances.length > 0 && (
            <div className="flex items-center gap-2 px-5 pb-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by instance, workflow, user, params…"
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
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={clsx(
                  'relative shrink-0 p-1.5 rounded-lg border transition-colors',
                  filtersOpen || activeFilterCount > 0
                    ? 'bg-violet-50 text-violet-600 border-violet-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                )}
                aria-label="Toggle filters"
                aria-expanded={filtersOpen}
                title="Filters"
              >
                <SlidersHorizontal className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 flex items-center justify-center text-[9px] font-semibold text-white bg-violet-600 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Filter menu — collapsed by default behind the toggle.
              Order: Period → Platform → Workflow → Status. */}
          {filtersOpen && instances.length > 0 && (
            <div className="px-5 pb-3.5 pt-1 space-y-3 border-t border-gray-100">
              {/* Period */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 mt-2.5">Period</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([
                    { label: 'This month', value: 'this' },
                    { label: 'Previous month', value: 'prev' },
                    { label: 'All', value: 'all' },
                  ] as { label: string; value: 'this' | 'prev' | 'all' }[]).map(({ label, value }) => {
                    const active = monthsRange === value;
                    return (
                      <button
                        key={value}
                        onClick={() => setMonthsRange(value)}
                        className={clsx(
                          'inline-flex items-center gap-1 px-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                          active
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Platform */}
              {platforms.length > 1 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Platform</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {platforms.map((p) => {
                      const active = activePlatformFilters.has(p);
                      return (
                        <button
                          key={p}
                          onClick={() => togglePlatformFilter(p)}
                          className={clsx(
                            'inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border capitalize',
                            active
                              ? 'bg-violet-50 text-violet-700 border-violet-200'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                          )}
                        >
                          <PlatformIcon platform={p} size={12} />
                          {p}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => { setActivePlatformFilters(new Set()); setWorkflowFilter(null); }}
                      className={clsx(
                        'inline-flex items-center gap-1 px-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                        activePlatformFilters.size === 0
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {/* Workflow — nested under Platform: only shown once a platform is
                  selected, and scoped to that platform's workflows. */}
              {activePlatformFilters.size > 0 && workflowOptions.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Workflow</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {workflowOptions.map(({ id, name }) => {
                      const active = workflowFilter === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setWorkflowFilter(active ? null : id)}
                          className={clsx(
                            'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border max-w-full',
                            active
                              ? 'bg-violet-50 text-violet-700 border-violet-200'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                          )}
                        >
                          <GitBranch className="w-3 h-3 shrink-0" />
                          <span className="truncate">{name}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setWorkflowFilter(null)}
                      className={clsx(
                        'inline-flex items-center gap-1 px-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                        workflowFilter === null
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {/* Bulk Upload run — shown whenever batch instances are in scope,
                  so "what did Run 3 launch?" is one click. */}
              {runOptions.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Bulk Upload run</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {runOptions.map(({ id, runNumber, count }) => {
                      const active = runFilter === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setRunFilter(active ? null : id)}
                          className={clsx(
                            'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                            active
                              ? 'bg-violet-50 text-violet-700 border-violet-200'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                          )}
                        >
                          {runNumber != null ? `Run ${runNumber}` : 'Bulk run'} ({count})
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setRunFilter(null)}
                      className={clsx(
                        'inline-flex items-center gap-1 px-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                        runFilter === null
                          ? 'bg-violet-50 text-violet-700 border-violet-200'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Status</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {FILTER_ORDER.map((s) => {
                    const c = counts[s];
                    const active = activeFilters.has(s);
                    const sc = STATUS[s];
                    return (
                      <button
                        key={s}
                        onClick={() => toggleFilter(s)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-[5px] rounded-full text-[11px] font-medium transition-all border',
                          active
                            ? `${sc.bg} ${sc.text} border-current/15`
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                        )}
                      >
                        <span className={clsx('w-1.5 h-1.5 rounded-full', active ? sc.dot : 'bg-gray-300')} />
                        {c} {sc.label}
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
              </div>
            </div>
          )}
        </div>

        {/* ── List ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && instances.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : instances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center px-8">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">No activity yet</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-[240px]">
                Instances appear here when a workflow on the canvas is triggered.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <p className="text-sm font-medium text-gray-600">No matches</p>
              <p className="text-xs text-gray-400 mt-1">No instances found for the selected filters</p>
            </div>
          ) : (
            <div className="px-3 py-3 space-y-1.5">
              {pageItems.map((inst) => {
                const wf = workflowMap.get(inst.workflowId);
                return (
                  <InstanceCard
                    key={inst.id}
                    inst={inst}
                    maestroBaseUrl={wf?.maestroInstancesUrl}
                    triggerInputSchema={wf?.triggerInputSchema}
                    expectedDurationDays={expectedDurationMap.get(inst.workflowId) ?? inst.expectedDurationDays}
                    cancellingId={cancellingId}
                    retryingId={retryingId}
                    onCancel={async () => {
                      setCancellingId(inst.id);
                      try { await cancelInstance(inst.id); mutateInstances(); mutate('/instances/counts'); }
                      catch {} finally { setCancellingId(null); }
                    }}
                    onRetry={async () => {
                      setRetryingId(inst.id);
                      try {
                        await retryInstance(inst.id);
                        mutateInstances();
                        mutate('/workflows');
                        mutate('/instances/counts');
                      } catch {} finally { setRetryingId(null); }
                    }}
                    onActionClick={onActionClick}
                  />
                );
              })}
            </div>
          )}
        </div>

        {filtered.length > 0 && <PaginationFooter {...pagination} />}
      </div>
      </div>
    </>
  );
}

import { useState, useMemo } from 'react';
import {
  useInstances,
  useAutomations,
  useWorkflows,
  retryInstance,
  cancelInstance,
  postponeInstance,
  type WorkflowInstance,
} from '@/hooks/useApi';
import { isInstanceOverdue } from '@/lib/utils';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import {
  ShieldCheck,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Ban,
  Zap,
} from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { InstanceCard } from '@/components/flows/InstancesSidebar';
import { byStartedAtDesc } from '@/components/flows/instanceFilters';
import clsx from 'clsx';

// ─── Constants ────────────────────────────────────────────────

// ─── Types ────────────────────────────────────────────────────

type Tab = 'all' | 'failed' | 'overdue' | 'in_progress' | 'resolved' | 'cancelled';

interface TabConfig {
  key: Tab;
  label: string;
  badgeColor: string;
}

const TABS: TabConfig[] = [
  { key: 'all',         label: 'All',         badgeColor: 'bg-violet-100 text-violet-700' },
  { key: 'failed',      label: 'Failed',      badgeColor: 'bg-red-100 text-red-700' },
  { key: 'overdue',     label: 'Overdue',     badgeColor: 'bg-amber-100 text-amber-700' },
  { key: 'in_progress', label: 'In Progress',  badgeColor: 'bg-blue-100 text-blue-700' },
  { key: 'resolved',    label: 'Resolved',     badgeColor: 'bg-green-100 text-green-700' },
  { key: 'cancelled',   label: 'Cancelled',    badgeColor: 'bg-gray-100 text-gray-600' },
];

// ─── In Progress sub-filter ───────────────────────────────────
// In Progress holds two distinct origins: instances retried after a failure
// (Try Again) and Overdue instances that were postponed (Add Days). The postpone
// path is the only one that sets `overdueSnoozedUntil`, so it's the discriminator.
type InProgressKind = 'all' | 'failed' | 'overdue';

/** A postponed instance carries `overdueSnoozedUntil`; anything else here is a retry. */
const isAfterOverdue = (i: WorkflowInstance) => !!i.overdueSnoozedUntil;

const IN_PROGRESS_KINDS: { key: InProgressKind; label: string; activeCls: string; dot: string | null }[] = [
  { key: 'all',     label: 'All',           activeCls: 'bg-violet-50 text-violet-700 border-violet-200', dot: null },
  { key: 'failed',  label: 'After Failed',  activeCls: 'bg-red-50 text-red-700 border-red-200',          dot: 'bg-red-400' },
  { key: 'overdue', label: 'After Overdue', activeCls: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
];

/**
 * Overdue threshold for an instance: rule-launched instances read the rule's
 * actionConfig; Bulk Upload instances carry the threshold themselves
 * (snapshotted from the run at launch).
 */
export function getExpectedDurationDays(
  inst: Pick<WorkflowInstance, 'triggerRuleId' | 'expectedDurationDays'>,
  automationMap: Map<string, { actionConfig?: Record<string, unknown> }>,
): number | undefined {
  if (inst.triggerRuleId) {
    const rule = automationMap.get(inst.triggerRuleId);
    const v = rule?.actionConfig?.expectedDurationDays;
    return typeof v === 'number' && v > 0 ? v : undefined;
  }
  const own = inst.expectedDurationDays;
  return typeof own === 'number' && own > 0 ? own : undefined;
}

/**
 * Control Center scope: instances that auto-retried OR were manually acted on
 * (retried, cancelled, or postponed) by a user from the Control Center.
 */
export function inControlCenterScope(i: WorkflowInstance): boolean {
  return (i.retryCount ?? 0) > 0 || !!i.manuallyRetriedAt || !!i.manuallyCancelledAt || !!i.overdueSnoozedUntil;
}

/**
 * Whether an in-scope running instance belongs in the In Progress tab: it must be
 * acted-on AND not currently overdue. Once a reschedule/postpone window expires the
 * instance becomes Overdue again and leaves In Progress, so it shows in one tab only.
 */
export function isInProgressInstance(inst: WorkflowInstance, expectedDurationDays?: number): boolean {
  return inControlCenterScope(inst) && !isInstanceOverdue(inst, expectedDurationDays);
}

// ─── Page ────────────────────────────────────────────────────

export default function ControlCenterPage() {
  const { mutate } = useSWRConfig();
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [postponingId, setPostponingId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  // In Progress sub-filter: instances arrive here either after a failure was
  // retried (Try Again) or after an Overdue instance was postponed (Add Days).
  const [inProgressKind, setInProgressKind] = useState<InProgressKind>('all');

  const { data: failedData,    isLoading: loadingFailed,    mutate: mutateFailed }    = useInstances({ status: 'failed',    limit: 100 });
  const { data: runningData,   isLoading: loadingRunning,   mutate: mutateRunning }   = useInstances({ status: 'running',   limit: 100 });
  const { data: completedData, isLoading: loadingCompleted }                          = useInstances({ status: 'completed', limit: 100 });
  const { data: cancelledData, isLoading: loadingCancelled, mutate: mutateCancelled } = useInstances({ status: 'cancelled', limit: 100 });
  const { data: automationsData }                                                      = useAutomations();
  const { data: workflowsData }                                                        = useWorkflows();

  const failedInstances    = failedData?.instances    ?? [];
  const runningInstances   = runningData?.instances   ?? [];
  const completedInstances = completedData?.instances ?? [];
  const allCancelledInstances = cancelledData?.instances ?? [];
  const allAutomations     = automationsData?.automations ?? [];
  const allWorkflows       = workflowsData?.workflows   ?? [];

  const workflowMap = useMemo(
    () => new Map(allWorkflows.map((w) => [w.id, w])),
    [allWorkflows],
  );

  const automationMap = useMemo(
    () => new Map(allAutomations.map((a) => [a.id, a])),
    [allAutomations],
  );

  // In Progress = in-scope running instances that are NOT currently overdue.
  // A postponed (or retried) instance sits here only while its reschedule window
  // is still open; once that time passes it becomes Overdue again and must leave
  // In Progress so it shows in exactly one tab, not both.
  const inProgressInstances = useMemo(
    () => runningInstances.filter((i) =>
      isInProgressInstance(i, getExpectedDurationDays(i, automationMap))),
    [runningInstances, automationMap],
  );

  const resolvedInstances = useMemo(
    () => completedInstances.filter(inControlCenterScope),
    [completedInstances],
  );

  const cancelledInstances = useMemo(
    () => allCancelledInstances.filter(inControlCenterScope),
    [allCancelledInstances],
  );

  // Overdue: ALL running instances past their Overdue threshold — either the
  // rule's expectedDurationDays elapsed, or a postpone window has run out. Not
  // gated by inControlCenterScope — overdue is its own signal. Postponed
  // instances whose window hasn't elapsed are excluded (they sit in In Progress).
  const overdueInstances = useMemo(
    () => runningInstances.filter((inst) =>
      isInstanceOverdue(inst, getExpectedDurationDays(inst, automationMap))),
    [runningInstances, automationMap],
  );

  // "All" = every actionable instance (Failed ∪ Overdue ∪ In Progress) in one
  // list, deduped by id since an overdue instance is also running. Resolved and
  // Cancelled are intentionally excluded — they aren't issues to fix.
  const allActionableInstances = useMemo(() => {
    const seen = new Set<string>();
    const out: WorkflowInstance[] = [];
    for (const i of [...failedInstances, ...overdueInstances, ...inProgressInstances]) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      out.push(i);
    }
    return out.sort(byStartedAtDesc);
  }, [failedInstances, overdueInstances, inProgressInstances]);

  const tabCounts: Record<Tab, number> = {
    all:         allActionableInstances.length,
    failed:      failedInstances.length,
    overdue:     overdueInstances.length,
    in_progress: inProgressInstances.length,
    resolved:    resolvedInstances.length,
    cancelled:   cancelledInstances.length,
  };

  const isLoading = loadingFailed || loadingRunning || loadingCompleted || loadingCancelled;
  const totalIssues = failedInstances.length;

  // ─── Actions ──────────────────────────────────────────────

  async function handleRetry(inst: WorkflowInstance) {
    setRetryingId(inst.id);
    try {
      await retryInstance(inst.id);
      toast.success('Retry triggered');
      mutateFailed();
      mutateRunning();
      mutateCancelled();
      mutate('/instances/counts');
    } catch {
      // error shown by global handler
    } finally {
      setRetryingId(null);
    }
  }

  async function handleCancel(inst: WorkflowInstance) {
    setCancellingId(inst.id);
    try {
      await cancelInstance(inst.id);
      toast.success('Instance cancelled');
      mutateFailed();
      mutateRunning();
      mutateCancelled();
      mutate('/instances/counts');
    } catch {
      // error shown by global handler
    } finally {
      setCancellingId(null);
    }
  }

  async function handlePostpone(inst: WorkflowInstance, days: number) {
    setPostponingId(inst.id);
    try {
      await postponeInstance(inst.id, days);
      toast.success(`Postponed ${days} day${days !== 1 ? 's' : ''} - moved to In Progress`);
      mutateRunning();
      mutate('/instances/counts');
    } catch {
      // error shown by global handler
    } finally {
      setPostponingId(null);
    }
  }

  // ─── Platform & automation filter ────────────────────────

  // Unique platforms present in all loaded instances
  const platforms = useMemo(() => {
    const all = [...failedInstances, ...inProgressInstances, ...resolvedInstances, ...cancelledInstances];
    return [...new Set(all.map((i) => i.sourcePlatform).filter(Boolean) as string[])].sort();
  }, [failedInstances, inProgressInstances, resolvedInstances, cancelledInstances]);

  // Automations for the selected platform (used in row 3)
  const platformAutomations = useMemo(
    () => selectedPlatform ? allAutomations.filter((a) => a.sourcePlatform === selectedPlatform) : [],
    [allAutomations, selectedPlatform],
  );

  function handlePlatformSelect(platform: string | null) {
    setSelectedPlatform(platform);
    setSelectedRuleId(null); // reset automation filter when platform changes
  }

  // ─── Tab content ──────────────────────────────────────────

  const tabInstances: Record<Tab, WorkflowInstance[]> = {
    all:         allActionableInstances,
    failed:      failedInstances,
    overdue:     overdueInstances,
    in_progress: inProgressInstances,
    resolved:    resolvedInstances,
    cancelled:   cancelledInstances,
  };

  // Apply platform + automation filters, then the In Progress origin sub-filter.
  const currentInstances = useMemo(() => {
    let list = tabInstances[activeTab];
    if (selectedPlatform) list = list.filter((i) => {
      const platform = i.sourcePlatform ?? allAutomations.find((a) => a.id === i.triggerRuleId)?.sourcePlatform;
      return platform === selectedPlatform;
    });
    if (selectedRuleId)   list = list.filter((i) => i.triggerRuleId  === selectedRuleId);
    if (activeTab === 'in_progress' && inProgressKind !== 'all') {
      list = list.filter((i) => inProgressKind === 'overdue' ? isAfterOverdue(i) : !isAfterOverdue(i));
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, failedInstances, inProgressInstances, resolvedInstances, cancelledInstances, selectedPlatform, selectedRuleId, allAutomations, inProgressKind]);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Control Center</h1>
          <p className="text-sm text-gray-500 mt-1">Fix everything → leave with zeros.</p>
        </div>
        <div className="flex items-center gap-2 mt-1 shrink-0">
          {isLoading && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
          {!isLoading && totalIssues === 0 ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
              <ShieldCheck className="w-4 h-4" />
              All clear
            </span>
          ) : !isLoading ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-100 text-red-700 text-sm font-semibold rounded-full">
              <AlertTriangle className="w-4 h-4" />
              {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {TABS.map((tab) => {
          const count = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              {tab.label}
                <span className={clsx(
                'text-xs font-semibold px-1.5 py-0.5 rounded-full',
                count > 0 ? tab.badgeColor : 'bg-gray-100 text-gray-400',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── In Progress origin sub-filter ── */}
      {activeTab === 'in_progress' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {IN_PROGRESS_KINDS.map(({ key, label, activeCls, dot }) => {
            const active = inProgressKind === key;
            return (
              <button
                key={key}
                onClick={() => setInProgressKind(key)}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                  active ? activeCls : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700',
                )}
              >
                {dot && <span className={clsx('w-1.5 h-1.5 rounded-full', active ? dot : 'bg-gray-300')} />}
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Platform filter row ── */}
      {platforms.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => handlePlatformSelect(null)}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
              selectedPlatform === null
                ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700',
            )}
          >
            All
          </button>
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => handlePlatformSelect(p)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                selectedPlatform === p
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700',
              )}
            >
              <PlatformIcon platform={p} size={11} />
              <span className="capitalize">{p}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Automation filter row ── */}
      {selectedPlatform && platformAutomations.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-2">
          <button
            onClick={() => setSelectedRuleId(null)}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
              selectedRuleId === null
                ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-600',
            )}
          >
            All automations
          </button>
          {platformAutomations.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedRuleId(a.id)}
              className={clsx(
                'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                selectedRuleId === a.id
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-600',
              )}
            >
              <Zap className="w-2.5 h-2.5 shrink-0" />
              {a.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Instance list ── */}
      {isLoading && currentInstances.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : currentInstances.length === 0 ? (
        <EmptyTab tab={activeTab} />
      ) : (
        <div className="space-y-2">
          {currentInstances.map((inst) => {
            const wf = workflowMap.get(inst.workflowId);
            const expected = getExpectedDurationDays(inst, automationMap);
            // Overdue instances get the "+ Add days" postpone control — in the
            // dedicated Overdue tab, or for the overdue items mixed into "All".
            const canPostpone = inst.status === 'running'
              && (activeTab === 'overdue' || (activeTab === 'all' && isInstanceOverdue(inst, expected)));
            return (
              <InstanceCard
                key={inst.id}
                inst={inst}
                maestroBaseUrl={wf?.maestroInstancesUrl}
                triggerInputSchema={wf?.triggerInputSchema}
                expectedDurationDays={expected}
                cancellingId={cancellingId}
                retryingId={retryingId}
                onCancel={() => handleCancel(inst)}
                onRetry={() => handleRetry(inst)}
                showPostpone={canPostpone}
                postponingId={postponingId}
                onPostpone={(days) => handlePostpone(inst, days)}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}

// ─── Empty Tab ────────────────────────────────────────────────

function EmptyTab({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { icon: React.ReactNode; text: string }> = {
    all:         { icon: <ShieldCheck  className="w-8 h-8 text-green-400" />, text: 'All clear - nothing to resolve' },
    failed:      { icon: <CheckCircle2 className="w-8 h-8 text-green-400" />, text: 'No failed instances' },
    overdue:     { icon: <CheckCircle2 className="w-8 h-8 text-green-400" />, text: 'No overdue instances' },
    in_progress: { icon: <CheckCircle2 className="w-8 h-8 text-green-400" />, text: 'No retried instances in progress' },
    resolved:    { icon: <CheckCircle2 className="w-8 h-8 text-green-400" />, text: 'No resolved instances yet' },
    cancelled:   { icon: <Ban         className="w-8 h-8 text-gray-300"  />, text: 'No cancelled instances' },
  };
  const { icon, text } = messages[tab];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
      {icon}
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  );
}

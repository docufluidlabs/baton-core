import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSWRConfig } from 'swr';
import { useWorkflowInstances, useWorkflows, useConnections, useAutomations, cancelInstance, retryInstance, setInstanceTags, parseTriggerInputSchema, type WorkflowInstance, type TriggerInputSchema } from '@/hooks/useApi';
import { toast } from 'sonner';
import { timeAgo, daysPassed, overdueLevel, formatDateFull, type OverdueLevel } from '@/lib/utils';
import {
  X, Loader2, Ban, Clock, Eye, ExternalLink, RefreshCw, AlertTriangle, User, Timer, CheckCircle, ShieldCheck, XCircle, PauseCircle, Copy, Zap, Search, Tag, Plus, Check, CalendarPlus,
} from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { usePagination, PaginationFooter } from '@/components/ui/Pagination';
import { monthRangeBounds, withinBounds, matchesQuery, inputsToText, byStartedAtDesc } from './instanceFilters';
import clsx from 'clsx';

// ─── Status config ───────────────────────────────────────────

export const STATUS = {
  completed: { dot: 'bg-emerald-500', border: 'border-l-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500', label: 'Completed' },
  running:   { dot: 'bg-blue-500',    border: 'border-l-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700',    bar: 'bg-blue-500',    label: 'Running'   },
  failed:    { dot: 'bg-red-500',     border: 'border-l-red-500',     bg: 'bg-red-50',     text: 'text-red-700',     bar: 'bg-red-500',     label: 'Failed'    },
  cancelled: { dot: 'bg-purple-500',  border: 'border-l-purple-500',  bg: 'bg-purple-50',  text: 'text-purple-700',  bar: 'bg-purple-500',  label: 'Cancelled' },
} as const;
export type Status = keyof typeof STATUS;
const FALLBACK = { dot: 'bg-gray-400', border: 'border-l-gray-300', bg: 'bg-gray-50', text: 'text-gray-600', bar: 'bg-gray-400', label: 'Unknown' };
const cfg = (s: string) => STATUS[s as Status] ?? FALLBACK;

export const FILTER_ORDER: Status[] = ['running', 'completed', 'failed', 'cancelled'];

// ─── Instance tags (legacy localStorage) ─────────────────────
// Tags are now stored server-side on the instance (org-shared, synced across
// accounts) — see setInstanceTags / inst.tags. These localStorage helpers
// survive only to migrate labels stranded in a user's browser from before the
// server move: read them once, push them up, then clear the entry.
// Stored as Record<instanceId, string[]> under one key. Empty arrays are
// deleted to avoid bloating the map over time.

export const TAGS_KEY = 'baton-instance-tags';

export function loadInstanceTags(instId: string): string[] {
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, unknown>;
    const v = map[instId];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function persistInstanceTags(instId: string, tags: string[]) {
  try {
    const raw = localStorage.getItem(TAGS_KEY) ?? '{}';
    const map = JSON.parse(raw) as Record<string, string[]>;
    if (tags.length === 0) delete map[instId];
    else map[instId] = tags;
    localStorage.setItem(TAGS_KEY, JSON.stringify(map));
  } catch { /* localStorage unavailable */ }
}

/** Order-sensitive equality for two tag lists. */
export function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function timeUntil(dateStr: string): string | null {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// ─── Sidebar ─────────────────────────────────────────────────

interface InstancesSidebarProps {
  open: boolean;
  workflowId: string | null;
  workflowName: string | null;
  onClose: () => void;
  onActionClick?: (ruleId: string, ruleName: string, actionNumber: number) => void;
}

export function InstancesSidebar({ open, workflowId, workflowName, onClose, onActionClick }: InstancesSidebarProps) {
  const { data, isLoading, mutate: mutateInstances } = useWorkflowInstances(workflowId ?? '', true);
  const { mutate } = useSWRConfig();
  const { data: wfData } = useWorkflows();
  const { data: connData } = useConnections();
  const { data: autoData } = useAutomations();
  const workflow = wfData?.workflows?.find((w) => w.id === workflowId);
  const maestroBaseUrl = workflow?.maestroInstancesUrl;
  const platform = connData?.connections?.find((c) => c.id === workflow?.connectionId)?.platform ?? 'docusign';
  const instances = data?.instances || [];
  // 1 workflow = 1 automation. Pick up its expected duration (configured during automation creation).
  const wfAutomation = autoData?.automations?.find((a) => a.targetWorkflowId === workflowId);
  const rawExpected = wfAutomation?.actionConfig?.expectedDurationDays;
  const expectedDurationDays = typeof rawExpected === 'number' && rawExpected > 0 ? rawExpected : undefined;

  useEffect(() => {
    if (open && data?.instances) {
      mutate('/instances/counts');
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<Status>>(
    () => new Set<Status>(['running', 'completed', 'failed']),
  );
  const [query, setQuery] = useState('');
  const [monthsRange, setMonthsRange] = useState<'this' | 'prev' | 'all'>('all');

  function toggleFilter(s: Status) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const dateBounds = monthRangeBounds(monthsRange, new Date());
  const filteredBase = instances.filter((i) => {
    if (activeFilters.size > 0 && !activeFilters.has(i.status as Status)) return false;
    if (!withinBounds(i.startedAt, dateBounds)) return false;
    if (q) {
      const inputs = i.inputData ? resolveDisplayInputs(i.inputData, workflow?.triggerInputSchema) : {};
      const matches = matchesQuery([
        i.instanceName,
        i.triggerRuleName,
        i.startedByName,
        i.sourcePlatform,
        i.errorMessage,
        i.lastCompletedStepName,
        inputsToText(inputs),
      ], q);
      if (!matches) return false;
    }
    return true;
  });

  // Newest first by creation time so order is stable regardless of status.
  const filtered = [...filteredBase].sort(byStartedAtDesc);

  const counts: Record<Status, number> = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const i of instances) if (i.status in counts) counts[i.status as Status]++;

  const pagination = usePagination(filtered, {
    storageKey: 'baton-instances-page-size',
    resetKey: `${workflowId ?? ''}|${[...activeFilters].sort().join(',')}|${q}|${monthsRange}`,
  });
  const { pageItems } = pagination;

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40" onClick={onClose} />}
      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full md:w-[460px] bg-[#f8f9fb] z-50 transition-transform duration-300 ease-out flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="bg-white border-b border-gray-200/80">
          <div className="flex items-center gap-3 px-5 pt-5 pb-4">
            <div className="p-2.5 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl shrink-0 ring-1 ring-purple-100/60">
              <PlatformIcon platform={platform} size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-semibold text-gray-900 truncate leading-tight">{workflowName}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {instances.length} instance{instances.length !== 1 ? 's' : ''} total
              </p>
            </div>
            <button onClick={onClose} className="p-2 -mr-1 rounded-lg hover:bg-gray-100 shrink-0 transition-colors">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Search */}
          {instances.length > 0 && (
            <div className="px-5 pb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by instance, user, step, params…"
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

          {/* Date range chips */}
          {instances.length > 0 && (
            <div className="flex items-center gap-1.5 px-5 pb-3 flex-wrap">
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
          )}

          {/* Stats chips */}
          {instances.length > 0 && (
            <div className="flex items-center gap-1.5 px-5 pb-3.5 flex-wrap">
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
          )}
        </div>

        {/* ── List ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : instances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center px-8">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">No launches yet</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-[220px]">
                Instances appear here when automations trigger this workflow.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              {activeFilters.size === 1 && activeFilters.has('failed') ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">All clear!</p>
                  <p className="text-xs text-gray-400 mt-1">No failed instances - everything is running smoothly</p>
                </>
              ) : activeFilters.size === 1 && activeFilters.has('running') ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center mb-3">
                    <CheckCircle className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">Nothing running</p>
                  <p className="text-xs text-gray-400 mt-1">No active instances at the moment</p>
                </>
              ) : activeFilters.size === 1 && activeFilters.has('cancelled') ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center mb-3">
                    <PauseCircle className="w-5 h-5 text-purple-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">No cancellations</p>
                  <p className="text-xs text-gray-400 mt-1">None of the instances were cancelled</p>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                    <XCircle className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">No matches</p>
                  <p className="text-xs text-gray-400 mt-1">No instances found for the selected filters</p>
                </>
              )}
            </div>
          ) : (
            <div className="px-3 py-3 space-y-1.5">
              {pageItems.map((inst) => (
                <InstanceCard
                  key={inst.id}
                  inst={inst}
                  maestroBaseUrl={maestroBaseUrl}
                  triggerInputSchema={workflow?.triggerInputSchema}
                  expectedDurationDays={expectedDurationDays}
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
              ))}
            </div>
          )}
        </div>

        {filtered.length > 0 && <PaginationFooter {...pagination} />}
      </div>
    </>
  );
}

// ─── Instance Card ───────────────────────────────────────────

export function normalizeKey(k: string) {
  return k.toLowerCase().replace(/[\s_\-]/g, '');
}

function flattenPayload(
  obj: Record<string, any>,
  prefix = '',
  depth = 0,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (depth < 3 && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenPayload(value, fullKey, depth + 1));
    }
    result[fullKey] = value;
  }
  return result;
}

/**
 * Returns the params that are actually passed to the workflow.
 * Mirrors the backend `autoMapFromSchema` so View Params shows the same
 * values Maestro received — including nested fields (e.g. `data.employeeId`
 * matched as `employeeId`) via flattened + last-segment normalized lookup.
 */
export function resolveDisplayInputs(
  inputData: Record<string, any>,
  schema: TriggerInputSchema | undefined,
): Record<string, any> {
  if (!inputData.__rawPayload) return inputData;

  const raw = inputData.__rawPayload;
  const payload: Record<string, any> = Array.isArray(raw) ? (raw[0] ?? {}) : raw;

  const fields = parseTriggerInputSchema(schema);
  if (fields.length === 0) return payload;

  const flat = flattenPayload(payload);
  const normLookup = new Map<string, { key: string; value: any }>();
  function addToLookup(norm: string, key: string, value: any) {
    const existing = normLookup.get(norm);
    if (!existing || key.split('.').length < existing.key.split('.').length) {
      normLookup.set(norm, { key, value });
    }
  }
  for (const [k, v] of Object.entries(flat)) {
    if (v !== null && typeof v === 'object') continue;
    addToLookup(normalizeKey(k), k, v);
    const lastDot = k.lastIndexOf('.');
    if (lastDot >= 0) {
      addToLookup(normalizeKey(k.slice(lastDot + 1)), k, v);
    }
  }

  const result: Record<string, any> = {};
  for (const { key } of fields) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      result[key] = payload[key];
    } else {
      const match = normLookup.get(normalizeKey(key));
      result[key] = match !== undefined ? match.value : null;
    }
  }
  return result;
}

export function InstanceCard({ inst, maestroBaseUrl, triggerInputSchema, expectedDurationDays, cancellingId, retryingId, onCancel, onRetry, onActionClick, showPostpone, postponingId, onPostpone }: {
  inst: WorkflowInstance;
  maestroBaseUrl?: string;
  triggerInputSchema?: TriggerInputSchema;
  expectedDurationDays?: number;
  cancellingId: string | null;
  retryingId: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onActionClick?: (ruleId: string, ruleName: string, actionNumber: number) => void;
  /** Resolution Center only: show the "+ Add days" postpone control for overdue instances. */
  showPostpone?: boolean;
  postponingId?: string | null;
  onPostpone?: (days: number) => void;
}) {
  const monitorUrl = maestroBaseUrl && inst.maestroInstanceId
    ? `${maestroBaseUrl}/monitor/${inst.maestroInstanceId}`
    : undefined;
  const sc = cfg(inst.status);

  const rawStep = inst.lastCompletedStep;
  const hasTotalSteps = inst.totalSteps != null && inst.totalSteps > 0;
  const progressPercent = hasTotalSteps
    ? inst.status === 'completed'
      ? 100
      : rawStep != null && rawStep >= 0
        ? Math.round(((rawStep + 1) / inst.totalSteps!) * 100)
        : 0
    : null;
  const stepNumber = inst.status === 'completed'
    ? inst.totalSteps
    : rawStep != null && rawStep >= 0 ? rawStep + 1 : 0;
  const stepName = inst.lastCompletedStepName || (typeof inst.currentStep === 'string' && inst.currentStep.length > 1 ? inst.currentStep : null);

  const isAutoRetrying = inst.status === 'running' && (inst.retryCount ?? 0) > 0;
  const displayInputs = inst.inputData ? resolveDisplayInputs(inst.inputData, triggerInputSchema) : {};
  const hasParams = Object.keys(displayInputs).length > 0;
  const [showParams, setShowParams] = useState(false);
  const [postponeDays, setPostponeDays] = useState(7);

  // Tags are server-backed and org-shared. Seed from the instance payload; fall
  // back to any legacy localStorage labels (undefined server tags = never set).
  const [tags, setTags] = useState<string[]>(() => inst.tags ?? loadInstanceTags(inst.id));
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const savingTags = useRef(false);

  // Reflect server-driven changes (e.g. a teammate edited tags on another
  // account) when fresh instance data arrives — but never while our own save is
  // in flight, or stale poll data would clobber the optimistic value.
  const serverTags = inst.tags;
  useEffect(() => {
    if (serverTags === undefined || savingTags.current) return;
    setTags((prev) => (sameTags(prev, serverTags) ? prev : serverTags));
  }, [serverTags]);

  // One-time migration of labels stranded in this browser's localStorage from
  // before tags were server-backed: push them up once, then clear the entry.
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current || inst.tags !== undefined) return;
    const local = loadInstanceTags(inst.id);
    if (local.length === 0) return;
    migrated.current = true;
    setInstanceTags(inst.id, local)
      .then((saved) => { setTags(saved); persistInstanceTags(inst.id, []); })
      .catch(() => { migrated.current = false; });
  }, [inst.id, inst.tags]);

  async function saveTags(next: string[]) {
    const prev = tags;
    setTags(next);            // optimistic
    savingTags.current = true;
    try {
      setTags(await setInstanceTags(inst.id, next));
    } catch {
      setTags(prev);          // revert on failure
      toast.error('Failed to update tags');
    } finally {
      savingTags.current = false;
    }
  }
  function commitTag() {
    const v = tagDraft.trim();
    setAddingTag(false);
    setTagDraft('');
    if (!v || tags.includes(v)) return;
    void saveTags([...tags, v]);
  }
  function removeTag(t: string) {
    void saveTags(tags.filter((x) => x !== t));
  }
  const hasActions = inst.status === 'running' || inst.status === 'failed' || inst.status === 'cancelled';
  const hasLinks = !!maestroBaseUrl;

  const automationName = inst.triggerRuleName ?? null;
  const instanceSuffix = automationName && inst.instanceName.startsWith(automationName)
    ? inst.instanceName.slice(automationName.length).trim()
    : inst.instanceName;

  return (
    <div className={clsx(
      'bg-white rounded-lg border border-gray-200/80 overflow-hidden transition-all hover:shadow-sm hover:border-gray-300/80',
      'border-l-[3px]', sc.border,
    )}>
      <div className="px-3.5 pt-3 pb-2.5">
        {/* Row 1: Automation name (if present) + status badge */}
        {automationName ? (
          <div className="flex items-start gap-2">
            <div className="flex-1 flex items-center gap-1 min-w-0">
              <Zap className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <p className="text-[13px] font-medium text-violet-600 truncate leading-snug">{automationName}</p>
            </div>
            <span className={clsx(
              'text-[10px] font-semibold px-2 py-[3px] rounded capitalize shrink-0 leading-none',
              sc.bg, sc.text,
            )}>
              {inst.status}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[13px] font-medium text-gray-900 truncate leading-snug min-w-0">
              {instanceSuffix}
            </p>
            <span className={clsx(
              'text-[10px] font-semibold px-2 py-[3px] rounded capitalize shrink-0 leading-none',
              sc.bg, sc.text,
            )}>
              {inst.status}
            </span>
          </div>
        )}

        {/* Row 2: Instance name/suffix */}
        {automationName && (
          <p className="mt-1 text-[12px] text-gray-600 truncate leading-snug min-w-0">
            {instanceSuffix}
          </p>
        )}

        {/* Row 3: Launched by Action #N */}
        {inst.triggerActionNumber != null && inst.triggerRuleId && inst.triggerRuleName && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[11px] text-gray-400">Launched by</span>
            {onActionClick ? (
              <button
                onClick={() => onActionClick(inst.triggerRuleId!, inst.triggerRuleName!, inst.triggerActionNumber!)}
                className="text-[11px] font-medium text-violet-600 hover:underline cursor-pointer"
              >
                Relay {inst.triggerActionNumber}
              </button>
            ) : (
              <span className="text-[11px] font-medium text-violet-600">Relay {inst.triggerActionNumber}</span>
            )}
          </div>
        )}

        {/* Row 4: meta — timeAgo | platform */}
        <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-400 leading-none">
          {expectedDurationDays && inst.status === 'running' ? (() => {
            const days = daysPassed(inst.startedAt);
            const level: OverdueLevel = overdueLevel(days, expectedDurationDays);
            const cls = level === 'overdue' ? 'text-red-600 font-medium'
              : level === 'warning' ? 'text-amber-600 font-medium'
              : '';
            return (
              <span className={cls} title={`Launched ${formatDateFull(inst.startedAt)}`}>
                {days}/{expectedDurationDays} days passed
              </span>
            );
          })() : (
            <span title={formatDateFull(inst.startedAt)}>{timeAgo(inst.startedAt)}</span>
          )}
          {inst.startedByName && (
            <>
              <span className="text-gray-200">|</span>
              <User className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{inst.startedByName}</span>
            </>
          )}
          {inst.status === 'running' && inst.expiresAt && (() => {
            const remaining = timeUntil(inst.expiresAt);
            if (!remaining) return null;
            const isExpired = remaining === 'expired';
            return (
              <>
                <span className="text-gray-200">|</span>
                <Timer className={clsx('w-2.5 h-2.5 shrink-0', isExpired && 'text-red-400')} />
                <span className={isExpired ? 'text-red-400' : ''}>{isExpired ? 'Expired' : remaining}</span>
              </>
            );
          })()}
          {inst.sourcePlatform && (
            <>
              <span className="text-gray-200">|</span>
              <PlatformIcon platform={inst.sourcePlatform} size={11} />
              <span className="capitalize">{inst.sourcePlatform}</span>
            </>
          )}
        </div>

        {/* Progress */}
        {progressPercent !== null && (
          <div className="mt-2.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-[3px] bg-gray-100 rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full transition-all duration-500', sc.bar)} style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="text-[10px] text-gray-400 tabular-nums font-medium leading-none">{stepNumber}/{inst.totalSteps}</span>
            </div>
            {stepName && (
              <p className="text-[10px] text-gray-400 mt-1 truncate leading-none">
                {inst.status === 'failed' && inst.errorStep
                  ? <span className="text-red-400">Failed at: {inst.errorStep}</span>
                  : <>Step {stepNumber} &mdash; {stepName}</>}
              </p>
            )}
          </div>
        )}

        {/* Auto-retry progress */}
        {isAutoRetrying && (
          <div className="flex items-center gap-1.5 mt-2 bg-amber-50/80 rounded-md px-2 py-1.5">
            <RefreshCw className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
            <span className="text-[10px] text-amber-700 font-medium">
              Auto-retry {inst.retryCount}/{inst.retryMaxAttempts ?? 6}
            </span>
            {inst.nextRetryAt && (
              <span className="text-[10px] text-amber-500 ml-auto">
                <RetryCountdown nextRetryAt={inst.nextRetryAt} />
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {inst.status === 'failed' && inst.errorMessage && (
          <div className="flex items-start gap-1.5 mt-2 bg-red-50/80 rounded-md px-2 py-1.5">
            <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-px" />
            <p className="text-[10px] text-red-500 line-clamp-2 leading-relaxed">{inst.errorMessage}</p>
          </div>
        )}

        {/* Tags */}
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 pl-1.5 pr-1 py-[2px] rounded-full text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-100"
            >
              <Tag className="w-2.5 h-2.5" />
              {t}
              <button
                onClick={() => removeTag(t)}
                className="p-0.5 rounded hover:bg-violet-100 text-violet-500 hover:text-violet-700 transition-colors"
                aria-label={`Remove tag ${t}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {addingTag ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
                  if (e.key === 'Escape') { setAddingTag(false); setTagDraft(''); }
                }}
                placeholder="Tag…"
                maxLength={30}
                className="w-24 px-1.5 py-[2px] text-[10px] bg-white border border-gray-200 rounded outline-none focus:border-violet-300 focus:ring-1 focus:ring-violet-200"
              />
              <button
                onClick={commitTag}
                className="p-0.5 rounded text-violet-600 hover:bg-violet-50 hover:text-violet-800 transition-colors"
                aria-label="Save tag"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => { setAddingTag(false); setTagDraft(''); }}
                className="p-0.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="Cancel"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setAddingTag(true)}
              className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[10px] font-medium text-gray-400 border border-dashed border-gray-200 hover:text-violet-600 hover:border-violet-200 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              Add tag
            </button>
          )}
        </div>
      </div>

      {/* Action bar */}
      {(hasActions || hasLinks || (showPostpone && inst.status === 'running')) && (
        <div className="flex items-center px-3.5 py-1.5 bg-gray-50/50 border-t border-gray-100/80">
          {showPostpone && onPostpone && inst.status === 'running' && (
            <div className="inline-flex items-center gap-1 mr-1" title="Give this instance more time before it shows as Overdue again">
              <input
                type="number"
                min={1}
                max={365}
                value={postponeDays}
                onChange={(e) => setPostponeDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                disabled={postponingId === inst.id}
                className="w-12 px-1.5 py-1 text-[11px] text-gray-700 border border-gray-200 rounded focus:outline-none focus:border-brand-400 disabled:opacity-50"
                aria-label="Days to add"
              />
              <button
                onClick={() => onPostpone(postponeDays)}
                disabled={postponingId === inst.id}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50"
              >
                {postponingId === inst.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarPlus className="w-3 h-3" />}
                Add days
              </button>
            </div>
          )}
          {inst.status === 'running' && (
            <>
              {isAutoRetrying && (
                <ActionBtn onClick={onRetry} disabled={retryingId === inst.id} variant="primary">
                  {retryingId === inst.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Retry now
                </ActionBtn>
              )}
              <ActionBtn onClick={onCancel} disabled={cancellingId === inst.id} variant="danger">
                {cancellingId === inst.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                Cancel
              </ActionBtn>
            </>
          )}
          {(inst.status === 'failed' || inst.status === 'cancelled') && (
            <>
              <ActionBtn onClick={onRetry} disabled={retryingId === inst.id} variant="primary">
                {retryingId === inst.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Try Again
              </ActionBtn>
              {inst.status === 'failed' && (
                <ActionBtn onClick={onCancel} disabled={cancellingId === inst.id} variant="danger">
                  {cancellingId === inst.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                  Cancel
                </ActionBtn>
              )}
            </>
          )}
          {hasParams && (
            <button
              onClick={() => setShowParams((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            >
              <ShieldCheck className="w-3 h-3" />
              {showParams ? 'Hide Params' : 'View Params'}
            </button>
          )}
          {maestroBaseUrl && (
            <MaestroMenu monitorUrl={monitorUrl} instanceUrl={inst.instanceUrl} fallbackUrl={maestroBaseUrl} />
          )}
        </div>
      )}

      {/* Input params */}
      {hasParams && showParams && (
        <div className="border-t border-gray-100/80">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
            <span className="text-xs font-medium text-gray-700">Input Parameters</span>
            <span
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(displayInputs, null, 2));
                toast.success('Copied to clipboard');
              }}
              className="p-1 hover:bg-gray-200 rounded transition-colors cursor-pointer"
            >
              <Copy className="w-3 h-3 text-gray-500" />
            </span>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {Object.entries(displayInputs).map(([key, value], i) => (
                  <tr key={key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    <td className="px-3 py-1.5 font-medium text-gray-500 whitespace-nowrap w-2/5 border-r border-gray-100/80 align-top">
                      {key}
                    </td>
                    <td className="px-3 py-1.5 text-gray-800 font-mono break-all align-top">
                      {value === null || value === undefined
                        ? <span className="text-gray-300 italic">null</span>
                        : typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────

function RetryCountdown({ nextRetryAt }: { nextRetryAt: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function calc() {
      const diff = new Date(nextRetryAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('now'); return; }
      const secs = Math.ceil(diff / 1000);
      if (secs < 60) setLabel(`in ${secs}s`);
      else {
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        setLabel(s > 0 ? `in ${mins}m ${s}s` : `in ${mins}m`);
      }
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [nextRetryAt]);

  return <>{label}</>;
}

// ─── Maestro dropdown menu ────────────────────────────────────

export function MaestroMenu({ monitorUrl, instanceUrl, fallbackUrl, pushRight = true }: { monitorUrl?: string; instanceUrl?: string; fallbackUrl?: string; pushRight?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const inButton = btnRef.current?.closest('[data-maestro-menu]')?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inButton && !inMenu) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + window.scrollY + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  }

  return (
    <div className={clsx(pushRight && 'ml-auto')} data-maestro-menu>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
      >
        Docusign
        <svg className={clsx('w-2.5 h-2.5 transition-transform', open && 'rotate-180')} viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          data-maestro-menu
          style={{ position: 'absolute', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg min-w-[110px] py-1"
        >
          <a
            href={monitorUrl ?? fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            <Eye className="w-3 h-3" /> Detail
          </a>
          <a
            href={instanceUrl ?? fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ActionBtn({ onClick, disabled, variant, children }: {
  onClick: () => void;
  disabled?: boolean;
  variant: 'primary' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors disabled:opacity-50',
        variant === 'danger' ? 'text-red-500 hover:bg-red-50' : 'text-brand-600 hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}

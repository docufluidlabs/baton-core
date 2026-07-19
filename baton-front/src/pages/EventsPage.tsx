import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useEvents, useEventStats, fetchEventsPage, type PipelineEvent } from '@/hooks/useApi';
import {
  Activity,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Copy,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Timer,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { PLATFORM_LABELS, timeAgo, formatDuration } from '@/lib/utils';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

// ─── Constants ─────────────────────────────────────────────────

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'rule_match', label: 'Automations' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'envelope', label: 'Envelopes' },
];

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
];

const PLATFORMS = [
  { value: '', label: 'All' },
  { value: 'docusign', label: 'Docusign' },
  { value: 'xero', label: 'Xero' },
  { value: 'procore', label: 'Procore' },
  { value: 'mondaycom', label: 'monday.com' },
  { value: 'smartsheet', label: 'Smartsheet' },
  { value: 'bamboohr', label: 'BambooHR' },
  { value: 'zohocrm', label: 'Zoho CRM' },
  { value: 'hubspot', label: 'HubSpot' },
];

const STATUS_BORDER: Record<string, string> = {
  completed: 'border-l-green-500',
  running: 'border-l-blue-500',
  failed: 'border-l-red-500',
  pending: 'border-l-gray-300',
};

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  running: 'bg-blue-500 animate-pulse',
  failed: 'bg-red-500',
  pending: 'bg-gray-400',
};

const PLATFORM_COLORS: Record<string, string> = {
  docusign: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  procore: 'bg-orange-50 text-orange-700 border-orange-200',
  mondaycom: 'bg-red-50 text-red-700 border-red-200',
  xero: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  bamboohr: 'bg-green-50 text-green-700 border-green-200',
  zohocrm: 'bg-red-50 text-red-700 border-red-200',
  smartsheet: 'bg-blue-50 text-blue-700 border-blue-200',
  hubspot: 'bg-orange-50 text-orange-700 border-orange-200',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-50 text-green-700 border-green-300',
  failed: 'bg-red-50 text-red-700 border-red-300',
  running: 'bg-blue-50 text-blue-700 border-blue-300',
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
};

// ─── Main Page ─────────────────────────────────────────────────

export default function EventsPage() {
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const { data, isLoading } = useEvents({ limit: 50, category, status, platform });
  const { data: statsData } = useEventStats();

  const [extraEvents, setExtraEvents] = useState<PipelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const firstPageCursor = data?.nextCursor ?? null;
  const hasMore = extraEvents.length > 0 ? !!nextCursor : !!data?.hasMore;
  const events = [...(data?.events || []), ...extraEvents];
  const stats = statsData?.stats as Record<string, unknown> | undefined;

  const resetExtra = useCallback(() => {
    setExtraEvents([]);
    setNextCursor(null);
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor || firstPageCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchEventsPage({ limit: 50, category, status, platform, cursor });
      setExtraEvents((prev) => [...prev, ...page.events]);
      setNextCursor(page.nextCursor);
    } catch {
      // error shown by global handler
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, firstPageCursor, category, status, platform, loadingMore]);

  // Live indicator pulse
  const [livePulse, setLivePulse] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLivePulse(true);
    const t = setTimeout(() => setLivePulse(false), 1000);
    return () => clearTimeout(t);
  }, [data]);

  const hasFilters = !!(category || status || platform);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Events</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time pipeline activity</p>
        </div>
        <LiveIndicator pulse={livePulse} />
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Events (24h)"
            value={stats.total24h as number}
            icon={<Activity className="w-4 h-4" />}
            accent="border-l-brand-500"
          />
          <StatCard
            label="Completed"
            value={(stats as any).byStatus?.completed || 0}
            icon={<CheckCircle className="w-4 h-4" />}
            accent="border-l-green-500"
          />
          <StatCard
            label="Failed"
            value={(stats as any).byStatus?.failed || 0}
            icon={<XCircle className="w-4 h-4" />}
            accent="border-l-red-500"
            alert={(stats as any).byStatus?.failed > 0}
          />
          <StatCard
            label="Failure Rate"
            value={`${stats.failureRate || 0}%`}
            icon={(stats.failureRate as number) > 10
              ? <TrendingUp className="w-4 h-4" />
              : <TrendingDown className="w-4 h-4" />}
            accent="border-l-yellow-500"
            alert={(stats.failureRate as number) > 10}
          />
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        {/* Category tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => { setCategory(c.value); resetExtra(); }}
              className={clsx(
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                category === c.value
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Platform + Status chips — two rows */}
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Platform</span>
          <div className="flex items-center gap-2 flex-wrap">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setPlatform(p.value); resetExtra(); }}
                className={clsx(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  platform === p.value
                    ? p.value
                      ? (PLATFORM_COLORS[p.value] || 'bg-gray-100 text-gray-700 border-gray-300')
                      : 'bg-brand-50 text-brand-700 border-brand-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                )}
              >
                {p.value && <PlatformIcon platform={p.value} size={14} />}
                {p.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Status</span>
          <div className="flex items-center gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => { setStatus(s.value); resetExtra(); }}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  status === s.value
                    ? s.value
                      ? (STATUS_COLORS[s.value] || 'bg-gray-100 text-gray-700 border-gray-300')
                      : 'bg-brand-50 text-brand-700 border-brand-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                )}
              >
                {s.value && <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[s.value])} />}
                {s.label}
              </button>
            ))}
            {hasFilters && (
              <button
                onClick={() => { setCategory(''); setStatus(''); setPlatform(''); resetExtra(); }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Event list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : events.length === 0 ? (
        <EmptyEvents hasFilters={hasFilters} />
      ) : (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {events.map((event, i) => (
              <EventRow key={event.id} event={event} isLast={i === events.length - 1} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load more events'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Event Row ─────────────────────────────────────────────────

function EventRow({ event, isLast }: { event: PipelineEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [payloadExpanded, setPayloadExpanded] = useState(false);

  const borderColor = STATUS_BORDER[event.status] || 'border-l-gray-300';
  const summary = event.eventSummary || event.actionDescription || event.eventType;

  function copyPayload() {
    if (event.rawPayload) {
      navigator.clipboard.writeText(JSON.stringify(event.rawPayload, null, 2));
      toast.success('Copied to clipboard');
    }
  }

  function copyEventId() {
    navigator.clipboard.writeText(event.id);
    toast.success('Event ID copied');
  }

  return (
    <div className={clsx(!isLast && 'border-b border-gray-100')}>
      {/* Row header */}
      <div
        className={clsx(
          'flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/80 transition-colors border-l-[3px]',
          borderColor,
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Platform icon */}
        {event.sourcePlatform && (
          <span className="shrink-0 w-6 flex items-center justify-center">
            <PlatformIcon platform={event.sourcePlatform} size={18} />
          </span>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{summary}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{timeAgo(event.triggeredAt)}</span>
            {event.sourcePlatform && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">
                  {PLATFORM_LABELS[event.sourcePlatform] || event.sourcePlatform}
                </span>
              </>
            )}
            {event.attributedTo && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-400">{event.attributedTo}</span>
              </>
            )}
          </div>
        </div>

        {/* Status badge */}
        <StatusBadge status={event.status} />

        {/* Duration */}
        {event.durationMs != null && event.durationMs > 0 && (
          <span className="text-xs text-gray-400 tabular-nums w-14 text-right flex items-center gap-1 justify-end">
            <Timer className="w-3 h-3" />
            {formatDuration(event.durationMs)}
          </span>
        )}

        {/* Chevron */}
        <ChevronRight className={clsx(
          'w-4 h-4 text-gray-400 shrink-0 transition-transform duration-150',
          expanded && 'rotate-90',
        )} />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className={clsx('px-4 pb-4 pl-[43px] space-y-3 border-l-[3px]', borderColor)}>
          {/* Two-column details */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <DetailRow label="Event ID" value={event.id} mono copyable onCopy={copyEventId} />
              <DetailRow label="Type" value={event.eventType} />
              {event.actionDescription && <DetailRow label="Action" value={event.actionDescription} />}
              <DetailRow label="Triggered" value={new Date(event.triggeredAt).toLocaleString()} />
              {event.completedAt && <DetailRow label="Completed" value={new Date(event.completedAt).toLocaleString()} />}
              {event.durationMs != null && <DetailRow label="Duration" value={`${event.durationMs}ms`} />}
              {event.ruleId && <DetailRow label="Automation ID" value={event.ruleId} mono />}
              {event.workflowInstanceId && <DetailRow label="Instance" value={event.workflowInstanceId} mono />}
              {event.attributedTo && <DetailRow label="User" value={event.attributedTo} />}
              {event.attemptNumber != null && event.attemptNumber > 1 && (
                <DetailRow label="Attempt" value={String(event.attemptNumber)} />
              )}
            </div>
          </div>

          {/* User message */}
          {event.userMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-yellow-50 rounded-lg text-yellow-800 text-xs border border-yellow-100">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{event.userMessage}</span>
            </div>
          )}

          {/* Error */}
          {event.errorMessage && (
            <div className="flex items-start gap-2 p-2.5 bg-red-50 rounded-lg text-red-700 text-xs border border-red-100">
              <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <pre className="font-mono whitespace-pre-wrap break-all flex-1">{event.errorMessage}</pre>
            </div>
          )}

          {/* Payload */}
          {event.rawPayload && Object.keys(event.rawPayload).length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div
                onClick={(e) => { e.stopPropagation(); setPayloadExpanded(!payloadExpanded); }}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-xs font-medium text-gray-700 cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPayloadExpanded(!payloadExpanded); } }}
              >
                <span>Webhook Payload</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); copyPayload(); }}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Copy payload"
                  >
                    <Copy className="w-3.5 h-3.5 text-gray-500" />
                  </button>
                  <ChevronRight className={clsx(
                    'w-3.5 h-3.5 text-gray-500 transition-transform duration-150',
                    payloadExpanded && 'rotate-90',
                  )} />
                </div>
              </div>
              {payloadExpanded && (
                <pre className="p-3 text-[11px] text-gray-700 font-mono bg-white overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(event.rawPayload, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full min-w-[78px] justify-center',
      status === 'completed' ? 'bg-green-50 text-green-700' :
      status === 'failed' ? 'bg-red-50 text-red-700' :
      status === 'running' ? 'bg-blue-50 text-blue-700' :
      'bg-gray-100 text-gray-600',
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[status] || 'bg-gray-400')} />
      {status}
    </span>
  );
}

function DetailRow({ label, value, mono, copyable, onCopy }: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className={clsx('text-gray-700 truncate', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
      {copyable && (
        <button onClick={onCopy} className="p-0.5 hover:bg-gray-200 rounded transition-colors shrink-0">
          <Copy className="w-3 h-3 text-gray-400" />
        </button>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, accent, alert }: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
  alert?: boolean;
}) {
  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200 border-l-[3px] px-4 py-3', accent)}>
      <div className="flex items-center gap-2">
        <span className={clsx('text-gray-400', alert && 'text-red-400')}>{icon}</span>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className={clsx('text-xl font-semibold mt-1', alert ? 'text-red-600' : 'text-gray-900')}>
        {value}
      </p>
    </div>
  );
}

function LiveIndicator({ pulse }: { pulse: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className="relative flex h-2 w-2">
        <span className={clsx(
          'absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75',
          pulse && 'animate-ping',
        )} />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      Live
    </div>
  );
}

function EmptyEvents({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">
        {hasFilters ? 'No matching events' : 'No events yet'}
      </h3>
      <p className="text-sm text-gray-500">
        {hasFilters
          ? 'Try adjusting your filters to see more events.'
          : 'Events will appear here once platforms start sending webhooks.'}
      </p>
    </div>
  );
}



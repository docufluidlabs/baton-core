import { useDashboard, type AttentionItem } from '@/hooks/useApi';
import { Activity, GitBranch, Plug, Workflow, AlertTriangle, XCircle, Info, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { PLATFORM_LABELS, timeAgo } from '@/lib/utils';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import { Link } from 'react-router-dom';

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) {
    return <DashboardSkeleton />;
  }

  const { overview, attentionItems, recentEvents, recentInstances } = data;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Plug}
          label="Connections"
          value={overview.connections.total}
          sub={`${overview.connections.healthy} healthy`}
          color="blue"
        />
        <StatCard
          icon={Workflow}
          label="Workflow Checker"
          value={overview.workflows.total}
          sub={`${overview.workflows.totalLaunches} launches`}
          color="purple"
        />
        <StatCard
          icon={GitBranch}
          label="Active Automations"
          value={overview.automations.active}
          sub={overview.automations.error > 0 ? `${overview.automations.error} errors` : `${overview.automations.paused} paused`}
          color={overview.automations.error > 0 ? 'red' : 'green'}
        />
        <StatCard
          icon={Activity}
          label="Events (24h)"
          value={overview.events24h.total}
          sub={overview.events24h.failed > 0 ? `${overview.events24h.failed} failed` : 'All successful'}
          color={overview.events24h.failed > 0 ? 'yellow' : 'green'}
        />
      </div>

      {/* Attention Required */}
      {attentionItems.length > 0 && (
        <AttentionRequired items={attentionItems} />
      )}

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent events */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Events</h2>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No events yet. Connect a platform to get started.</p>
          ) : (
            <div className="space-y-2">
              {recentEvents.slice(0, 8).map((event) => (
                <div key={event.id} className="flex items-center gap-3 py-2">
                  <StatusDot status={event.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{event.eventSummary || event.actionDescription || event.eventType}</p>
                    <p className="text-xs text-gray-500">{timeAgo(event.triggeredAt)}</p>
                  </div>
                  {event.durationMs && (
                    <span className="text-xs text-gray-400">{event.durationMs}ms</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent instances */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Instances</h2>
          {recentInstances.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No workflow instances yet.</p>
          ) : (
            <div className="space-y-2">
              {recentInstances.slice(0, 8).map((inst) => (
                <div key={inst.id} className="flex items-center gap-3 py-2">
                  <StatusDot status={inst.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{inst.instanceName}</p>
                    <p className="text-xs text-gray-500">{timeAgo(inst.startedAt)}</p>
                  </div>
                  <StatusBadge status={inst.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Attention Required ─────────────────────────────────────

function AttentionRequired({ items }: { items: AttentionItem[] }) {
  return (
    <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 border-b border-amber-200">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-900">Attention Required</h2>
        <span className="ml-auto text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
          {items.length} {items.length === 1 ? 'issue' : 'issues'}
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const content = (
    <div className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50/50 transition-colors">
      <div className="mt-0.5 shrink-0">
        {item.severity === 'critical' ? (
          <XCircle className="w-4.5 h-4.5 text-red-500" />
        ) : item.severity === 'warning' ? (
          <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
        ) : (
          <Info className="w-4.5 h-4.5 text-blue-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={clsx(
          'text-sm font-medium',
          item.severity === 'critical' ? 'text-red-900' : 'text-gray-900',
        )}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.platform && (
            <>
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <PlatformIcon platform={item.platform!} size={14} />
                {PLATFORM_LABELS[item.platform] || item.platform}
              </span>
              <span className="text-xs text-gray-300">·</span>
            </>
          )}
          <span className="text-xs text-gray-400">{timeAgo(item.timestamp)}</span>
        </div>
        {item.description && item.description !== (PLATFORM_LABELS[item.platform || ''] || item.platform) && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{item.description}</p>
        )}
      </div>
      {item.actionUrl && (
        <ChevronRight className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      )}
    </div>
  );

  if (item.actionUrl) {
    return <Link to={item.actionUrl} className="block">{content}</Link>;
  }
  return content;
}

// ─── Sub-components ──────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={clsx('p-2 rounded-lg', colorMap[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-500',
    running: 'bg-blue-500 animate-pulse',
    failed: 'bg-red-500',
    pending: 'bg-yellow-500',
  };
  return <div className={clsx('w-2 h-2 rounded-full', colors[status] || 'bg-gray-400')} />;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-50 text-green-700',
    running: 'bg-blue-50 text-blue-700',
    failed: 'bg-red-50 text-red-700',
    pending: 'bg-yellow-50 text-yellow-700',
    cancelled: 'bg-yellow-50 text-yellow-700',
  };
  return (
    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', styles[status] || 'bg-gray-100 text-gray-600')}>
      {status}
    </span>
  );
}


function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-28 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

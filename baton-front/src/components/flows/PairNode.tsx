/**
 * Pair Node — ReactFlow custom node
 * Represents an automation: event → workflow mapping
 *
 * Shows action trigger stats (launched/failed), not workflow instance stats.
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { Pause, Play, Settings, FileText } from 'lucide-react';
import batonLogo from '@/assets/baton.svg';

export interface PairNodeData {
  automationId: string;
  automationName: string;
  eventType: string;
  eventLabel: string;
  workflowName: string;
  status: 'active' | 'paused' | 'error' | 'disabled';
  triggerCount: number;
  completedCount: number;
  failureCount: number;
  runningCount: number;
  cancelledCount: number;
  successRate?: number;
  onPause?: () => void;
  onResume?: () => void;
  onEdit?: () => void;
  onViewLogs?: () => void;
  [key: string]: unknown;
}

const STATUS_CFG: Record<string, { accent: string; badgeBg: string; badgeText: string }> = {
  active: { accent: 'border-green-200', badgeBg: 'bg-green-50', badgeText: 'text-green-700' },
  paused: { accent: 'border-yellow-200', badgeBg: 'bg-yellow-50', badgeText: 'text-yellow-700' },
  error: { accent: 'border-red-200', badgeBg: 'bg-red-50', badgeText: 'text-red-700' },
  disabled: { accent: 'border-gray-200', badgeBg: 'bg-gray-50', badgeText: 'text-gray-500' },
};

function PairNodeComponent({ data, selected }: NodeProps) {
  const d = data as PairNodeData;
  const cfg = STATUS_CFG[d.status] || STATUS_CFG.disabled;

  const failed = d.failureCount;
  const running = d.runningCount;
  const launched = d.completedCount;
  const cancelled = d.cancelledCount;
  const total = launched + running + failed + cancelled;
  const barTotal = launched + running + failed;

  const pctLaunched = barTotal > 0 ? (launched / barTotal) * 100 : 0;
  const pctRunning = barTotal > 0 ? (running / barTotal) * 100 : 0;
  const pctFailed = barTotal > 0 ? (failed / barTotal) * 100 : 0;

  return (
    <div
      className={clsx(
        'relative rounded-xl border shadow-sm bg-white w-[240px] transition-shadow',
        cfg.accent,
        selected && 'ring-2 ring-brand-400 ring-offset-2',
      )}
    >
      {/* Header: name + status */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <img src={batonLogo} alt="" className="w-5 h-5 shrink-0" />
          <span className="text-[13px] font-medium text-gray-900 line-clamp-3">{d.automationName}</span>
        </div>
        <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ml-2', cfg.badgeBg, cfg.badgeText)}>
          {d.status}
        </span>
      </div>

      {/* Stacked bar + stats — always visible (shows zeros for fresh automations) */}
      <div className="px-3.5 pb-2.5">
        {/* Stacked progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex h-[6px] rounded-full overflow-hidden bg-gray-100">
            {pctRunning > 0 && (
              <div className="bg-blue-400 shrink-0 animate-pulse" style={{ width: `${pctRunning}%` }} />
            )}
            {pctLaunched > 0 && (
              <div className="bg-green-500 shrink-0" style={{ width: `${pctLaunched}%` }} />
            )}
            {pctFailed > 0 && (
              <div className="bg-red-500 shrink-0" style={{ width: `${pctFailed}%` }} />
            )}
          </div>
          <span className="text-[9px] text-gray-400 tabular-nums shrink-0">{total} total</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-1 mt-2">
          {[
            { count: running,    label: 'running/queue', num: 'text-blue-500',  lbl: 'text-blue-500'  },
            { count: launched,   label: 'completed',  num: 'text-green-600', lbl: 'text-green-600' },
            { count: failed,     label: 'failed',     num: 'text-red-500',   lbl: 'text-red-500'   },
            { count: cancelled,  label: 'cancelled',  num: 'text-gray-400',  lbl: 'text-gray-400'  },
          ].map(({ count, label, num, lbl }) => (
            <div key={label} className="flex flex-col items-center">
              <span className={clsx('text-[13px] font-semibold tabular-nums', count > 0 ? num : 'text-gray-300')}>{count}</span>
              <span className={clsx('text-[8px] font-medium', count > 0 ? lbl : 'text-gray-300')}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex border-t border-gray-100 divide-x divide-gray-100">
        {d.status === 'active' && d.onPause && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onPause?.(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50/50 transition-colors"
          >
            <Pause className="w-3 h-3" /> Pause
          </button>
        )}
        {(d.status === 'paused' || d.status === 'error') && d.onResume && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onResume?.(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-green-600 hover:bg-green-50/50 transition-colors"
          >
            <Play className="w-3 h-3" /> Resume
          </button>
        )}
        {d.onViewLogs && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onViewLogs?.(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-gray-500 hover:text-brand-600 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-3 h-3" /> Logs
          </button>
        )}
        {d.onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onEdit?.(); }}
            className="flex-1 flex items-center justify-center py-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-brand-500 !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-purple-500 !border-2 !border-white" />
    </div>
  );
}

export const PairNode = memo(PairNodeComponent);

/**
 * Workflow Node — ReactFlow custom node
 * Represents a Maestro workflow (target/destination)
 * Shows: workflow name, stacked bar with completed/running/failed counts, View Instances link, status
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { LayoutList } from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

export interface WorkflowNodeData {
  workflowId: string;
  workflowName: string;
  maestroStatus: string;
  platform?: string;
  launchCount: number;
  completedCount: number;
  failCount: number;
  cancelledCount: number;
  runningCount?: number;
  lastLaunchedAt?: string;
  successRate?: number;
  maestroInstancesUrl?: string;
  onViewInstances?: () => void;
  [key: string]: unknown;
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-400',
  paused: 'bg-amber-400',
  inactive: 'bg-gray-400',
  error: 'bg-red-400',
};

function WorkflowNodeComponent({ data }: NodeProps) {
  const d = data as WorkflowNodeData;
  const completed = d.completedCount;
  const running = d.runningCount ?? 0;
  const failed = d.failCount;
  const cancelled = d.cancelledCount ?? 0;
  // Use the sum of all statuses as total — launchCount only tracks manual launches,
  // not webhook-triggered instances, so it under-counts when automation rules fire.
  const total = completed + running + failed + cancelled || d.launchCount;
  const barTotal = completed + running + failed;

  const pctCompleted = barTotal > 0 ? (completed / barTotal) * 100 : 0;
  const pctRunning = barTotal > 0 ? (running / barTotal) * 100 : 0;
  const pctFailed = barTotal > 0 ? (failed / barTotal) * 100 : 0;

  return (
    <div className="relative rounded-xl border border-purple-200 bg-white shadow-sm w-[240px]">
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="p-1.5 bg-purple-50 rounded-lg">
          <PlatformIcon platform={d.platform ?? 'docusign'} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[d.maestroStatus] || STATUS_DOT.inactive)} />
            <p className="text-[13px] font-semibold text-gray-900 line-clamp-3">{d.workflowName}</p>
          </div>
        </div>
      </div>

      {/* Stacked bar + stats */}
      <div className="px-4 pb-3">
        {total > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 flex h-[6px] rounded-full overflow-hidden bg-gray-100">
              {pctRunning > 0 && (
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ width: `${pctRunning}%`, background: 'linear-gradient(90deg, #93c5fd 25%, #60a5fa 50%, #93c5fd 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite' }}
                />
              )}
              {pctCompleted > 0 && (
                <div className="bg-green-500 shrink-0" style={{ width: `${pctCompleted}%` }} />
              )}
              {pctFailed > 0 && (
                <div className="bg-red-500 shrink-0" style={{ width: `${pctFailed}%` }} />
              )}
            </div>
            <span className="text-[9px] text-gray-400 tabular-nums shrink-0">{total} total</span>
          </div>
        )}

        <div className="grid grid-cols-4 gap-1">
          {[
            { count: running,   label: 'running',   num: 'text-blue-500',  lbl: 'text-blue-500'  },
            { count: completed, label: 'completed', num: 'text-green-600', lbl: 'text-green-600' },
            { count: failed,    label: 'failed',    num: 'text-red-500',   lbl: 'text-red-500'   },
            { count: cancelled, label: 'cancelled', num: 'text-gray-400',  lbl: 'text-gray-400'  },
          ].map(({ count, label, num, lbl }) => (
            <div key={label} className="flex flex-col items-center">
              <span className={clsx('text-[13px] font-semibold tabular-nums', count > 0 ? num : 'text-gray-300')}>{count}</span>
              <span className={clsx('text-[8px] font-medium', count > 0 ? lbl : 'text-gray-300')}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* View Instances */}
      {d.onViewInstances && (
        <div className="border-t border-gray-100 px-4 py-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); d.onViewInstances!(); }}
            className="flex items-center gap-1 text-[10px] font-medium text-purple-600 hover:text-purple-700 transition-colors"
          >
            <LayoutList className="w-3 h-3" /> View Instances
          </button>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-purple-500 !border-2 !border-white" />
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);

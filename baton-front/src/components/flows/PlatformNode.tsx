/**
 * Platform Node — ReactFlow custom node
 * Represents a connected platform (source of webhook events)
 * Shows: logo, platform name, total actions this month, "+" button
 *
 * The "+" button opens the new-automation sidebar with this platform
 * preselected. (Bulk Upload lives on its own page - it has no source platform.)
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';

export interface PlatformNodeData {
  platform: string;
  displayName: string;
  status: 'healthy' | 'warning' | 'error' | 'pending';
  automationsCount: number;
  totalActionsThisMonth: number;
  lastWebhookAt?: string;
  /** Opens the new-automation sidebar with this platform preselected. */
  onAddClick?: () => void;
  [key: string]: unknown;
}

function PlatformNodeComponent({ data }: NodeProps) {
  const d = data as PlatformNodeData;

  return (
    <div className="relative flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 shadow-sm bg-white w-[240px]">
      <PlatformIcon platform={d.platform} size={28} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{d.displayName}</p>
        <p className="text-[10px] text-gray-400">
          {d.totalActionsThisMonth > 0
            ? `${d.totalActionsThisMonth.toLocaleString()} relays this month`
            : 'No relays yet'}
        </p>
      </div>

      {/* "+" handle */}
      <button
        onClick={(e) => { e.stopPropagation(); d.onAddClick?.(); }}
        className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-colors z-10"
      >
        <Plus className="w-3 h-3" />
      </button>
      <Handle type="source" position={Position.Right} className="!w-5 !h-5 !bg-transparent !border-0" />
    </div>
  );
}

export const PlatformNode = memo(PlatformNodeComponent);

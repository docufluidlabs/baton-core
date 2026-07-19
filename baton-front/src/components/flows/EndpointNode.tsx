/**
 * Endpoint Node — ReactFlow custom node
 * Represents a webhook endpoint: direct platform → workflow binding
 *
 * Fix: window.confirm() removed from Delete button.
 * onDelete() is called immediately — the parent (FlowBuilderPage)
 * intercepts it and shows ConfirmModal before executing the delete.
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { Webhook, Trash2 } from 'lucide-react';

export interface EndpointNodeData {
  endpointId: string;
  endpointName: string;
  platform: string;
  workflowName: string;
  enabled: boolean;
  requestCount: number;
  lastRequestAt?: string;
  onEdit?: () => void;
  /** Called immediately — parent handles confirmation via ConfirmModal. */
  onDelete?: () => void;
  [key: string]: unknown;
}

function EndpointNodeComponent({ data, selected }: NodeProps) {
  const d = data as EndpointNodeData;

  return (
    <div
      className={clsx(
        'rounded-xl border-2 shadow-sm bg-white min-w-[260px] transition-shadow',
        d.enabled ? 'border-teal-200' : 'border-gray-200',
        selected && 'ring-2 ring-teal-400 ring-offset-2',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Webhook className="w-4 h-4 text-teal-500" />
          <span className="text-sm font-medium text-gray-900 truncate max-w-[160px]">{d.endpointName}</span>
        </div>
        <span className={clsx(
          'text-[10px] font-medium px-2 py-0.5 rounded-full',
          d.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500',
        )}>
          {d.enabled ? 'active' : 'disabled'}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded font-medium">webhook</span>
          <span className="text-gray-400">→</span>
          <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-medium truncate max-w-[120px]">
            {d.workflowName}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-2.5 text-[10px] text-gray-500">
          <span>{d.requestCount} requests</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex border-t border-gray-100">
        {d.onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onEdit?.(); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Edit
          </button>
        )}
        {d.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              // No window.confirm() — parent handles confirmation via ConfirmModal
              d.onDelete?.();
            }}
            className="flex items-center justify-center gap-1 px-3 py-2 text-[11px] font-medium text-red-500 hover:bg-red-50 transition-colors border-l border-gray-100"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white" />
    </div>
  );
}

export const EndpointNode = memo(EndpointNodeComponent);

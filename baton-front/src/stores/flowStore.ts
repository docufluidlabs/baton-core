import { create } from 'zustand';
import type { Automation, FlowCell } from '@/hooks/useApi';
import type { ReactFlowInstance } from '@xyflow/react';

interface FlowStore {
  // Sidebar
  sidebarOpen: boolean;
  editingAutomation: Automation | null;
  preSelectedPlatform: string | null;
  openSidebar: (automation?: Automation | null, platform?: string) => void;
  closeSidebar: () => void;

  // Action logs sidebar
  logsRuleId: string | null;
  logsRuleName: string | null;
  logsInitialActionNumber: number | null;
  openLogs: (ruleId: string, ruleName: string, initialActionNumber?: number) => void;
  closeLogs: () => void;

  // Bulk Upload — create/edit sidebar
  batchSidebarOpen: boolean;
  editingBatchProcessorId: string | null;
  openBatchSidebar: (processorId?: string | null) => void;
  closeBatchSidebar: () => void;

  // Bulk Upload — file upload wizard
  batchWizardProcessorId: string | null;
  openBatchWizard: (processorId: string) => void;
  closeBatchWizard: () => void;

  // Bulk Upload — run/row logs sidebar
  batchLogsProcessorId: string | null;
  openBatchLogs: (processorId: string) => void;
  closeBatchLogs: () => void;

  // Activity log sidebar (all instances across canvas). Can carry an optional
  // workflow filter — viewing a single workflow's instances now opens the
  // Activity Log pre-filtered to that workflow instead of a separate panel.
  activityLogOpen: boolean;
  activityLogWorkflowId: string | null;
  activityLogWorkflowName: string | null;
  openActivityLog: (workflowId?: string | null, workflowName?: string | null) => void;
  closeActivityLog: () => void;

  // Tip
  tipDismissed: boolean;
  dismissTip: () => void;

  // ReactFlow instance
  rfInstance: ReactFlowInstance | null;
  setRfInstance: (instance: ReactFlowInstance | null) => void;
  hasFitView: boolean;
  markFitView: () => void;

  // Trigger fitView on the stored instance
  fitView: () => void;

  // Node cell persistence - logical grid cells keyed by node id, mirrored to
  // the server. Pixel positions are derived at render time (flowBuilderGrid).
  savedCells: Record<string, FlowCell>;
  /** Merge cells in (drag saves and server loads alike); no-op when nothing changed. */
  setNodeCells: (cells: Record<string, FlowCell>) => void;
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch { /* unavailable in some privacy modes */ }
}

export const useFlowStore = create<FlowStore>((set, get) => ({
  // Sidebar
  sidebarOpen: false,
  editingAutomation: null,
  preSelectedPlatform: null,
  openSidebar: (automation = null, platform) => set({ sidebarOpen: true, editingAutomation: automation, preSelectedPlatform: platform ?? null, activityLogOpen: false }),
  closeSidebar: () => set({ sidebarOpen: false, editingAutomation: null, preSelectedPlatform: null }),

  // Action logs sidebar — intentionally does NOT close the Activity Log, so the
  // relay log can sit alongside it (e.g. clicking a relay link from the feed).
  logsRuleId: null,
  logsRuleName: null,
  logsInitialActionNumber: null,
  openLogs: (ruleId, ruleName, initialActionNumber) => set({ logsRuleId: ruleId, logsRuleName: ruleName, logsInitialActionNumber: initialActionNumber ?? null, sidebarOpen: false }),
  closeLogs: () => set({ logsRuleId: null, logsRuleName: null, logsInitialActionNumber: null }),

  // Bulk Upload sidebar — mirrors openSidebar: closes the other edit panels so
  // only one right-hand editor is visible at a time.
  batchSidebarOpen: false,
  editingBatchProcessorId: null,
  openBatchSidebar: (processorId = null) => set({
    batchSidebarOpen: true,
    editingBatchProcessorId: processorId,
    sidebarOpen: false,
    activityLogOpen: false,
  }),
  closeBatchSidebar: () => set({ batchSidebarOpen: false, editingBatchProcessorId: null }),

  // Bulk Upload wizard
  batchWizardProcessorId: null,
  openBatchWizard: (processorId) => set({ batchWizardProcessorId: processorId, batchSidebarOpen: false }),
  closeBatchWizard: () => set({ batchWizardProcessorId: null }),

  // Bulk Upload logs — like openLogs, closes the edit sidebars but leaves the
  // Activity Log alone so both can sit side by side.
  batchLogsProcessorId: null,
  openBatchLogs: (processorId) => set({ batchLogsProcessorId: processorId, sidebarOpen: false, batchSidebarOpen: false }),
  closeBatchLogs: () => set({ batchLogsProcessorId: null }),

  // Activity log — keeps the relay log open if it is; only closes the automation editor.
  activityLogOpen: false,
  activityLogWorkflowId: null,
  activityLogWorkflowName: null,
  openActivityLog: (workflowId = null, workflowName = null) => set({ activityLogOpen: true, activityLogWorkflowId: workflowId, activityLogWorkflowName: workflowName, sidebarOpen: false }),
  closeActivityLog: () => set({ activityLogOpen: false }),

  // Tip
  tipDismissed: lsGet('baton-flow-tip-dismissed') === '1',
  dismissTip: () => {
    lsSet('baton-flow-tip-dismissed', '1');
    set({ tipDismissed: true });
  },

  // ReactFlow instance
  rfInstance: null,
  setRfInstance: (instance) => set({ rfInstance: instance }),
  hasFitView: false,
  markFitView: () => set({ hasFitView: true }),

  fitView: () => {
    const { rfInstance } = get();
    if (!rfInstance) return;
    rfInstance.fitView({ padding: 0.12, maxZoom: 1 });
    set({ hasFitView: true });
  },

  // Node cell persistence. The server map (per org) is the single source of
  // truth; nothing is cached in localStorage - the pre-cells refactor cached
  // pixel positions there and stale copies kept resurrecting old layouts.
  savedCells: {},
  setNodeCells: (cells) => {
    const current = get().savedCells;
    let changed = false;
    const merged = { ...current };
    for (const [id, cell] of Object.entries(cells)) {
      const c = current[id];
      if (!c || c.col !== cell.col || c.row !== cell.row) {
        merged[id] = cell;
        changed = true;
      }
    }
    if (changed) set({ savedCells: merged });
  },
}));

// Drop the legacy pixel-position cache so old tabs can never resurrect it.
try { localStorage.removeItem('baton-flow-positions'); } catch { /* unavailable in some privacy modes */ }

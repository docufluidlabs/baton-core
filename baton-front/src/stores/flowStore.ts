import { create } from 'zustand';
import type { Automation } from '@/hooks/useApi';
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

  // Node position persistence
  savedPositions: Record<string, { x: number; y: number }>;
  saveNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  getSavedPosition: (nodeId: string) => { x: number; y: number } | undefined;
  /** Merge server-loaded positions into the store (server wins over stale localStorage) */
  mergeServerPositions: (positions: Record<string, { x: number; y: number }>) => void;
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

  // Node position persistence
  savedPositions: (() => {
    try {
      const raw = localStorage.getItem('baton-flow-positions');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  })(),
  saveNodePosition: (nodeId, position) => {
    const positions = { ...get().savedPositions, [nodeId]: position };
    set({ savedPositions: positions });
    lsSet('baton-flow-positions', JSON.stringify(positions));
  },
  getSavedPosition: (nodeId) => get().savedPositions[nodeId],
  mergeServerPositions: (positions) => {
    const merged = { ...get().savedPositions, ...positions };
    set({ savedPositions: merged });
    lsSet('baton-flow-positions', JSON.stringify(merged));
  },
}));

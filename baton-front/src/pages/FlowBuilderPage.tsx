/**
 * Flow Builder Page — Baton
 *
 * Uses Zustand (flowStore) for UI state: sidebar, confirm modal, tip, fitView.
 * ReactFlow nodes/edges are still local (useNodesState) because they need
 * ReactFlow's internal change-tracking.
 */
import { useMemo, useEffect, useCallback, useRef, useState, Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  // MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useConnections,
  useAutomations,
  useWorkflows,
  useInstalledPlatforms,
  useInstanceCounts,
  updateAutomationStatus,
  saveFlowLayout,
  type FlowPositions,
} from '@/hooks/useApi';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/api';
import { PlatformNode, type PlatformNodeData } from '@/components/flows/PlatformNode';
import { PairNode, type PairNodeData } from '@/components/flows/PairNode';
import { WorkflowNode, type WorkflowNodeData } from '@/components/flows/WorkflowNode';
import { FlowSidebar } from '@/components/flows/FlowSidebar';
import { ActionLogsSidebar } from '@/components/flows/ActionLogsSidebar';
import { useFlowStore } from '@/stores/flowStore';
import { Plus, Loader2, GitBranch, X as XIcon, Send, CheckCircle, XCircle, MessagesSquare } from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { createSupportTicket } from '@/hooks/useApi';
import { toast } from 'sonner';
import {
  COL_X, ROW_GAP, START_Y,
  CELL_W, CELL_H, GRID_ORIGIN_X, GRID_ORIGIN_Y, CELL_PAD_X, CELL_PAD_TOP,
  snapToCell, nodeHeight, yCenteringOffset, normalizePositions,
} from './flowBuilderGrid';
import { reconcileNodes, findDanglingEdges } from './flowBuilderSync';

// ─── Node Types ──────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  platform: PlatformNode,
  pair: PairNode,
  workflow: WorkflowNode,
};

// ─── Layout / Grid Constants ─────────────────────────────────
// Pure grid geometry (snapping, centering, collision resolution) lives in
// ./flowBuilderGrid so it can be unit-tested without React/ReactFlow.

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

// ─── ReactFlow Error Boundary ────────────────────────────────
// Isolates ReactFlow crashes so the rest of the UI (sidebars, header) stays intact.

class ReactFlowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-50 text-center p-8">
          <GitBranch className="w-10 h-10 text-gray-300 mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Flow diagram failed to render</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-md">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Page Component ──────────────────────────────────────────

export default function FlowBuilderPage() {
  return (
    <ReactFlowProvider>
      <FlowBuilderContent />
    </ReactFlowProvider>
  );
}

function FlowBuilderContent() {
  const { data: connData } = useConnections({ refreshInterval: 15_000 });
  const { data: automationsData } = useAutomations({ refreshInterval: 15_000 });
  const { data: wfData } = useWorkflows({ refreshInterval: 15_000 });
  const { data: platformsData } = useInstalledPlatforms();
  const { data: countsData } = useInstanceCounts();
  const { mutate } = useSWRConfig();

  // Zustand store
  const {
    sidebarOpen, editingAutomation, openSidebar, closeSidebar,
    tipDismissed, dismissTip,
    setRfInstance,
    getSavedPosition, saveNodePosition, mergeServerPositions,
    openActivityLog,
    logsRuleId, logsRuleName, logsInitialActionNumber, openLogs, closeLogs,
  } = useFlowStore();

  // Activity Log button moved to AppLayout's bottom nav (after Notifications).
  // The sidebar itself is rendered globally there, so FlowBuilder only handles
  // its own automation/instances/action-logs sidebars.

  const location = useLocation();

  // Auto-open sidebar when navigated from ConnectionsPage with a platform to set up
  useEffect(() => {
    const setupPlatform = (location.state as any)?.setupPlatform;
    if (setupPlatform && !sidebarOpen) {
      openSidebar(null, setupPlatform);
      // Clear the state so it doesn't re-trigger on re-renders
      window.history.replaceState({}, '');
    }
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const connections = useMemo(() => connData?.connections ?? [], [connData]);
  const automations = useMemo(() => automationsData?.automations ?? [], [automationsData]);
  const workflows = useMemo(() => wfData?.workflows ?? [], [wfData]);
  const installedPlatforms = useMemo(() => platformsData?.platforms ?? [], [platformsData]);
  // Must be memoized — `?? {}` would otherwise hand back a fresh object every
  // render, invalidating computedNodes' useMemo and the sync effect in a
  // re-render loop until /instances/counts resolves. That loop caused
  // partially-rendered nodes on tab switch / reload.
  const statusCounts = useMemo(() => countsData?.counts ?? {}, [countsData]);
  const isLoading = !connData || !automationsData || !wfData;

  // ─── Build Graph ─────────────────────────────────────────

  const { computedNodes, computedEdges } = useMemo(() => {
    if (isLoading) return { computedNodes: EMPTY_NODES, computedEdges: EMPTY_EDGES };

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const referencedPlatforms = new Set(automations.map((r) => r.sourcePlatform));
    const referencedWorkflows = new Set(automations.map((r) => r.targetWorkflowId));

    // DocuSign is OAuth-only — no webhook source, hide from canvas
    // TODO: re-enable when DocuSign Connect/Navigator webhook support is added
    const OAUTH_ONLY_PLATFORMS = new Set(['docusign']);

    const platformNodeMap = new Map<string, string>();
    let col1Index = 0;

    connections
      .filter((c) => !OAUTH_ONLY_PLATFORMS.has(c.platform) && (referencedPlatforms.has(c.platform) || c.status === 'healthy'))
      .forEach((conn) => {
        const nodeId = `platform-${conn.platform}`;
        platformNodeMap.set(conn.platform, nodeId);
        const platformAutomations = automations.filter((r) => r.sourcePlatform === conn.platform && !r.appSlug);
        const defaultPos = { x: COL_X.platforms, y: START_Y + col1Index++ * ROW_GAP };
        nodes.push({
          id: nodeId,
          type: 'platform',
          position: getSavedPosition(nodeId) ?? defaultPos,
          data: {
            platform: conn.platform,
            displayName: conn.displayName,
            status: conn.status,
            automationsCount: platformAutomations.length,
            totalActionsThisMonth: platformAutomations.reduce((sum, r) => sum + r.timesTriggered, 0),
            onAddAutomation: () => openSidebar(null, conn.platform),
          } satisfies PlatformNodeData,
        });
      });

    // Show active installed platforms (skip if already shown as connection)
    installedPlatforms
      .filter((p) => !OAUTH_ONLY_PLATFORMS.has(p.appSlug) && !platformNodeMap.has(p.appSlug) && p.status === 'active')
      .forEach((platform) => {
        const nodeId = `platform-${platform.appSlug}`;
        platformNodeMap.set(platform.appSlug, nodeId);
        const platformAutomations = automations.filter((r) => r.appSlug === platform.appSlug);
        const defaultPos = { x: COL_X.platforms, y: START_Y + col1Index++ * ROW_GAP };
        nodes.push({
          id: nodeId,
          type: 'platform',
          position: getSavedPosition(nodeId) ?? defaultPos,
          data: {
            platform: platform.appSlug,
            displayName: platform.displayName,
            status: 'healthy' as const,
            automationsCount: platformAutomations.length,
            totalActionsThisMonth: platformAutomations.reduce((sum, r) => sum + r.timesTriggered, 0),
            onAddAutomation: () => openSidebar(null, platform.appSlug),
          } satisfies PlatformNodeData,
        });
      });

    // Pre-compute average success rate per workflow from its automations
    const wfSuccessRates = new Map<string, number>();
    for (const wfId of referencedWorkflows) {
      const wfAutomations = automations.filter((r) => r.targetWorkflowId === wfId && r.successRate != null);
      if (wfAutomations.length > 0) {
        const avg = Math.round(wfAutomations.reduce((sum, r) => sum + (r.successRate ?? 0), 0) / wfAutomations.length);
        wfSuccessRates.set(wfId, avg);
      }
    }

    const workflowNodeMap = new Map<string, string>();
    // Show only workflows that have active automations
    const visibleWorkflows = workflows.filter((wf) => referencedWorkflows.has(wf.id));
    visibleWorkflows.forEach((wf, i) => {
        const nodeId = `workflow-${wf.id}`;
        workflowNodeMap.set(wf.id, nodeId);
        const defaultPos = { x: COL_X.workflows, y: START_Y + i * ROW_GAP };
        nodes.push({
          id: nodeId,
          type: 'workflow',
          position: getSavedPosition(nodeId) ?? defaultPos,
          data: {
            workflowId: wf.id,
            workflowName: wf.name,
            maestroStatus: wf.maestroStatus,
            platform: connections.find((c) => c.id === wf.connectionId)?.platform,
            launchCount: wf.launchCount,
            completedCount: statusCounts[wf.id]?.completed ?? 0,
            failCount: statusCounts[wf.id]?.failed ?? 0,
            cancelledCount: statusCounts[wf.id]?.cancelled ?? 0,
            runningCount: statusCounts[wf.id]?.running ?? 0,
            lastLaunchedAt: wf.lastLaunchedAt,
            successRate: wfSuccessRates.get(wf.id),
            maestroInstancesUrl: wf.maestroInstancesUrl,
            onViewInstances: () => openActivityLog(wf.id, wf.name),
          } satisfies WorkflowNodeData,
        });
      });

    automations.forEach((automation, i) => {
      const nodeId = `pair-${automation.id}`;
      const wf = workflows.find((w) => w.id === automation.targetWorkflowId);
      const eventLabel = automation.eventType.replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const pairDefaultPos = { x: COL_X.pairs, y: START_Y + i * ROW_GAP };
      nodes.push({
        id: nodeId,
        type: 'pair',
        position: getSavedPosition(nodeId) ?? pairDefaultPos,
        data: {
          automationId: automation.id,
          automationName: automation.name,
          eventType: automation.eventType,
          eventLabel,
          workflowName: wf?.name || 'Unknown Workflow',
          status: automation.status,
          triggerCount: automation.timesTriggered,
          runningCount: automation.runningCount ?? 0,
          cancelledCount: automation.cancelledCount ?? 0,
          completedCount: Math.max(0, automation.timesTriggered - automation.failureCount - (automation.runningCount ?? 0) - (automation.cancelledCount ?? 0)),
          failureCount: automation.failureCount,
          successRate: automation.successRate,
          onPause: () => handleAutomationAction(automation.id, 'pause'),
          onResume: () => handleAutomationAction(automation.id, 'resume'),
          onEdit: () => openSidebar(automation),
          onViewLogs: () => openLogs(automation.id, automation.name),
        } satisfies PairNodeData,
      });

      const platformNodeId = platformNodeMap.get(automation.appSlug || automation.sourcePlatform);
      if (platformNodeId) {
        edges.push({
          id: `edge-${platformNodeId}-${nodeId}`,
          source: platformNodeId,
          target: nodeId,
          animated: automation.status === 'active',
          style: { stroke: automation.status === 'active' ? '#3b82f6' : '#e5e7eb', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: automation.status === 'active' ? '#3b82f6' : '#e5e7eb', width: 16, height: 16 },
        });
      }

      const workflowNodeId = workflowNodeMap.get(automation.targetWorkflowId);
      if (workflowNodeId) {
        edges.push({
          id: `edge-${nodeId}-${workflowNodeId}`,
          source: nodeId,
          target: workflowNodeId,
          animated: automation.status === 'active',
          style: { stroke: automation.status === 'active' ? '#a855f7' : '#e5e7eb', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: automation.status === 'active' ? '#a855f7' : '#e5e7eb', width: 16, height: 16 },
        });
      }
    });

    // Normalize all positions onto the current grid and resolve collisions —
    // saved positions from a previous grid size end up off-cell otherwise.
    return { computedNodes: normalizePositions(nodes), computedEdges: edges };
  }, [connections, automations, workflows, installedPlatforms, isLoading, statusCounts, getSavedPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── ReactFlow State ─────────────────────────────────────

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  // Track whether user is currently dragging on this device
  const isDraggingRef = useRef(false);
  // Node IDs whose local position hasn't been confirmed on the server yet.
  // Protects rapidly-dragged nodes from being clobbered by a stale SWR poll
  // response that arrives between drag-end and the debounced server save.
  const dirtyIdsRef = useRef<Set<string>>(new Set());

  // Poll server positions every 10 s — initial load + cross-device sync
  useSWR<{ positions: FlowPositions }>('/flow-layout', fetcher, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
    onSuccess: (data) => {
      if (isDraggingRef.current) return;
      const positions = data?.positions ?? {};
      if (Object.keys(positions).length === 0) return;
      // Drop positions for nodes the user has dragged locally but the server
      // hasn't acknowledged yet — otherwise the response (still stale) would
      // make them snap back.
      const dirty = dirtyIdsRef.current;
      const safe: FlowPositions = {};
      for (const [id, pos] of Object.entries(positions)) {
        if (!dirty.has(id)) safe[id] = pos;
      }
      if (Object.keys(safe).length === 0) return;
      mergeServerPositions(safe);
      // Push new positions into the live ReactFlow node state.
      // Guard: if nodes aren't loaded yet (prev=[]) skip — mergeNodes will
      // pick up server positions from the store once main data arrives.
      setNodes((prev) => {
        if (prev.length === 0) return prev;
        const merged = prev.map((n) => {
          const pos = safe[n.id];
          return pos ? { ...n, position: pos } : n;
        });
        return normalizePositions(merged);
      });
    },
  });

  // Debounced save to server so positions stay in sync across devices
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captures the node's position at drag-start so we can revert on a collision.
  const dragStartPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    isDraggingRef.current = true;
    dragStartPosRef.current.set(node.id, node.position);
  }, []);

  // Persist position when a node is dragged
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      isDraggingRef.current = false;
      const original = dragStartPosRef.current.get(node.id) ?? node.position;
      dragStartPosRef.current.delete(node.id);
      const off = yCenteringOffset(nodeHeight(node));
      // Convert the visual drop position back to its grid anchor before snapping.
      const anchor = { x: node.position.x, y: node.position.y - off };
      const snapped = snapToCell(anchor);
      const snappedVisualY = snapped.y + off;

      // If snapping landed us back where we started, just revert silently.
      if (snapped.x === original.x && snappedVisualY === original.y) {
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, position: original } : n)));
        return;
      }

      // Collision check: is the target cell occupied by another node?
      const occupiedBy = nodes.find((n) => {
        if (n.id === node.id) return false;
        const otherAnchor = { x: n.position.x, y: n.position.y - yCenteringOffset(nodeHeight(n)) };
        const c = snapToCell(otherAnchor);
        return c.col === snapped.col && c.row === snapped.row;
      });

      if (occupiedBy) {
        setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, position: original } : n)));
        toast.info('Клітинка зайнята', { description: 'Перетягніть бабл у вільну клітинку' });
        return;
      }

      const finalPos = { x: snapped.x, y: snappedVisualY };
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, position: finalPos } : n)));
      dirtyIdsRef.current.add(node.id);
      saveNodePosition(node.id, finalPos);
      // Debounce server save — collect rapid drags and flush after 1.5 s
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const snapshot = { ...useFlowStore.getState().savedPositions };
        try {
          await saveFlowLayout(snapshot);
          // Only clear dirty for nodes whose local position still matches
          // what we just sent — a drag during the await means the snapshot
          // is already outdated for that node, so leave it dirty for the
          // next debounce.
          const current = useFlowStore.getState().savedPositions;
          for (const id of Array.from(dirtyIdsRef.current)) {
            const s = snapshot[id];
            const c = current[id];
            if (s && c && s.x === c.x && s.y === c.y) {
              dirtyIdsRef.current.delete(id);
            }
          }
        } catch { /* keep dirty so next drag re-flushes */ }
      }, 1500);
    },
    [nodes, setNodes, saveNodePosition],
  );

  // Node/edge reconciliation lives in ./flowBuilderSync (pure, unit-tested).
  //
  // `computedNodes` and `computedEdges` come from one useMemo, so they always
  // describe the same snapshot — whenever edges advance to a new snapshot, nodes
  // must advance to it too. An earlier version skipped the node merge once on a
  // warm (SWR-cache) mount and synced only edges; if the snapshot changed between
  // the render that seeded useNodesState() and this effect's first run (a poll,
  // statusCounts resolving, a StrictMode double-render…), edges pointed at a newer
  // node set than the nodes in state and arrows/bubbles vanished until the next
  // poll. `reconcileNodes` keeps the warm-mount no-op (returns prev unchanged when
  // the snapshot is identical, so ReactFlow keeps its measurements / drag state)
  // while always re-syncing nodes whenever the snapshot actually advances.
  const lastSyncedNodesRef = useRef(computedNodes);
  useEffect(() => {
    const prevSynced = lastSyncedNodesRef.current;
    lastSyncedNodesRef.current = computedNodes;
    setNodes((prev) => reconcileNodes(prev, computedNodes, prevSynced));
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  // Dev-only guard: surfaces the very desync the reconcile above prevents, so a
  // future regression shows up in the console instead of silently dropping arrows.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const dangling = findDanglingEdges(nodes, edges);
    if (dangling.length > 0) {
      console.warn('[FlowBuilder] edges without a node (canvas desync):', dangling.map((e) => e.id));
    }
  }, [nodes, edges]);

  // Clear the stale rfInstance when navigating away so remount starts clean.
  useEffect(() => {
    return () => { setRfInstance(null); };
  }, [setRfInstance]);

  // Fit view ONCE, the first time ReactFlow has measured all nodes.
  // useNodesInitialized flips to true only after ResizeObserver has measured
  // every node — calling fitView earlier (the old setTimeout approach) computed
  // a bounding box from unmeasured nodes and left the viewport off-center.
  // We deliberately do NOT refit when the node count changes afterwards, so a
  // background SWR poll (or any data update) never overrides the user's manual
  // pan/zoom.
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (!nodesInitialized || computedNodes.length === 0) return;
    reactFlow.fitView({ padding: 0.12, maxZoom: 1 });
    didInitialFitRef.current = true;
  }, [computedNodes.length, nodesInitialized, reactFlow]);

  // Re-center nodes once their actual rendered heights are known. The first
  // paint uses NODE_H estimates; after ReactFlow measures each node, this
  // effect rewrites positions so the visual center of the node lands on the
  // cell center for its real height (matters for pair nodes with long names
  // wrapping to 3 lines, etc.).
  useEffect(() => {
    if (!nodesInitialized) return;
    if (isDraggingRef.current) return; // don't fight an in-progress drag
    setNodes((prev) => {
      const occupied = new Set<string>();
      let changed = false;
      const next = prev.map((n) => {
        const off = yCenteringOffset(nodeHeight(n));
        const col = Math.round((n.position.x - GRID_ORIGIN_X) / CELL_W);
        const row = Math.round((n.position.y - off - GRID_ORIGIN_Y) / CELL_H);
        let r = row;
        while (occupied.has(`${col}|${r}`)) r++;
        occupied.add(`${col}|${r}`);
        const newX = GRID_ORIGIN_X + col * CELL_W;
        const newY = GRID_ORIGIN_Y + r * CELL_H + off;
        if (Math.abs(n.position.x - newX) > 0.5 || Math.abs(n.position.y - newY) > 0.5) {
          changed = true;
          return { ...n, position: { x: newX, y: newY } };
        }
        return n;
      });
      return changed ? next : prev;
    });
  }, [nodesInitialized, nodes, setNodes]);

  // ─── Actions ─────────────────────────────────────────────

  async function handleAutomationAction(automationId: string, action: 'pause' | 'resume') {
    await updateAutomationStatus(automationId, action);
    mutate('/automations');
  }

  function handleAutomationSaved() {
    mutate('/automations');
    mutate('/connections');
    mutate('/workflows');
    mutate('/platforms');
  }

  const activeInstalledPlatforms = installedPlatforms.filter((p) => p.status === 'active');
  const showEmpty = !isLoading && connections.length === 0 && activeInstalledPlatforms.length === 0;
  const showNoAutomations = !isLoading && !showEmpty && automations.length === 0;

  const [supportOpen, setSupportOpen] = useState(false);

  const isMobile = window.innerWidth < 768;
  const safeBottomStyle = isMobile ? { marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 60px)' } : undefined;

  return (
    <div className="h-full relative" style={{ touchAction: 'none' }}>
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : showEmpty ? (
        <EmptyFlowState onAddAutomation={() => openSidebar()} hasPlatforms={false} />
      ) : showNoAutomations ? (
        <EmptyFlowState onAddAutomation={() => openSidebar()} hasPlatforms={true} />
      ) : (
        <ReactFlowErrorBoundary>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_event, node) => {
            const data = node.data as Record<string, unknown>;
            if (node.type === 'pair' && typeof data.onViewLogs === 'function') {
              (data.onViewLogs as () => void)();
            } else if (node.type === 'workflow' && typeof data.onViewInstances === 'function') {
              (data.onViewInstances as () => void)();
            }
          }}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          onInit={(instance) => setRfInstance(instance)}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            id="cells"
            variant={BackgroundVariant.Lines}
            gap={[CELL_W, CELL_H]}
            // ReactFlow's lines pattern draws each line at `gap/2` inside the
            // pattern tile and shifts the tile by `-offset`. So a line lands in
            // world space at `gap/2 - offset`. We want lines at the cell's
            // top-left corner (origin shifted by the padding), so:
            //   offset = gap/2 - (origin - pad)
            offset={[
              CELL_W / 2 - (GRID_ORIGIN_X - CELL_PAD_X),
              CELL_H / 2 - (GRID_ORIGIN_Y - CELL_PAD_TOP),
            ]}
            color="#e2e8f0"
            lineWidth={1}
          />
          <Background id="dots" gap={24} color="#f1f5f9" size={1} />
          <Controls showInteractive={false} style={safeBottomStyle} />
          <Panel position="top-right">
            <button
              onClick={() => openSidebar()}
              className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 shadow-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Automation
            </button>
          </Panel>

          {!tipDismissed && automations.length === 0 && connections.length > 0 && (
            <Panel position="bottom-right">
              <div className="bg-brand-600 text-white rounded-lg px-4 py-3 max-w-[280px] shadow-lg relative">
                <button
                  onClick={dismissTip}
                  className="absolute top-2 right-2 p-0.5 hover:bg-brand-500 rounded"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
                <p className="text-sm font-medium mb-1">Get started</p>
                <p className="text-xs text-brand-100">
                  Click "Add Automation" to create your first automation. Pick a platform event, choose a Maestro workflow, and Baton will connect them automatically.
                </p>
              </div>
            </Panel>
          )}

        </ReactFlow>
        </ReactFlowErrorBoundary>
      )}

      {/* Automation Sidebar */}
      <FlowSidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        editingAutomation={editingAutomation}
        onSaved={handleAutomationSaved}
      />

      {/* Per-workflow instances now open in the Activity Log (filtered to the
          workflow) — see openActivityLog(wf.id, wf.name) above and AppLayout. */}

      {/* Contact Support — desktop/tablet only */}
      <button
        onClick={() => setSupportOpen(true)}
        title="Contact Support"
        className="hidden md:flex items-center justify-center absolute bottom-6 right-6 z-10 w-[60px] h-[60px] bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-full shadow-md hover:shadow-lg transition-all"
      >
        <MessagesSquare className="w-7 h-7 text-gray-500" />
      </button>

      <ContactSupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />

      {/* Action Logs Sidebar */}
      <ActionLogsSidebar
        open={logsRuleId !== null}
        ruleId={logsRuleId}
        ruleName={logsRuleName}
        ruleStatus={automations.find((a) => a.id === logsRuleId)?.status ?? null}
        initialActionNumber={logsInitialActionNumber}
        onClose={closeLogs}
      />

    </div>
  );
}

type SupportModalState = { step: 'form' } | { step: 'success' } | { step: 'error'; message: string };

function ContactSupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useUser();
  const defaultEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<SupportModalState>({ step: 'form' });

  function handleClose() {
    onClose();
    setTimeout(() => { setTitle(''); setDescription(''); setEmail(defaultEmail); setState({ step: 'form' }); }, 300);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSending(true);
    try {
      await createSupportTicket({ title: title.trim(), description: description.trim(), email: email.trim() });
      setState({ step: 'success' });
    } catch (err: any) {
      setState({ step: 'error', message: err?.message || err?.error || 'Something went wrong. Please try again.' });
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full mx-4 md:mx-0 md:w-[440px] max-h-[90vh] overflow-y-auto z-10">

        {state.step === 'form' && (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Contact Support</h3>
                <p className="text-xs text-gray-400 mt-0.5">Describe the problem and we'll create a support ticket</p>
              </div>
              <button type="button" onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <XIcon className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  What can we help with? <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Workflow fails after contact lookup"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Your email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Additional details</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what you expected to happen and what happened instead..."
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
              <button type="button" onClick={handleClose} className="px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || sending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send to Support
              </button>
            </div>
          </form>
        )}

        {state.step === 'success' && (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Ticket Created</h3>
            <p className="text-sm text-gray-500 mt-1.5 max-w-[300px] mx-auto">
              Your support ticket has been submitted. Our team will review it shortly.
            </p>
            <div className="flex items-center justify-center mt-6">
              <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Close
              </button>
            </div>
          </div>
        )}

        {state.step === 'error' && (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Failed to Create Ticket</h3>
            <p className="text-sm text-gray-500 mt-1.5 max-w-[300px] mx-auto">{state.message}</p>
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setState({ step: 'form' })} className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors">
                Try Again
              </button>
              <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function EmptyFlowState({ onAddAutomation, hasPlatforms }: { onAddAutomation: () => void; hasPlatforms: boolean }) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50/50">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-6">
          <GitBranch className="w-10 h-10 text-brand-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {hasPlatforms ? 'Create Your First Automation' : 'Build Your First Flow'}
        </h2>
        <p className="text-sm text-gray-500 mb-8">
          {hasPlatforms
            ? 'Connect platform events to Maestro workflows with a single automation.'
            : 'Add a platform and create your first automation — all in one step.'}
        </p>
        <button
          onClick={onAddAutomation}
          className="px-8 py-3 bg-brand-600 text-white text-base font-medium rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-600/25 inline-flex items-center gap-2 transition-all hover:shadow-xl hover:shadow-brand-600/30"
        >
          <Plus className="w-5 h-5" /> Add New Automation
        </button>
      </div>
    </div>
  );
}

/**
 * Flow Builder Page — Baton
 *
 * Uses Zustand (flowStore) for UI state: sidebar, confirm modal, tip, fitView,
 * and the saved cell layout. ReactFlow nodes/edges are still local
 * (useNodesState) because they need ReactFlow's internal change-tracking.
 *
 * Layout model: the canvas is a fixed grid (see flowBuilderGrid). Every node
 * occupies one logical cell {col, row}; the server stores cells per node id and
 * writes are per-key, so devices never overwrite each other's layout. Pixel
 * positions are derived at render time with nodeOrigin=[0.5,0.5] — ReactFlow
 * centers each card in its cell whatever its measured size, so content and
 * font changes can never shift the layout.
 */
import { useMemo, useEffect, useCallback, useRef, useState, Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ViewportPortal,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type XYPosition,
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
  type FlowCell,
  type FlowPositions,
  type StoredFlowPosition,
} from '@/hooks/useApi';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/api';
import { PlatformNode, type PlatformNodeData } from '@/components/flows/PlatformNode';
import { PairNode, type PairNodeData } from '@/components/flows/PairNode';
import { WorkflowNode, type WorkflowNodeData } from '@/components/flows/WorkflowNode';
import { FlowSidebar } from '@/components/flows/FlowSidebar';
import { ActionLogsSidebar } from '@/components/flows/ActionLogsSidebar';
import { useFlowStore } from '@/stores/flowStore';
import { Plus, Loader2, GitBranch, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  CELL_W, CELL_H, GRID_LEFT, GRID_TOP, COL,
  type Cell, cellCenter, cellFromPoint, cellRect, cellKey, clampCell, toCell, findFreeRow, findNearestFreeRow,
} from './flowBuilderGrid';
import { reconcileNodes, findDanglingEdges } from './flowBuilderSync';

// ─── Node Types ──────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  platform: PlatformNode,
  pair: PairNode,
  workflow: WorkflowNode,
};

const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];
const EMPTY_ASSIGNMENTS: FlowPositions = {};

// Poll entries for a node the user saved in the last 15 s are ignored — a GET
// dispatched before our PATCH landed can resolve after it and would otherwise
// snap the node back to its stale position.
const RECENT_SAVE_GUARD_MS = 15_000;

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
    savedCells, setNodeCells,
    openActivityLog,
    logsRuleId, logsRuleName, logsInitialActionNumber, openLogs, closeLogs,
  } = useFlowStore();

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

  // ─── Cell Persistence ────────────────────────────────────

  // Cells the user moved locally that the server hasn't acknowledged yet.
  const dirtyCellsRef = useRef<Map<string, FlowCell>>(new Map());
  // Default placements queued as create-only pins (see saveFlowLayout).
  const pinCellsRef = useRef<Map<string, FlowCell>>(new Map());
  // Node id → time of its last acknowledged save (see RECENT_SAVE_GUARD_MS).
  const recentlySavedRef = useRef<Map<string, number>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInFlightRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const flushFailuresRef = useRef(0);
  // Legacy pixel entries are re-saved as cells once per session.
  const migratedLegacyRef = useRef(false);

  // Flush pending cells to the server. Only the queued keys are sent — the
  // server merges per key, so this can never clobber another device's moves.
  // Exactly one PATCH is in flight at a time: overlapping requests for the
  // same key could complete out of order and persist the older cell.
  const scheduleFlush = useCallback((delayMs: number) => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(async () => {
      flushTimerRef.current = null;
      if (flushInFlightRef.current) { scheduleFlush(300); return; }
      const moves = Object.fromEntries(dirtyCellsRef.current);
      const pins = Object.fromEntries(pinCellsRef.current);
      if (Object.keys(moves).length === 0 && Object.keys(pins).length === 0) return;
      flushInFlightRef.current = true;
      try {
        const request = saveFlowLayout(moves, pins);
        flushPromiseRef.current = request;
        await request;
        flushFailuresRef.current = 0;
        const now = Date.now();
        for (const [id, cell] of Object.entries(moves)) {
          recentlySavedRef.current.set(id, now);
          const pending = dirtyCellsRef.current.get(id);
          if (pending && pending.col === cell.col && pending.row === cell.row) {
            dirtyCellsRef.current.delete(id);
          }
        }
        for (const [id, cell] of Object.entries(pins)) {
          // No recently-saved guard for pins: the server may have kept another
          // device's cell (create-only write) and the poll should deliver it.
          const pending = pinCellsRef.current.get(id);
          if (pending && pending.col === cell.col && pending.row === cell.row) {
            pinCellsRef.current.delete(id);
          }
        }
        // A drag landed while the request was in flight — flush it too.
        if (dirtyCellsRef.current.size > 0 || pinCellsRef.current.size > 0) scheduleFlush(500);
      } catch {
        // Transient failure — retry with capped backoff instead of sticking
        // dirty forever (cells are clamped to server bounds, so a validation
        // reject can't poison the batch).
        flushFailuresRef.current += 1;
        scheduleFlush(Math.min(5_000 * 2 ** (flushFailuresRef.current - 1), 60_000));
      } finally {
        flushInFlightRef.current = false;
      }
    }, delayMs);
  }, []);

  // Every cell entering the queues is clamped here - the single choke point -
  // so no producer (drag, keyboard, pin, findFreeRow fallback) can ever queue
  // a cell the server's schema rejects and wedge the flush loop.
  const queueSave = useCallback((cells: FlowPositions) => {
    for (const [id, cell] of Object.entries(cells)) dirtyCellsRef.current.set(id, clampCell(cell));
    scheduleFlush(400);
  }, [scheduleFlush]);

  const queuePin = useCallback((cells: FlowPositions) => {
    for (const [id, cell] of Object.entries(cells)) pinCellsRef.current.set(id, clampCell(cell));
    scheduleFlush(400);
  }, [scheduleFlush]);

  // Flush whatever is pending when the page unmounts or the tab is hidden
  // (best-effort, no retry) — a drop right before closing must not be lost to
  // the 400 ms debounce.
  useEffect(() => {
    const flushNow = () => {
      const moves = Object.fromEntries(dirtyCellsRef.current);
      const pins = Object.fromEntries(pinCellsRef.current);
      if (Object.keys(moves).length === 0 && Object.keys(pins).length === 0) return;
      const send = () => { saveFlowLayout(moves, pins).catch(() => { /* best-effort */ }); };
      // Chain on any in-flight PATCH so an unmount flush can't complete out of
      // order with it and durably persist the older cell.
      const inFlight = flushInFlightRef.current ? flushPromiseRef.current : null;
      if (inFlight) void inFlight.then(send, send);
      else send();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushNow();
    };
  }, []);

  // Server layout — initial load + 10 s cross-device sync. Everything goes
  // through the store (single source of truth for positions); setNodeCells
  // no-ops when nothing changed, so a quiet poll causes zero re-renders.
  const { data: layoutData, error: layoutError } = useSWR<{ positions: Record<string, StoredFlowPosition> }>(
    '/flow-layout',
    fetcher,
    {
      refreshInterval: 10_000,
      revalidateOnFocus: true,
      onSuccess: (data) => {
        const raw = data?.positions ?? {};
        const now = Date.now();
        const incoming: FlowPositions = {};
        const legacy: FlowPositions = {};
        for (const [id, entry] of Object.entries(raw)) {
          const cell = toCell(entry);
          if (!cell) continue;
          // Locally-dirty or just-saved nodes win over anything the server
          // reports — including the legacy-migration re-save below, which must
          // never overwrite a fresh drag with the old converted position.
          if (dirtyCellsRef.current.has(id)) continue;
          const savedAt = recentlySavedRef.current.get(id);
          if (savedAt && now - savedAt < RECENT_SAVE_GUARD_MS) continue;
          if (entry && typeof (entry as { col?: number }).col !== 'number') legacy[id] = cell;
          incoming[id] = cell;
        }
        setNodeCells(incoming);
        // One-time migration: re-save legacy pixel entries in cell format.
        if (!migratedLegacyRef.current && Object.keys(legacy).length > 0) {
          migratedLegacyRef.current = true;
          queueSave(legacy);
        }
      },
    },
  );
  // First paint waits for the saved layout (one small request) so nodes never
  // render at defaults and then teleport when the layout arrives. A failed GET
  // falls back to defaults rather than blocking the canvas.
  const layoutReady = layoutData !== undefined || layoutError !== undefined;
  const isLoading = !connData || !automationsData || !wfData || !layoutReady;

  // ─── Build Graph ─────────────────────────────────────────

  const { computedNodes, computedEdges, defaultAssignments } = useMemo(() => {
    if (isLoading) return { computedNodes: EMPTY_NODES, computedEdges: EMPTY_EDGES, defaultAssignments: EMPTY_ASSIGNMENTS };

    // DocuSign is OAuth-only — no webhook source, hide from canvas
    // TODO: re-enable when DocuSign Connect/Navigator webhook support is added
    const OAUTH_ONLY_PLATFORMS = new Set(['docusign']);

    const referencedPlatforms = new Set(automations.map((r) => r.sourcePlatform));
    const referencedWorkflows = new Set(automations.map((r) => r.targetWorkflowId));

    const platformNodeMap = new Map<string, string>();
    const visibleConnections = connections.filter(
      (c) => !OAUTH_ONLY_PLATFORMS.has(c.platform) && (referencedPlatforms.has(c.platform) || c.status === 'healthy'),
    );
    for (const conn of visibleConnections) platformNodeMap.set(conn.platform, `platform-${conn.platform}`);
    // Active installed platforms (skip if already shown as connection)
    const visibleInstalled = installedPlatforms.filter(
      (p) => !OAUTH_ONLY_PLATFORMS.has(p.appSlug) && !platformNodeMap.has(p.appSlug) && p.status === 'active',
    );
    for (const p of visibleInstalled) platformNodeMap.set(p.appSlug, `platform-${p.appSlug}`);

    const visibleWorkflows = workflows.filter((wf) => referencedWorkflows.has(wf.id));
    const workflowNodeMap = new Map(visibleWorkflows.map((wf) => [wf.id, `workflow-${wf.id}`]));

    // ── Pass 1: give every node a grid cell ────────────────
    // Saved cells claim first, so a default can never displace an arranged
    // node. Unsaved nodes then fill the nearest free cell in their lane,
    // anchored to their platform's row — and those assignments are reported in
    // `defaultAssignments` so the page pins them to the server: a node keeps
    // its cell for life instead of re-deriving it from volatile list order.
    const occupied = new Set<string>();
    const cells = new Map<string, Cell>();
    const defaults: FlowPositions = {};

    const platformIds = [...platformNodeMap.values()];
    const allIds = [
      ...platformIds,
      ...automations.map((a) => `pair-${a.id}`),
      ...visibleWorkflows.map((wf) => `workflow-${wf.id}`),
    ];
    for (const id of allIds) {
      const saved = savedCells[id];
      if (!saved) continue;
      if (occupied.has(cellKey(saved))) {
        // Two nodes saved into the same cell (concurrent writes) — render the
        // later one below without overwriting either node's saved cell.
        const row = findFreeRow(occupied, saved.col, saved.row);
        cells.set(id, { col: saved.col, row });
        occupied.add(cellKey({ col: saved.col, row }));
      } else {
        cells.set(id, saved);
        occupied.add(cellKey(saved));
      }
    }

    const assignDefault = (id: string, col: number, preferredRow: number, nearest = false) => {
      if (cells.has(id)) return;
      const row = nearest
        ? findNearestFreeRow(occupied, col, preferredRow)
        : findFreeRow(occupied, col, preferredRow);
      const cell = { col, row };
      cells.set(id, cell);
      occupied.add(cellKey(cell));
      defaults[id] = cell;
    };

    for (const id of platformIds) assignDefault(id, COL.platforms, 0);

    const platformRowOf = (slug: string | undefined): number => {
      const nodeId = slug ? platformNodeMap.get(slug) : undefined;
      const cell = nodeId ? cells.get(nodeId) : undefined;
      return cell ? cell.row : 0;
    };
    for (const a of automations) assignDefault(`pair-${a.id}`, COL.pairs, platformRowOf(a.appSlug || a.sourcePlatform), true);

    // Workflows align with the first automation that feeds them.
    const firstSourceRow = new Map<string, number>();
    for (const a of automations) {
      const r = cells.get(`pair-${a.id}`)?.row;
      if (r !== undefined && !firstSourceRow.has(a.targetWorkflowId)) firstSourceRow.set(a.targetWorkflowId, r);
    }
    for (const wf of visibleWorkflows) assignDefault(`workflow-${wf.id}`, COL.workflows, firstSourceRow.get(wf.id) ?? 0, true);

    // ── Pass 2: build nodes and edges ──────────────────────

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const positionOf = (id: string) => cellCenter(cells.get(id)!);

    visibleConnections.forEach((conn) => {
      const nodeId = platformNodeMap.get(conn.platform)!;
      const platformAutomations = automations.filter((r) => r.sourcePlatform === conn.platform && !r.appSlug);
      nodes.push({
        id: nodeId,
        type: 'platform',
        position: positionOf(nodeId),
        data: {
          platform: conn.platform,
          displayName: conn.displayName,
          status: conn.status,
          automationsCount: platformAutomations.length,
          totalActionsThisMonth: platformAutomations.reduce((sum, r) => sum + r.timesTriggered, 0),
          onAddClick: () => openSidebar(null, conn.platform),
        } satisfies PlatformNodeData,
      });
    });

    visibleInstalled.forEach((platform) => {
      const nodeId = platformNodeMap.get(platform.appSlug)!;
      const platformAutomations = automations.filter((r) => r.appSlug === platform.appSlug);
      nodes.push({
        id: nodeId,
        type: 'platform',
        position: positionOf(nodeId),
        data: {
          platform: platform.appSlug,
          displayName: platform.displayName,
          status: 'healthy' as const,
          automationsCount: platformAutomations.length,
          totalActionsThisMonth: platformAutomations.reduce((sum, r) => sum + r.timesTriggered, 0),
          onAddClick: () => openSidebar(null, platform.appSlug),
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

    visibleWorkflows.forEach((wf) => {
      const nodeId = workflowNodeMap.get(wf.id)!;
      nodes.push({
        id: nodeId,
        type: 'workflow',
        position: positionOf(nodeId),
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

    automations.forEach((automation) => {
      const nodeId = `pair-${automation.id}`;
      const wf = workflows.find((w) => w.id === automation.targetWorkflowId);
      const eventLabel = automation.eventType.replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      nodes.push({
        id: nodeId,
        type: 'pair',
        position: positionOf(nodeId),
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

    return { computedNodes: nodes, computedEdges: edges, defaultAssignments: defaults };
  }, [connections, automations, workflows, installedPlatforms, isLoading, statusCounts, savedCells]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── ReactFlow State ─────────────────────────────────────

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  // Nodes currently being dragged — reconcile leaves their positions alone.
  const draggingIdsRef = useRef<Set<string>>(new Set());
  // Position of each dragged node at drag-start, for the occupied-cell revert.
  const dragStartPosRef = useRef<Map<string, XYPosition>>(new Map());
  // Cell under the dragged node, highlighted as the drop target.
  const [dropTarget, setDropTarget] = useState<{ cell: Cell; valid: boolean } | null>(null);

  // Node/edge reconciliation lives in ./flowBuilderSync (pure, unit-tested).
  //
  // `computedNodes` and `computedEdges` come from one useMemo, so they always
  // describe the same snapshot — whenever edges advance to a new snapshot,
  // nodes must advance to it too (otherwise arrows point at missing bubbles).
  // Positions are store-driven: reconcile adopts the computed cell centers,
  // preserving only measurements/selection and any in-flight drag.
  const lastSyncedNodesRef = useRef(computedNodes);
  useEffect(() => {
    const prevSynced = lastSyncedNodesRef.current;
    lastSyncedNodesRef.current = computedNodes;
    // Keyboard-moved nodes awaiting their commit are protected like drags —
    // a data poll mid-move must not snap them back.
    const inFlight = new Set([...draggingIdsRef.current, ...keyboardMovedIdsRef.current]);
    setNodes((prev) => reconcileNodes(prev, computedNodes, prevSynced, inFlight));
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  // Pin freshly-assigned default cells: store first (so the next render treats
  // them as saved), then persist per-key. Without this, unsaved nodes would
  // re-derive their row from list order and shift when platforms or
  // automations come and go. Never pins while the layout GET hasn't succeeded —
  // a transient error must not overwrite the org's saved layout with defaults.
  useEffect(() => {
    if (layoutData === undefined) return;
    if (Object.keys(defaultAssignments).length === 0) return;
    setNodeCells(defaultAssignments);
    queuePin(defaultAssignments);
  }, [defaultAssignments, layoutData, setNodeCells, queuePin]);

  // Dev-only guard: surfaces node/edge snapshot desync (dangling arrows) so a
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
  // every node — calling fitView earlier computed a bounding box from
  // unmeasured nodes and left the viewport off-center. We deliberately do NOT
  // refit afterwards, so background polls never override manual pan/zoom.
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current) return;
    if (!nodesInitialized || computedNodes.length === 0) return;
    reactFlow.fitView({ padding: 0.12, maxZoom: 1 });
    didInitialFitRef.current = true;
  }, [computedNodes.length, nodesInitialized, reactFlow]);

  // ─── Drag Handling ───────────────────────────────────────
  // Free-form drag with a live drop-target highlight; on drop the node snaps
  // to the hovered cell (or reverts if that cell is taken) and the cell is
  // queued for a per-key server save.

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node | undefined, draggedNodes: Node[]) => {
    const group = (draggedNodes?.length ? draggedNodes : [node]).filter((n): n is Node => !!n);
    draggingIdsRef.current = new Set(group.map((n) => n.id));
    for (const n of group) {
      dragStartPosRef.current.set(n.id, n.position);
      // Grabbing a node cancels its pending keyboard-move commit - otherwise
      // the timer could fire mid-drag and persist a cell the pointer merely
      // passed over. The drag's own drop logic takes over from here.
      keyboardMovedIdsRef.current.delete(n.id);
    }
    if (keyboardMovedIdsRef.current.size === 0 && keyboardTimerRef.current) {
      clearTimeout(keyboardTimerRef.current);
      keyboardTimerRef.current = null;
    }
  }, []);

  const onNodeDrag = useCallback((_e: React.MouseEvent, node: Node | undefined) => {
    if (!node) return;
    const cell = cellFromPoint(node.position);
    const key = cellKey(cell);
    const taken = nodes.some((n) => !draggingIdsRef.current.has(n.id) && cellKey(cellFromPoint(n.position)) === key);
    setDropTarget((prev) =>
      prev && prev.cell.col === cell.col && prev.cell.row === cell.row && prev.valid === !taken
        ? prev
        : { cell, valid: !taken },
    );
  }, [nodes]);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node | undefined, draggedNodes: Node[]) => {
      const group = (draggedNodes?.length ? draggedNodes : [node]).filter((n): n is Node => !!n);
      draggingIdsRef.current = new Set();
      setDropTarget(null);

      const groupIds = new Set(group.map((n) => n.id));
      const occupied = new Set(
        nodes.filter((n) => !groupIds.has(n.id)).map((n) => cellKey(cellFromPoint(n.position))),
      );

      const finalPos = new Map<string, XYPosition>();
      const updates: FlowPositions = {};
      let blocked = false;

      for (const n of group) {
        const start = dragStartPosRef.current.get(n.id) ?? n.position;
        dragStartPosRef.current.delete(n.id);
        const startCell = cellFromPoint(start);
        const target = clampCell(cellFromPoint(n.position));
        const moved = target.col !== startCell.col || target.row !== startCell.row;
        const free = !occupied.has(cellKey(target));
        if (moved && !free) blocked = true;
        let cell: Cell;
        if (moved && free) {
          cell = target;
        } else if (occupied.has(cellKey(startCell))) {
          // Reverting, but another group member just claimed our start cell —
          // fall to the nearest free row instead of stacking two nodes.
          cell = { col: startCell.col, row: findFreeRow(occupied, startCell.col, startCell.row) };
        } else {
          cell = startCell;
        }
        occupied.add(cellKey(cell));
        finalPos.set(n.id, cellCenter(cell));
        if (cell.col !== startCell.col || cell.row !== startCell.row) updates[n.id] = cell;
      }

      setNodes((prev) => prev.map((n) => (finalPos.has(n.id) ? { ...n, position: finalPos.get(n.id)! } : n)));
      if (blocked) toast.info('That cell is taken', { description: 'Drop the bubble on a free cell' });
      if (Object.keys(updates).length > 0) {
        setNodeCells(updates);
        queueSave(updates);
      }
    },
    [nodes, setNodes, setNodeCells, queueSave],
  );

  // ── Keyboard moves ───────────────────────────────────────
  // ReactFlow moves selected nodes with arrow keys through onNodesChange
  // without firing the drag handlers. Those moves would otherwise live only in
  // ReactFlow state and snap back on the next data poll — so after the arrows
  // go quiet, commit the node to the cell it landed on (or revert it).
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const keyboardMovedIdsRef = useRef<Set<string>>(new Set());
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitKeyboardMoves = useCallback(() => {
    keyboardTimerRef.current = null;
    const ids = keyboardMovedIdsRef.current;
    if (ids.size === 0) return;
    keyboardMovedIdsRef.current = new Set();

    const current = nodesRef.current;
    const occupied = new Set(
      current.filter((n) => !ids.has(n.id)).map((n) => cellKey(cellFromPoint(n.position))),
    );
    const savedNow = useFlowStore.getState().savedCells;
    const finalPos = new Map<string, XYPosition>();
    const updates: FlowPositions = {};

    for (const n of current) {
      if (!ids.has(n.id) || draggingIdsRef.current.has(n.id)) continue;
      const target = clampCell(cellFromPoint(n.position));
      const saved = savedNow[n.id];
      const startCell = saved ?? target;
      const cell = !occupied.has(cellKey(target))
        ? target
        : { col: startCell.col, row: findFreeRow(occupied, startCell.col, startCell.row) };
      occupied.add(cellKey(cell));
      finalPos.set(n.id, cellCenter(cell));
      if (!saved || saved.col !== cell.col || saved.row !== cell.row) updates[n.id] = cell;
    }

    if (finalPos.size > 0) {
      setNodes((prev) => prev.map((n) => (finalPos.has(n.id) ? { ...n, position: finalPos.get(n.id)! } : n)));
    }
    if (Object.keys(updates).length > 0) {
      setNodeCells(updates);
      queueSave(updates);
    }
  }, [setNodes, setNodeCells, queueSave]);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    let sawKeyboardMove = false;
    for (const c of changes) {
      if (c.type === 'position' && !c.dragging && c.position && !draggingIdsRef.current.has(c.id)) {
        keyboardMovedIdsRef.current.add(c.id);
        sawKeyboardMove = true;
      }
    }
    if (sawKeyboardMove) {
      if (keyboardTimerRef.current) clearTimeout(keyboardTimerRef.current);
      keyboardTimerRef.current = setTimeout(commitKeyboardMoves, 600);
    }
  }, [onNodesChange, commitKeyboardMoves]);

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

  const isMobile = window.innerWidth < 768;
  const safeBottomStyle = isMobile ? { marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 60px)' } : undefined;

  const dropRect = dropTarget ? cellRect(dropTarget.cell) : null;

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
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
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
          nodeOrigin={[0.5, 0.5]}
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
            // world space at `gap/2 - offset`. We want lines exactly on the
            // cell borders, whose origin is (GRID_LEFT, GRID_TOP):
            //   offset = gap/2 - origin
            offset={[CELL_W / 2 - GRID_LEFT, CELL_H / 2 - GRID_TOP]}
            color="#e2e8f0"
            lineWidth={1}
          />
          <Background id="dots" gap={24} color="#f1f5f9" size={1} />
          <Controls showInteractive={false} style={safeBottomStyle} />

          {/* Drop-target highlight while dragging */}
          {dropRect && (
            <ViewportPortal>
              <div
                style={{
                  position: 'absolute',
                  transform: `translate(${dropRect.x}px, ${dropRect.y}px)`,
                  width: dropRect.width,
                  height: dropRect.height,
                }}
                className={`pointer-events-none rounded-2xl border-2 ${
                  dropTarget!.valid ? 'border-brand-400/80 bg-brand-100/20' : 'border-red-300/80 bg-red-50/40'
                }`}
              />
            </ViewportPortal>
          )}

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
                  Click "Add Automation" to create your first automation. Pick a platform event, choose a Docusign workflow, and Baton will connect them automatically.
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

      {/* Bulk Upload lives on its own page (/bulk-upload) - it is manual,
          platform-agnostic, and tracks rows, none of which fits the canvas. */}

      {/* Per-workflow instances now open in the Activity Log (filtered to the
          workflow) — see openActivityLog(wf.id, wf.name) above and AppLayout. */}

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
            ? 'Connect platform events to Docusign workflows with a single automation.'
            : 'Add a platform and create your first automation - all in one step.'}
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

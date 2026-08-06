/**
 * Flow Builder - node/edge state reconciliation (pure, React-free).
 *
 * The canvas keeps ReactFlow's node/edge state in sync with the `computedNodes`
 * / `computedEdges` derived from server data + the saved cell layout. Both are
 * produced by a single useMemo, so they always describe the SAME snapshot. The
 * rule that keeps arrows (edges) and bubbles (nodes) from desyncing: whenever
 * edges advance to a new snapshot, nodes must advance to that same snapshot.
 *
 * Positions are store-driven: `computedNodes` already carry the exact cell
 * center every node should render at, so reconciliation ADOPTS computed
 * positions. The only exception is a node the user is dragging right now -
 * that one keeps its live pointer position until drag-stop commits a cell.
 *
 * ReactFlow's `measured` dimensions (and selection) are carried over from the
 * previous state so adopting a snapshot never forces a re-measure - dropping
 * them made nodes briefly render with estimated sizes on every data poll,
 * which was a major source of canvas jitter.
 */

export interface SyncNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  selected?: boolean;
  [key: string]: unknown;
}

export interface SyncEdge {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

/**
 * Reconcile the live node array against the latest computed snapshot.
 *
 * - `prev` - nodes currently in ReactFlow state (carry measurements/selection).
 * - `computedNodes` - the latest snapshot built from server data + saved cells.
 * - `prevSyncedNodes` - the `computedNodes` reference already reflected in `prev`.
 * - `draggingIds` - nodes mid-drag; their live positions are preserved.
 *
 * When the snapshot hasn't changed (`computedNodes === prevSyncedNodes`) we
 * return `prev` unchanged (same reference) so ReactFlow doesn't reset
 * measurements or an in-flight drag.
 */
export function reconcileNodes<N extends SyncNode>(
  prev: N[],
  computedNodes: N[],
  prevSyncedNodes: N[],
  draggingIds?: ReadonlySet<string>,
): N[] {
  if (computedNodes === prevSyncedNodes) return prev;
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return computedNodes.map((n) => {
    const p = prevById.get(n.id);
    if (!p) return n;
    return {
      ...n,
      ...(p.measured ? { measured: p.measured } : null),
      ...(p.selected !== undefined ? { selected: p.selected } : null),
      position: draggingIds?.has(n.id) ? p.position : n.position,
    };
  });
}

/**
 * Edges whose source or target node is missing from `nodes` - i.e. arrows that
 * would render pointing at nothing, or not render at all.
 *
 * `reconcileNodes` guarantees this is always empty in production (nodes and edges
 * are kept on the same snapshot); it's the invariant the regression tests assert,
 * and a cheap dev-time guard on the canvas.
 */
export function findDanglingEdges<N extends SyncNode, E extends SyncEdge>(
  nodes: N[],
  edges: E[],
): E[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
}

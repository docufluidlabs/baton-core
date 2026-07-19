/**
 * Flow Builder — node/edge state reconciliation (pure, React-free).
 *
 * The canvas keeps ReactFlow's node/edge state in sync with the `computedNodes`
 * / `computedEdges` derived from server data. Both are produced by a single
 * useMemo, so they always describe the SAME snapshot. The rule that keeps arrows
 * (edges) and bubbles (nodes) from desyncing: whenever edges advance to a new
 * snapshot, nodes must advance to that same snapshot.
 *
 * These helpers encode that rule so it can be unit-tested without React /
 * ReactFlow — same approach as ./flowBuilderGrid.ts.
 */

export interface SyncNode {
  id: string;
  position: { x: number; y: number };
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
 * - `prev` — nodes currently in ReactFlow state (may carry user-dragged positions).
 * - `computedNodes` — the latest snapshot built from server data.
 * - `prevSyncedNodes` — the `computedNodes` reference already reflected in `prev`.
 *
 * When the snapshot hasn't changed (`computedNodes === prevSyncedNodes`) we return
 * `prev` unchanged (same reference) so ReactFlow doesn't reset measurements or an
 * in-flight drag. Otherwise we adopt the new snapshot, preserving the live
 * position of any node that survived — so a background data poll never snaps a
 * dragged bubble back, but added/removed nodes are reflected immediately (which
 * keeps the node set consistent with `computedEdges` from the same snapshot).
 */
export function reconcileNodes<N extends SyncNode>(
  prev: N[],
  computedNodes: N[],
  prevSyncedNodes: N[],
): N[] {
  if (computedNodes === prevSyncedNodes) return prev;
  const prevPositions = new Map(prev.map((n) => [n.id, n.position]));
  return computedNodes.map((n) => ({
    ...n,
    position: prevPositions.get(n.id) ?? n.position,
  }));
}

/**
 * Edges whose source or target node is missing from `nodes` — i.e. arrows that
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

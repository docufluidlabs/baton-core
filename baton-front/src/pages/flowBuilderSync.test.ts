/**
 * flowBuilderSync — unit tests
 *
 * Guards the canvas "disappearing arrows / bubbles" regression: the node and
 * edge state must always come from the SAME computed snapshot, so an edge can
 * never reference a node that isn't in the node set.
 *
 *  - reconcileNodes    — warm-mount no-op, snapshot advance, position preservation,
 *                        add/remove of nodes
 *  - findDanglingEdges — invariant checker used by the regression cases below
 */
import { describe, it, expect } from 'vitest';
import { reconcileNodes, findDanglingEdges, type SyncNode, type SyncEdge } from './flowBuilderSync';

const node = (id: string, x = 0, y = 0): SyncNode => ({ id, position: { x, y } });
const edge = (source: string, target: string): SyncEdge => ({ id: `${source}->${target}`, source, target });

describe('reconcileNodes', () => {
  it('returns prev UNCHANGED (same reference) when the snapshot has not changed', () => {
    const snapshot = [node('a'), node('b')];
    const prev = [node('a', 50, 50), node('b')]; // 'a' was dragged
    // computedNodes === prevSyncedNodes → warm-mount no-op, keep live state intact
    expect(reconcileNodes(prev, snapshot, snapshot)).toBe(prev);
  });

  it('adopts the new snapshot when it advances', () => {
    const v1 = [node('a'), node('b')];
    const v2 = [node('a'), node('b'), node('c')];
    const result = reconcileNodes(v1, v2, v1);
    expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves the live position of a node that survived the snapshot change', () => {
    const prev = [node('a', 999, 123)]; // user dragged 'a' here
    const v2 = [node('a', 0, 0), node('b', 10, 10)]; // server still reports default for 'a'
    const result = reconcileNodes(prev, v2, [node('a', 0, 0)]);
    expect(result.find((n) => n.id === 'a')!.position).toEqual({ x: 999, y: 123 });
    // brand-new node uses its computed position
    expect(result.find((n) => n.id === 'b')!.position).toEqual({ x: 10, y: 10 });
  });

  it('drops a node that was removed from the snapshot (no stale bubble)', () => {
    const v1 = [node('a'), node('b'), node('c')];
    const v2 = [node('a'), node('b')];
    const result = reconcileNodes(v1, v2, v1);
    expect(result.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('findDanglingEdges', () => {
  it('flags an edge whose target node is missing', () => {
    const nodes = [node('a'), node('b')];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    expect(findDanglingEdges(nodes, edges).map((e) => e.id)).toEqual(['b->c']);
  });

  it('returns nothing when every edge endpoint exists', () => {
    const nodes = [node('a'), node('b'), node('c')];
    expect(findDanglingEdges(nodes, [edge('a', 'b'), edge('b', 'c')])).toEqual([]);
  });
});

describe('regression: nodes and edges never desync', () => {
  // The bug: a snapshot advanced from v1 → v2 between the render that seeded the
  // node state and the sync. The old code synced edges to v2 but left nodes on v1.
  it('a NEW automation (v1→v2) keeps arrows attached to a present bubble', () => {
    const v1Nodes = [node('platform'), node('pair')];
    const v2Nodes = [node('platform'), node('pair'), node('workflow')];
    const v2Edges = [edge('platform', 'pair'), edge('pair', 'workflow')];

    // Old behaviour (skip-branch): nodes stay on the seeded v1, edges jump to v2.
    expect(findDanglingEdges(v1Nodes, v2Edges).map((e) => e.id)).toEqual(['pair->workflow']);

    // Fixed: reconcileNodes advances nodes to v2, so no edge is left dangling.
    const reconciled = reconcileNodes(v1Nodes, v2Nodes, v1Nodes);
    expect(findDanglingEdges(reconciled, v2Edges)).toEqual([]);
  });

  it('a DELETED automation (v1→v2) leaves no stale bubble behind', () => {
    const v1Nodes = [node('platform'), node('pair'), node('workflow')];
    const v2Nodes = [node('platform'), node('pair')];
    const v2Edges = [edge('platform', 'pair')];

    // Old behaviour: the removed 'workflow' bubble would linger in node state.
    expect(v1Nodes.some((n) => n.id === 'workflow')).toBe(true);

    // Fixed: reconcile drops it and edges remain consistent.
    const reconciled = reconcileNodes(v1Nodes, v2Nodes, v1Nodes);
    expect(reconciled.some((n) => n.id === 'workflow')).toBe(false);
    expect(findDanglingEdges(reconciled, v2Edges)).toEqual([]);
  });

  it('holds the invariant across a chain of snapshot advances', () => {
    const snapshots: { nodes: SyncNode[]; edges: SyncEdge[] }[] = [
      { nodes: [node('p')], edges: [] },
      { nodes: [node('p'), node('r')], edges: [edge('p', 'r')] },
      { nodes: [node('p'), node('r'), node('w')], edges: [edge('p', 'r'), edge('r', 'w')] },
      { nodes: [node('p'), node('w')], edges: [] }, // 'r' removed → its edges removed too
    ];

    let liveNodes: SyncNode[] = [];
    let synced: SyncNode[] = liveNodes;
    for (const snap of snapshots) {
      liveNodes = reconcileNodes(liveNodes, snap.nodes, synced);
      synced = snap.nodes;
      // edges always come from the same snapshot we just synced nodes to
      expect(findDanglingEdges(liveNodes, snap.edges)).toEqual([]);
    }
  });
});

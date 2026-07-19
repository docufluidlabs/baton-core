/**
 * Flow builder canvas grid — pure geometry helpers.
 *
 * The canvas is divided into fixed cells; every node occupies exactly one cell.
 * These helpers snap free-form positions onto the grid, center nodes vertically
 * inside their cell, and resolve collisions. They are intentionally free of any
 * React/ReactFlow dependency so they can be unit-tested in isolation.
 */

// ─── Layout Constants ────────────────────────────────────────

export const COL_X = { platforms: 50, pairs: 370, workflows: 690 };
export const ROW_GAP = 210;
export const START_Y = 50;

// ─── Grid ────────────────────────────────────────────────────
// Grid origin lines up with the initial layout column/row anchors so brand-new
// nodes already start on grid.

export const CELL_W = 320;
export const CELL_H = ROW_GAP;
export const GRID_ORIGIN_X = COL_X.platforms; // 50
export const GRID_ORIGIN_Y = START_Y;         // 50
// Visual cell lines are shifted so each node (240px wide, up to ~220px tall)
// sits centered horizontally inside its cell with breathing room on top/bottom.
// Snap origin stays at (GRID_ORIGIN_X, GRID_ORIGIN_Y) — only the lines move.
export const NODE_W = 240;
export const CELL_PAD_X = (CELL_W - NODE_W) / 2; // 40
export const CELL_PAD_TOP = 10;

// Fallback heights per node type for the first paint, before ReactFlow has
// measured anything. After mount, `node.measured.height` is used instead so
// nodes with longer wrapped content (e.g. a pair card with a 3-line name) are
// centered using their actual height, not the default estimate.
export const NODE_H: Record<string, number> = {
  platform: 70,
  pair: 160,
  workflow: 220,
};

/** Minimal shape `normalizePositions` needs — ReactFlow's `Node` satisfies it. */
export interface GridNode {
  type?: string;
  position: { x: number; y: number };
  measured?: { height?: number };
}

export function nodeHeight(n: { type?: string; measured?: { height?: number } }): number {
  const m = n.measured?.height;
  if (typeof m === 'number' && m > 0) return m;
  return NODE_H[n.type ?? ''] ?? 0;
}

export function yCenteringOffset(h: number): number {
  return (CELL_H - h) / 2 - CELL_PAD_TOP;
}

export function snapToCell(pos: { x: number; y: number }) {
  const col = Math.round((pos.x - GRID_ORIGIN_X) / CELL_W);
  const row = Math.round((pos.y - GRID_ORIGIN_Y) / CELL_H);
  return {
    col,
    row,
    x: GRID_ORIGIN_X + col * CELL_W,
    y: GRID_ORIGIN_Y + row * CELL_H,
  };
}

// Snap every node onto the grid, resolving collisions by pushing conflicts
// down to the next free row in the same column. The visual position is the
// snap anchor plus a per-type Y offset so each node sits vertically centered
// inside its cell. Idempotent for already-centered visuals.
export function normalizePositions<T extends GridNode>(nodes: T[]): T[] {
  const occupied = new Set<string>();
  return nodes.map((n) => {
    const off = yCenteringOffset(nodeHeight(n));
    // Convert current visual position back to its grid anchor before snapping
    // so legacy (non-centered) saved positions migrate cleanly.
    const anchor = { x: n.position.x, y: n.position.y - off };
    const s = snapToCell(anchor);
    let row = s.row;
    while (occupied.has(`${s.col}|${row}`)) row++;
    occupied.add(`${s.col}|${row}`);
    return {
      ...n,
      position: {
        x: GRID_ORIGIN_X + s.col * CELL_W,
        y: GRID_ORIGIN_Y + row * CELL_H + off,
      },
    };
  });
}

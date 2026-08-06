/**
 * Flow builder canvas grid - pure geometry helpers.
 *
 * The canvas is a fixed grid of cells; every node occupies exactly one cell,
 * identified by an integer {col, row}. The canvas renders with
 * nodeOrigin=[0.5, 0.5], so a node's ReactFlow position is the CENTER of its
 * cell and ReactFlow centers the card there whatever its measured size is.
 * Persisted layout is {col, row} per node id - no pixels, so a saved layout is
 * independent of device, font wrapping, and card content.
 *
 * These helpers are intentionally free of any React/ReactFlow dependency so
 * they can be unit-tested in isolation.
 */

// ─── Layout Constants ────────────────────────────────────────

export const CELL_W = 320;
export const CELL_H = 210;

/** Column index of each lane. Users may drag nodes to other columns freely. */
export const COL = { platforms: 0, pairs: 1, workflows: 2 } as const;

// Top-left corner of cell (0,0) in flow coordinates. Matches the visual grid
// drawn by the <Background> lines pattern so nodes sit inside the lines.
export const GRID_LEFT = 10;
export const GRID_TOP = 40;

export interface Cell {
  col: number;
  row: number;
}

// ─── Cell Geometry ───────────────────────────────────────────

/** Flow-coordinate center of a cell - what node.position holds (nodeOrigin 0.5). */
export function cellCenter(cell: Cell): { x: number; y: number } {
  return {
    x: GRID_LEFT + (cell.col + 0.5) * CELL_W,
    y: GRID_TOP + (cell.row + 0.5) * CELL_H,
  };
}

/** Nearest cell to a flow-coordinate point (a node center, e.g. mid-drag). */
export function cellFromPoint(pos: { x: number; y: number }): Cell {
  return {
    col: Math.round((pos.x - GRID_LEFT) / CELL_W - 0.5),
    row: Math.round((pos.y - GRID_TOP) / CELL_H - 0.5),
  };
}

/** Top-left rect of a cell in flow coordinates - for drop-target highlights. */
export function cellRect(cell: Cell): { x: number; y: number; width: number; height: number } {
  return {
    x: GRID_LEFT + cell.col * CELL_W,
    y: GRID_TOP + cell.row * CELL_H,
    width: CELL_W,
    height: CELL_H,
  };
}

export const cellKey = (c: Cell): string => `${c.col}|${c.row}`;

// Mirror of the server's accepted bounds (flow-layout.ts zod schema). Clamping
// at the source means a runaway drag can never produce a cell the server
// rejects - one bad entry would 400 the whole batch and poison every retry.
export function clampCell(c: Cell): Cell {
  return {
    col: Math.max(-1000, Math.min(1000, c.col)),
    row: Math.max(-1000, Math.min(10_000, c.row)),
  };
}

// ─── Persistence Compatibility ───────────────────────────────

// Layouts saved before the cells refactor stored the node's top-left pixel
// position anchored at (50, 50), with a height-dependent centering offset baked
// into y. The offset never exceeded half a cell, so rounding recovers the cell.
const LEGACY_ORIGIN_X = 50;
const LEGACY_ORIGIN_Y = 50;

/** Normalize a stored layout entry ({col,row} or legacy {x,y} pixels) to a cell. */
export function toCell(entry: { col?: number; row?: number; x?: number; y?: number } | null | undefined): Cell | null {
  if (!entry) return null;
  if (typeof entry.col === 'number' && typeof entry.row === 'number' && Number.isFinite(entry.col) && Number.isFinite(entry.row)) {
    return clampCell({ col: Math.round(entry.col), row: Math.round(entry.row) });
  }
  if (typeof entry.x === 'number' && typeof entry.y === 'number' && Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
    return clampCell({
      col: Math.round((entry.x - LEGACY_ORIGIN_X) / CELL_W),
      row: Math.round((entry.y - LEGACY_ORIGIN_Y) / CELL_H),
    });
  }
  return null;
}

// ─── Placement ───────────────────────────────────────────────

/**
 * First free row in `col` at or below `startRow`, scanning downward. Negative
 * rows are legitimate (users drag nodes above the origin and their saved rows
 * must be respected), so no clamping.
 */
export function findFreeRow(occupied: ReadonlySet<string>, col: number, startRow: number): number {
  let row = Math.round(startRow);
  while (occupied.has(cellKey({ col, row }))) row++;
  return row;
}

/**
 * Free row in `col` closest to `startRow`, searching outward in both
 * directions (preferring below on ties). Used for placing new nodes next to
 * their platform - scanning only downward would push them past a dense block
 * of neighbors even when the cell just above is free.
 */
export function findNearestFreeRow(occupied: ReadonlySet<string>, col: number, startRow: number): number {
  const start = Math.round(startRow);
  for (let d = 0; ; d++) {
    if (!occupied.has(cellKey({ col, row: start + d }))) return start + d;
    if (d > 0 && !occupied.has(cellKey({ col, row: start - d }))) return start - d;
  }
}

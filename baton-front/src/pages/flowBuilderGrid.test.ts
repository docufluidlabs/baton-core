/**
 * flowBuilderGrid — unit tests
 *
 * The grid is cell-based: every node occupies one logical {col, row} and its
 * ReactFlow position is the cell CENTER (the canvas renders with
 * nodeOrigin=[0.5,0.5]).
 *
 *  - cellCenter / cellFromPoint — center-of-cell geometry and its inverse
 *  - cellRect                   — drop-target highlight rect
 *  - toCell                     — stored-entry normalization incl. legacy {x,y}
 *  - findFreeRow                — collision-free default placement
 */
import { describe, it, expect } from 'vitest';
import {
  CELL_W, CELL_H, GRID_LEFT, GRID_TOP, COL,
  cellCenter, cellFromPoint, cellRect, cellKey, clampCell, toCell, findFreeRow, findNearestFreeRow,
} from './flowBuilderGrid';

// ─── cellCenter / cellFromPoint ──────────────────────────────

describe('cellCenter', () => {
  it('places cell (0,0) at the center of the first cell', () => {
    expect(cellCenter({ col: 0, row: 0 })).toEqual({
      x: GRID_LEFT + CELL_W / 2,
      y: GRID_TOP + CELL_H / 2,
    });
  });

  it('advances one cell size per col/row', () => {
    const a = cellCenter({ col: 1, row: 2 });
    const b = cellCenter({ col: 2, row: 3 });
    expect(b.x - a.x).toBe(CELL_W);
    expect(b.y - a.y).toBe(CELL_H);
  });
});

describe('cellFromPoint', () => {
  it('is the inverse of cellCenter for any cell', () => {
    for (const cell of [{ col: 0, row: 0 }, { col: 2, row: 5 }, { col: -1, row: -2 }]) {
      expect(cellFromPoint(cellCenter(cell))).toEqual(cell);
    }
  });

  it('maps any point inside a cell to that cell', () => {
    const center = cellCenter({ col: 1, row: 1 });
    expect(cellFromPoint({ x: center.x - CELL_W * 0.4, y: center.y + CELL_H * 0.4 })).toEqual({ col: 1, row: 1 });
    expect(cellFromPoint({ x: center.x + CELL_W * 0.4, y: center.y - CELL_H * 0.4 })).toEqual({ col: 1, row: 1 });
  });

  it('crosses into the neighbor cell past the halfway line', () => {
    const center = cellCenter({ col: 1, row: 1 });
    expect(cellFromPoint({ x: center.x + CELL_W * 0.6, y: center.y }).col).toBe(2);
    expect(cellFromPoint({ x: center.x, y: center.y - CELL_H * 0.6 }).row).toBe(0);
  });

  it('handles cells above/left of the origin', () => {
    expect(cellFromPoint(cellCenter({ col: -1, row: -1 }))).toEqual({ col: -1, row: -1 });
  });
});

describe('cellRect', () => {
  it('covers exactly one cell with the center in the middle', () => {
    const cell = { col: 2, row: 1 };
    const r = cellRect(cell);
    const c = cellCenter(cell);
    expect(r.width).toBe(CELL_W);
    expect(r.height).toBe(CELL_H);
    expect(r.x + r.width / 2).toBe(c.x);
    expect(r.y + r.height / 2).toBe(c.y);
  });
});

// ─── toCell ──────────────────────────────────────────────────

describe('toCell', () => {
  it('passes through a modern {col,row} entry', () => {
    expect(toCell({ col: 1, row: 4 })).toEqual({ col: 1, row: 4 });
  });

  it('converts the legacy column anchors to the right lanes', () => {
    // Pre-refactor pixel layouts: platforms x=50, pairs x=370, workflows x=690.
    expect(toCell({ x: 50, y: 50 })!.col).toBe(COL.platforms);
    expect(toCell({ x: 370, y: 50 })!.col).toBe(COL.pairs);
    expect(toCell({ x: 690, y: 50 })!.col).toBe(COL.workflows);
  });

  it('recovers the row despite legacy height-centering offsets in y', () => {
    // Legacy y = 50 + row*210 + offset, offset ranged roughly -35..+70.
    for (const offset of [-35, 0, 60, 70]) {
      expect(toCell({ x: 370, y: 50 + 2 * 210 + offset })!.row).toBe(2);
    }
  });

  it('clamps absurd values into the server-accepted bounds', () => {
    // clampCell mirrors the PATCH zod schema; one out-of-range cell would 400
    // the whole save batch and poison every retry.
    expect(clampCell({ col: 5000, row: -99999 })).toEqual({ col: 1000, row: -1000 });
    expect(toCell({ x: 10_000_000, y: -10_000_000 })).toEqual({ col: 1000, row: -1000 });
    expect(toCell({ col: 3, row: 7 })).toEqual({ col: 3, row: 7 });
  });

  it('returns null for empty or malformed entries', () => {
    expect(toCell(null)).toBeNull();
    expect(toCell(undefined)).toBeNull();
    expect(toCell({})).toBeNull();
    expect(toCell({ x: 100 } as { x: number })).toBeNull();
    expect(toCell({ col: Number.NaN, row: 1 } as { col: number; row: number })).toBeNull();
  });
});

// ─── findFreeRow ─────────────────────────────────────────────

describe('findFreeRow', () => {
  it('returns the preferred row when free', () => {
    expect(findFreeRow(new Set(), 1, 3)).toBe(3);
  });

  it('skips occupied rows downward', () => {
    const occupied = new Set([cellKey({ col: 1, row: 2 }), cellKey({ col: 1, row: 3 })]);
    expect(findFreeRow(occupied, 1, 2)).toBe(4);
  });

  it('ignores occupancy in other columns', () => {
    const occupied = new Set([cellKey({ col: 0, row: 2 })]);
    expect(findFreeRow(occupied, 1, 2)).toBe(2);
  });

  it('findNearestFreeRow searches both directions, preferring below on ties', () => {
    // start row free -> itself
    expect(findNearestFreeRow(new Set(), 1, 2)).toBe(2);
    // below occupied, above free -> goes up instead of skipping far down
    const occ = new Set([cellKey({ col: 1, row: 2 }), cellKey({ col: 1, row: 3 })]);
    expect(findNearestFreeRow(occ, 1, 2)).toBe(1);
    // tie (both +1 and -1 free) -> prefers below
    expect(findNearestFreeRow(new Set([cellKey({ col: 1, row: 0 })]), 1, 0)).toBe(1);
  });

  it('respects negative start rows - saved cells above the origin are legitimate', () => {
    // Layouts saved before the grid rework can hold negative rows; a collision
    // at row -2 must resolve to -1, not teleport the node down past row 0.
    expect(findFreeRow(new Set(), 1, -5)).toBe(-5);
    const occupied = new Set([cellKey({ col: 1, row: -2 })]);
    expect(findFreeRow(occupied, 1, -2)).toBe(-1);
  });
});

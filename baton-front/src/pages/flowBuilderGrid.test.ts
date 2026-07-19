/**
 * flowBuilderGrid — unit tests
 *
 * Covers Friday's canvas work:
 *  - snapToCell           — free-form position → nearest cell (8b4fe35)
 *  - nodeHeight           — measured height with per-type fallback (6e3431b)
 *  - yCenteringOffset     — vertical centering inside a cell (6e3431b)
 *  - normalizePositions   — snap + center + collision push-down (8b4fe35, 6e3431b)
 */
import { describe, it, expect } from 'vitest';
import {
  CELL_W, CELL_H, GRID_ORIGIN_X, GRID_ORIGIN_Y, CELL_PAD_TOP, NODE_H,
  snapToCell, nodeHeight, yCenteringOffset, normalizePositions,
  type GridNode,
} from './flowBuilderGrid';

// ─── snapToCell ──────────────────────────────────────────────

describe('snapToCell', () => {
  it('maps the grid origin to cell (0,0)', () => {
    const s = snapToCell({ x: GRID_ORIGIN_X, y: GRID_ORIGIN_Y });
    expect(s).toMatchObject({ col: 0, row: 0, x: GRID_ORIGIN_X, y: GRID_ORIGIN_Y });
  });

  it('rounds to the nearest cell, not the floor', () => {
    // 0.6 of a cell away rounds up to the next col/row.
    const s = snapToCell({
      x: GRID_ORIGIN_X + CELL_W * 0.6,
      y: GRID_ORIGIN_Y + CELL_H * 0.6,
    });
    expect(s.col).toBe(1);
    expect(s.row).toBe(1);
  });

  it('rounds down when less than half a cell away', () => {
    const s = snapToCell({
      x: GRID_ORIGIN_X + CELL_W * 0.4,
      y: GRID_ORIGIN_Y + CELL_H * 0.4,
    });
    expect(s.col).toBe(0);
    expect(s.row).toBe(0);
  });

  it('computes absolute snapped coords from col/row', () => {
    const s = snapToCell({ x: GRID_ORIGIN_X + CELL_W * 2 + 5, y: GRID_ORIGIN_Y + CELL_H * 3 - 5 });
    expect(s.col).toBe(2);
    expect(s.row).toBe(3);
    expect(s.x).toBe(GRID_ORIGIN_X + 2 * CELL_W);
    expect(s.y).toBe(GRID_ORIGIN_Y + 3 * CELL_H);
  });

  it('handles negative positions (cells above/left of origin)', () => {
    const s = snapToCell({ x: GRID_ORIGIN_X - CELL_W, y: GRID_ORIGIN_Y - CELL_H });
    expect(s.col).toBe(-1);
    expect(s.row).toBe(-1);
  });
});

// ─── nodeHeight ──────────────────────────────────────────────

describe('nodeHeight', () => {
  it('prefers the measured height when present and positive', () => {
    expect(nodeHeight({ type: 'pair', measured: { height: 333 } })).toBe(333);
  });

  it('falls back to the per-type estimate when not measured', () => {
    expect(nodeHeight({ type: 'platform' })).toBe(NODE_H.platform);
    expect(nodeHeight({ type: 'pair' })).toBe(NODE_H.pair);
    expect(nodeHeight({ type: 'workflow' })).toBe(NODE_H.workflow);
  });

  it('ignores a zero/negative measured height and uses the fallback', () => {
    expect(nodeHeight({ type: 'workflow', measured: { height: 0 } })).toBe(NODE_H.workflow);
  });

  it('returns 0 for an unknown type with no measurement', () => {
    expect(nodeHeight({ type: 'mystery' })).toBe(0);
    expect(nodeHeight({})).toBe(0);
  });
});

// ─── yCenteringOffset ────────────────────────────────────────

describe('yCenteringOffset', () => {
  it('centers a node of given height within the cell, minus top padding', () => {
    expect(yCenteringOffset(100)).toBe((CELL_H - 100) / 2 - CELL_PAD_TOP);
  });

  it('is symmetric: a taller node gets a smaller (eventually negative) offset', () => {
    expect(yCenteringOffset(40)).toBeGreaterThan(yCenteringOffset(200));
  });
});

// ─── normalizePositions ──────────────────────────────────────

const at = (x: number, y: number, type = 'platform', id = `${x}-${y}`): GridNode & { id: string } =>
  ({ id, type, position: { x, y } });

describe('normalizePositions', () => {
  it('snaps an off-grid node onto its cell anchor + centering offset', () => {
    const off = yCenteringOffset(NODE_H.platform);
    const [n] = normalizePositions([at(GRID_ORIGIN_X + 12, GRID_ORIGIN_Y + 7)]);
    expect(n.position.x).toBe(GRID_ORIGIN_X);
    expect(n.position.y).toBe(GRID_ORIGIN_Y + off);
  });

  it('is idempotent on already-centered nodes', () => {
    const once = normalizePositions([at(GRID_ORIGIN_X + 5, GRID_ORIGIN_Y + 5)]);
    const twice = normalizePositions(once);
    expect(twice[0].position).toEqual(once[0].position);
  });

  it('preserves non-position node fields', () => {
    const [n] = normalizePositions([at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'workflow', 'wf-1')]);
    expect(n.id).toBe('wf-1');
    expect(n.type).toBe('workflow');
  });

  it('pushes a colliding node down to the next free row in the same column', () => {
    // Two nodes that both snap to cell (0,0) — second is bumped to row 1.
    const result = normalizePositions([
      at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'platform', 'a'),
      at(GRID_ORIGIN_X + 3, GRID_ORIGIN_Y + 3, 'platform', 'b'),
    ]);
    const off = yCenteringOffset(NODE_H.platform);
    expect(result[0].position.y).toBe(GRID_ORIGIN_Y + off);
    expect(result[1].position.y).toBe(GRID_ORIGIN_Y + CELL_H + off);
    expect(result[0].position.x).toBe(result[1].position.x);
  });

  it('does not bump nodes in different columns that share a row', () => {
    const result = normalizePositions([
      at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'platform', 'a'),
      at(GRID_ORIGIN_X + CELL_W, GRID_ORIGIN_Y, 'platform', 'b'),
    ]);
    const off = yCenteringOffset(NODE_H.platform);
    expect(result[0].position).toEqual({ x: GRID_ORIGIN_X, y: GRID_ORIGIN_Y + off });
    expect(result[1].position).toEqual({ x: GRID_ORIGIN_X + CELL_W, y: GRID_ORIGIN_Y + off });
  });

  it('stacks three colliding nodes into three consecutive rows', () => {
    const result = normalizePositions([
      at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'platform', 'a'),
      at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'platform', 'b'),
      at(GRID_ORIGIN_X, GRID_ORIGIN_Y, 'platform', 'c'),
    ]);
    const off = yCenteringOffset(NODE_H.platform);
    expect(result.map((n) => n.position.y)).toEqual([
      GRID_ORIGIN_Y + off,
      GRID_ORIGIN_Y + CELL_H + off,
      GRID_ORIGIN_Y + 2 * CELL_H + off,
    ]);
  });

  it('migrates a legacy (non-centered) saved position cleanly onto the centered grid', () => {
    // A node previously saved at the raw cell anchor (no centering offset) should
    // land on the same cell once normalized, just with the offset applied.
    const legacy = at(GRID_ORIGIN_X + CELL_W, GRID_ORIGIN_Y + CELL_H, 'pair', 'p');
    const [n] = normalizePositions([legacy]);
    const off = yCenteringOffset(NODE_H.pair);
    expect(n.position.x).toBe(GRID_ORIGIN_X + CELL_W);
    expect(n.position.y).toBe(GRID_ORIGIN_Y + CELL_H + off);
  });
});

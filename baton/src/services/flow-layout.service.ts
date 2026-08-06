/**
 * Flow Layout Service - Baton
 *
 * Canvas node positions are stored as logical grid cells ({col, row}) in a map
 * on the organization record. Writes are PER KEY: each client updates only the
 * nodes it moved, so concurrent tabs/devices/users can no longer overwrite each
 * other's layout with a stale full map.
 */
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';

export interface FlowCell {
  col: number;
  row: number;
}

// DynamoDB expression size is bounded; typical saves carry 1-3 entries and the
// one-time layout pin a few dozen, so chunking is a safety net, not a hot path.
const CHUNK_SIZE = 40;

// Stored entries carry the cell PLUS a mirrored legacy pixel position so
// bundles from before the cells refactor (still open in tabs, or served from
// a stale asset cache) keep rendering valid coordinates. The legacy mirror
// can be dropped once no pre-refactor bundle is in circulation.
const LEGACY_ORIGIN_X = 50;
const LEGACY_ORIGIN_Y = 50;
const CELL_W = 320;
const CELL_H = 210;

function storedEntry(cell: FlowCell) {
  return {
    col: cell.col,
    row: cell.row,
    x: LEGACY_ORIGIN_X + cell.col * CELL_W,
    y: LEGACY_ORIGIN_Y + cell.row * CELL_H,
  };
}

/**
 * Write layout entries, leaving every other key untouched.
 * - `positions` are user moves: unconditional per-key overwrite.
 * - `pins` are default placements: create-only (`if_not_exists`) so a pin can
 *   never displace a cell another device already saved for that node.
 */
export async function setFlowPositions(
  orgId: string,
  positions: Record<string, FlowCell>,
  pins: Record<string, FlowCell> = {},
): Promise<void> {
  const entries: Array<{ nodeId: string; cell: FlowCell; pin: boolean }> = [
    ...Object.entries(positions).map(([nodeId, cell]) => ({ nodeId, cell, pin: false })),
    ...Object.entries(pins)
      .filter(([nodeId]) => !(nodeId in positions))
      .map(([nodeId, cell]) => ({ nodeId, cell, pin: true })),
  ];
  if (entries.length === 0) return;
  const doc = getDocClient();

  // Nested SET paths require the map attribute to exist first.
  await doc.send(new UpdateCommand({
    TableName: TableNames.ORGANIZATIONS,
    Key: { id: orgId },
    UpdateExpression: 'SET flowPositions = if_not_exists(flowPositions, :empty)',
    ExpressionAttributeValues: { ':empty': {} },
  }));

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const names: Record<string, string> = { '#fp': 'flowPositions' };
    const values: Record<string, unknown> = {};
    const sets = chunk.map(({ nodeId, cell, pin }, j) => {
      names[`#n${j}`] = nodeId;
      values[`:v${j}`] = storedEntry(cell);
      return pin ? `#fp.#n${j} = if_not_exists(#fp.#n${j}, :v${j})` : `#fp.#n${j} = :v${j}`;
    });
    await doc.send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }
}

/**
 * Best-effort removal of layout entries for deleted nodes (e.g. `pair-<id>`
 * when an automation is deleted). Layout cleanup must never fail the delete.
 */
export async function removeFlowPositions(orgId: string, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  const names: Record<string, string> = { '#fp': 'flowPositions' };
  const removes = nodeIds.map((nodeId, i) => {
    names[`#n${i}`] = nodeId;
    return `#fp.#n${i}`;
  });
  try {
    await getDocClient().send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: `REMOVE ${removes.join(', ')}`,
      ExpressionAttributeNames: names,
    }));
  } catch { /* the map may not exist yet - nothing to prune */ }
}

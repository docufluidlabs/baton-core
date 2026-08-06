/**
 * Flow Layout Routes - Baton
 * /api/flow-layout - Persist diagram node cells server-side so all devices share the same layout.
 *
 * Positions are logical grid cells ({col, row}); PATCH writes only the keys it
 * receives (per-node merge, not full replace) so concurrent clients can't
 * clobber each other. GET may still return legacy pixel entries ({x, y}) saved
 * before the cells refactor - the frontend converts them on read.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../middleware/auth';
import { getDocClient, TableNames } from '../db/client';
import { setFlowPositions } from '../services/flow-layout.service';

const router = Router();
router.use(requireAuth);

const cellSchema = z.object({
  col: z.number().int().min(-1000).max(1000),
  row: z.number().int().min(-1000).max(10_000),
});
const positionsSchema = z.record(cellSchema);
const bodySchema = z.object({
  /** User moves - unconditional per-key overwrite. */
  positions: positionsSchema.optional().default({}),
  /** Default placements - create-only, never displace an existing entry. */
  pins: positionsSchema.optional().default({}),
});

// ─── GET /api/flow-layout - Load saved cells ─────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const result = await getDocClient().send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      ProjectionExpression: 'flowPositions',
    }));
    res.json({ positions: result.Item?.flowPositions ?? {} });
  } catch (e) { next(e); }
});

// ─── PATCH /api/flow-layout - Save cells (per-key merge) ─────

router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const { positions, pins } = bodySchema.parse(req.body ?? {});
    await setFlowPositions(orgId, positions, pins);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;

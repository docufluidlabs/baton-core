/**
 * Flow Layout Routes — Baton
 * /api/flow-layout — Persist diagram node positions server-side so all devices share the same layout.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../middleware/auth';
import { getDocClient, TableNames } from '../db/client';

const router = Router();
router.use(requireAuth);

const positionSchema = z.record(
  z.object({ x: z.number(), y: z.number() }),
);

// ─── GET /api/flow-layout — Load saved positions ─────────────

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

// ─── PATCH /api/flow-layout — Save positions ─────────────────

router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const positions = positionSchema.parse(req.body.positions ?? {});
    await getDocClient().send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: 'SET flowPositions = :p',
      ExpressionAttributeValues: { ':p': positions },
    }));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;

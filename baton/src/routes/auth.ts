/**
 * Auth Routes — Baton
 * /api/auth — Current user info, session validation
 */
import { Router, Request, Response, NextFunction } from 'express';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../middleware/auth';
import { getDocClient, TableNames } from '../db/client';
import { getFeatures } from '../lib/feature-flags';

const router = Router();
router.use(requireAuth);

// ─── GET /api/auth/me — Current user + org info ─────────────

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocClient();

    // Fetch user record
    const [userResult, orgResult] = await Promise.all([
      doc.send(new GetCommand({
        TableName: TableNames.USERS,
        Key: { id: req.auth!.userId },
      })),
      doc.send(new GetCommand({
        TableName: TableNames.ORGANIZATIONS,
        Key: { id: req.auth!.orgId },
      })),
    ]);

    const user = userResult.Item;
    const org = orgResult.Item;

    res.json({
      user: user ? {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl,
        role: req.auth!.role,
      } : {
        id: req.auth!.userId,
        role: req.auth!.role,
      },
      organization: org ? {
        id: org.id,
        name: org.name,
        plan: org.plan || 'enterprise',
        executionsUsed: org.executionsUsed || 0,
        features: getFeatures(),
        createdAt: org.createdAt,
      } : {
        id: req.auth!.orgId,
        plan: 'enterprise',
        features: getFeatures(),
      },
    });
  } catch (e) { next(e); }
});

// ─── POST /api/auth/switch-org — Switch active org ──────────

router.post('/switch-org', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.body;
    if (!orgId) {
      res.status(400).json({ error: 'orgId is required' });
      return;
    }

    // Verify the user is a member of the target org
    const doc = getDocClient();
    const userResult = await doc.send(new GetCommand({
      TableName: TableNames.USERS,
      Key: { id: req.auth!.userId },
    }));

    const user = userResult.Item;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify the org exists. Local auth is single-org (BATON_ORG_ID) — the
    // active org always comes from the user row, so this endpoint only
    // confirms the target org is valid.
    const orgResult = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
    }));

    if (!orgResult.Item) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    res.json({ message: 'Organization verified', orgId });
  } catch (e) { next(e); }
});

export default router;

/**
 * Auth Routes — Baton
 * /api/auth — Current user info, session validation
 */
import { Router, Request, Response, NextFunction } from 'express';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { requireAuth } from '../middleware/auth';
import { getDocClient, TableNames } from '../db/client';
import { getFeaturesForPlan } from '../lib/feature-flags';
import type { OrgPlan } from '../lib/types';

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
        plan: org.plan || 'starter',
        executionsUsed: org.executionsUsed || 0,
        features: getFeaturesForPlan((org.plan || 'starter') as OrgPlan),
        createdAt: org.createdAt,
      } : {
        id: req.auth!.orgId,
        plan: 'starter',
        features: getFeaturesForPlan('starter'),
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

    // Check membership (stored in Clerk, or in user record)
    // For now, just verify the org exists
    const orgResult = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
    }));

    if (!orgResult.Item) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Client should set x-clerk-org-id header on subsequent requests
    res.json({ message: 'Switch organization by setting x-clerk-org-id header', orgId });
  } catch (e) { next(e); }
});

export default router;

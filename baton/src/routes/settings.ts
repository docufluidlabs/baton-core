/**
 * Settings Routes — Baton
 * /api/settings — Organization settings, members, audit log
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  UpdateOrgInput,
  UpdateRoleInput,
} from '../docs/schemas/settings';
import { requireAuth } from '../middleware/auth';
import { requireAdmin, requireViewer } from '../middleware/rbac';
import { getDocClient, TableNames } from '../db/client';
import { logInfo } from '../lib/logger';
import { NotFoundError } from '../middleware/error-handler';
import { createInviteToken, inviteExpiresAt } from '../services/local-auth.service';
import env from '../env';

const router = Router();
router.use(requireAuth);

// Validation schemas live in src/docs/schemas/settings.ts.

// ─── GET /api/settings/org — Organization details ────────────

router.get('/org', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
    }));

    if (!result.Item) throw new NotFoundError('Organization');

    res.json({ organization: result.Item });
  } catch (e) { next(e); }
});

// ─── PATCH /api/settings/org — Update organization ───────────

router.patch('/org', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const updates = UpdateOrgInput.parse(req.body);
    const doc = getDocClient();

    const updateParts: string[] = ['updatedAt = :updatedAt'];
    const exprValues: Record<string, any> = { ':updatedAt': new Date().toISOString() };
    const exprNames: Record<string, string> = {};

    if (updates.name !== undefined) {
      updateParts.push('#name = :name');
      exprValues[':name'] = updates.name;
      exprNames['#name'] = 'name';
    }
    if (updates.timezone !== undefined) {
      updateParts.push('timezone = :tz');
      exprValues[':tz'] = updates.timezone;
    }
    if (updates.webhookRetryPolicy !== undefined) {
      updateParts.push('webhookRetryPolicy = :wrp');
      exprValues[':wrp'] = updates.webhookRetryPolicy;
    }
    if (updates.notificationEmail !== undefined) {
      updateParts.push('notificationEmail = :ne');
      exprValues[':ne'] = updates.notificationEmail;
    }
    await doc.send(new UpdateCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: orgId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
      ReturnValues: 'ALL_NEW',
    }));

    logInfo('Organization updated', { orgId, fields: Object.keys(updates) });
    res.json({ message: 'Organization updated' });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/members — List members ────────────────

router.get('/members', requireViewer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.USERS,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    const members = (result.Items || []).map((user: any) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      role: user.role || 'member',
      // Rows created by an invite have no passwordHash until it is accepted.
      status: user.passwordHash ? 'active' : 'invited',
      inviteExpiresAt: user.inviteExpiresAt,
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
    }));

    res.json({ members, total: members.length });
  } catch (e) { next(e); }
});

// ─── POST /api/settings/members/invites — Invite a member ────

const InviteMemberInput = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
});

router.post('/members/invites', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role } = InviteMemberInput.parse(req.body);
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    // Reject duplicates within the org (also refreshes nothing — the admin
    // should delete the pending row to re-invite).
    const existing = await doc.send(new QueryCommand({
      TableName: TableNames.USERS,
      IndexName: 'orgId-email-index',
      KeyConditionExpression: 'orgId = :orgId AND email = :email',
      ExpressionAttributeValues: { ':orgId': orgId, ':email': email.toLowerCase() },
    }));
    if (existing.Items && existing.Items.length > 0) {
      res.status(409).json({ error: 'A member with this email already exists' });
      return;
    }

    const now = new Date().toISOString();
    const token = createInviteToken();
    const expiresAt = inviteExpiresAt();
    const member = {
      id: uuidv4(),
      orgId,
      email: email.toLowerCase(),
      role,
      inviteToken: token,
      inviteExpiresAt: expiresAt,
      invitedBy: req.auth!.userId,
      createdAt: now,
      updatedAt: now,
    };

    await doc.send(new PutCommand({ TableName: TableNames.USERS, Item: member }));

    logInfo('Member invited', { orgId, memberId: member.id, role, invitedBy: req.auth!.userId });
    res.status(201).json({
      inviteUrl: `${env.FRONTEND_URL}/invite?token=${token}`,
      memberId: member.id,
      email: member.email,
      role,
      expiresAt,
    });
  } catch (e) { next(e); }
});

// ─── PATCH /api/settings/members/:id/role — Change role ──────

router.patch('/members/:id/role', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = UpdateRoleInput.parse(req.body);
    const memberId = req.params.id;
    const doc = getDocClient();

    // Prevent changing own role
    if (memberId === req.auth!.userId) {
      res.status(400).json({ error: 'Cannot change your own role' });
      return;
    }

    try {
      await doc.send(new UpdateCommand({
        TableName: TableNames.USERS,
        Key: { id: memberId },
        UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':role': role,
          ':updatedAt': new Date().toISOString(),
          ':orgId': req.auth!.orgId,
        },
        ExpressionAttributeNames: { '#role': 'role' },
        // Org-scoped: an admin must never be able to change roles in another
        // org by guessing user ids (previously only attribute_exists(id)).
        ConditionExpression: 'attribute_exists(id) AND orgId = :orgId',
      }));
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') {
        throw new NotFoundError('Member');
      }
      throw err;
    }

    logInfo('Member role updated', { memberId, role, updatedBy: req.auth!.userId });
    res.json({ message: 'Role updated', memberId, role });
  } catch (e) { next(e); }
});

// ─── DELETE /api/settings/members/:id — Remove member ────────

router.delete('/members/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const memberId = req.params.id;
    const orgId = req.auth!.orgId;
    const doc = getDocClient();

    if (memberId === req.auth!.userId) {
      res.status(400).json({ error: 'Cannot remove yourself' });
      return;
    }

    const memberResult = await doc.send(new GetCommand({
      TableName: TableNames.USERS,
      Key: { id: memberId },
    }));
    const member = memberResult.Item;
    if (!member || member.orgId !== orgId) {
      throw new NotFoundError('Member');
    }

    if (member.role === 'owner') {
      // Never delete the last owner — the org would become unmanageable.
      const owners = await doc.send(new QueryCommand({
        TableName: TableNames.USERS,
        IndexName: 'orgId-index',
        KeyConditionExpression: 'orgId = :orgId',
        FilterExpression: '#r = :owner',
        ExpressionAttributeValues: { ':orgId': orgId, ':owner': 'owner' },
        ExpressionAttributeNames: { '#r': 'role' },
      }));
      if ((owners.Items || []).length <= 1) {
        res.status(400).json({ error: 'Cannot remove the last owner' });
        return;
      }
    }

    await doc.send(new DeleteCommand({
      TableName: TableNames.USERS,
      Key: { id: memberId },
      ConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
    }));

    logInfo('Member removed', { memberId, orgId, removedBy: req.auth!.userId });
    res.json({ message: 'Member removed', memberId });
  } catch (e) { next(e); }
});

// ─── GET /api/settings/audit — Audit log ─────────────────────

router.get('/audit', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const doc = getDocClient();

    const result = await doc.send(new QueryCommand({
      TableName: TableNames.AUDIT_LOG,
      IndexName: 'orgId-createdAt-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }));

    res.json({ auditLog: result.Items || [], count: result.Count || 0 });
  } catch (e) { next(e); }
});

export default router;

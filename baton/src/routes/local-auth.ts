/**
 * Local Auth Routes — Baton
 * /api/auth — PUBLIC (mounted before requireAuth): first-run setup, login,
 * logout, invite acceptance.
 *
 * GET /api/auth/me stays in routes/auth.ts behind requireAuth — requests to
 * paths not handled here fall through to the authenticated /api router.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logWarn } from '../lib/logger';
import { UnauthorizedError, ConflictError, ValidationError } from '../middleware/error-handler';
import {
  needsSetup,
  performSetup,
  findUserByEmail,
  findUserByInviteToken,
  verifyPassword,
  hashPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  buildMeResponse,
  isInviteExpired,
  splitName,
} from '../services/local-auth.service';

const router = Router();

// ─── Validation schemas ──────────────────────────────────────

const SetupInput = z.object({
  orgName: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AcceptInviteInput = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200),
  password: z.string().min(8),
});

// ─── GET /api/auth/status — First-run detection ──────────────

router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ needsSetup: await needsSetup() });
  } catch (e) { next(e); }
});

// ─── POST /api/auth/setup — Create org + owner (first run only) ──

router.post('/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = SetupInput.parse(req.body);

    if (!(await needsSetup())) {
      throw new ConflictError('Setup has already been completed');
    }

    const { user, org } = await performSetup(input);
    setSessionCookie(res, signSession(user.id));

    logInfo('First-run setup completed', { orgId: org.id, userId: user.id });
    res.status(201).json(buildMeResponse(user, org));
  } catch (e) { next(e); }
});

// ─── POST /api/auth/login ────────────────────────────────────

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = LoginInput.parse(req.body);

    const user = await findUserByEmail(email);
    // Uniform 401 for unknown email OR wrong password — never reveal which.
    // verifyPassword runs a bcrypt compare either way (timing-uniform).
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !user.passwordHash || !valid) {
      logWarn('Login failed', { emailDomain: email.split('@')[1] });
      throw new UnauthorizedError('Invalid credentials');
    }

    setSessionCookie(res, signSession(user.id));

    const doc = getDocClient();
    const orgResult = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: user.orgId },
    }));

    logInfo('User logged in', { userId: user.id, orgId: user.orgId });
    res.json(buildMeResponse(user, orgResult.Item));
  } catch (e) { next(e); }
});

// ─── POST /api/auth/logout ───────────────────────────────────

router.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// ─── POST /api/auth/accept-invite ────────────────────────────

router.post('/accept-invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, name, password } = AcceptInviteInput.parse(req.body);

    const user = await findUserByInviteToken(token);
    if (!user || isInviteExpired(user.inviteExpiresAt)) {
      throw new ValidationError('Invalid or expired invite token');
    }

    const { firstName, lastName } = splitName(name);
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    const doc = getDocClient();
    await doc.send(new UpdateCommand({
      TableName: TableNames.USERS,
      Key: { id: user.id },
      // Condition guards a double-accept race: the token must still be present.
      ConditionExpression: 'inviteToken = :token',
      UpdateExpression:
        'SET passwordHash = :ph, fullName = :fn, firstName = :first, lastName = :last, updatedAt = :now ' +
        'REMOVE inviteToken, inviteExpiresAt',
      ExpressionAttributeValues: {
        ':token': token,
        ':ph': passwordHash,
        ':fn': name.trim(),
        ':first': firstName,
        ':last': lastName,
        ':now': now,
      },
    }));

    setSessionCookie(res, signSession(user.id));

    const orgResult = await doc.send(new GetCommand({
      TableName: TableNames.ORGANIZATIONS,
      Key: { id: user.orgId },
    }));

    logInfo('Invite accepted', { userId: user.id, orgId: user.orgId });
    res.json(buildMeResponse(
      { ...user, fullName: name.trim(), firstName, lastName },
      orgResult.Item,
    ));
  } catch (e) {
    if ((e as any)?.name === 'ConditionalCheckFailedException') {
      return next(new ValidationError('Invalid or expired invite token'));
    }
    next(e);
  }
});

export default router;

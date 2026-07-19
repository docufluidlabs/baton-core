/**
 * Auth Middleware — Baton
 * Validates Clerk sessions and populates req.auth
 *
 * Production: Verifies Clerk JWT tokens from Authorization header
 * Development: Bypass with X-Dev-UserId / X-Dev-OrgId headers
 */
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from './error-handler';
import { logger } from '../lib/logger';
import { requestContext } from '../lib/context';
import env from '../env';

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        orgId: string;
        role: string;
        sessionId?: string;
        /** Cached org plan — populated by requireFeature / requireActiveSubscription */
        plan?: string;
        /** Cached subscription status — populated alongside `plan` */
        subscriptionStatus?: string;
        /** Cached trial end timestamp (ISO) — populated for free_demo orgs */
        trialEndsAt?: string;
      };
    }
  }
}

// Clerk client — eagerly initialized in production to fail loudly on startup (#33)
let clerkClient: any = null;

// In production: initialize immediately and crash if it fails.
// In development: lazy-init so the server starts without valid Clerk credentials.
if (env.NODE_ENV === 'production') {
  try {
    // Synchronous top-level init: we import the ESM module via require at this
    // point because the file is compiled to CJS by tsc. Dynamic import is used
    // below for development where we want lazy behavior.
    const { createClerkClient } = require('@clerk/express');
    clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    logger.info('Clerk SDK initialized');
  } catch (err) {
    // Crash immediately — auth is non-functional without Clerk (#33)
    logger.error({ err }, 'Clerk SDK failed to initialize — refusing to start');
    process.exit(1);
  }
}

export async function getClerkClient() {
  if (!clerkClient) {
    try {
      const { createClerkClient } = await import('@clerk/express');
      clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    } catch {
      // Development-only: log and continue without Clerk
      logger.warn('Clerk SDK not available — auth will fall back to dev bypass mode');
    }
  }
  return clerkClient;
}

// Lazy-loaded verifyToken function
let _verifyToken: any = null;

async function getVerifyToken() {
  if (!_verifyToken) {
    const { verifyToken } = await import('@clerk/express');
    _verifyToken = verifyToken;
  }
  return _verifyToken;
}

/**
 * Clerk session validation middleware
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Development bypass
  if (env.NODE_ENV === 'development') {
    const devUserId = req.headers['x-dev-userid'] as string;
    const devOrgId = req.headers['x-dev-orgid'] as string;

    // #23: default to 'viewer' so devs don't accidentally test at admin privilege level
    const devRole = (req.headers['x-dev-role'] as string) || 'viewer';
    if (devUserId && devOrgId) {
      req.auth = {
        userId: devUserId,
        orgId: devOrgId,
        role: devRole,
      };
      const store = requestContext.getStore();
      if (store) {
        store.userId = devUserId;
        store.orgId = devOrgId;
      }
      logger.warn({ devRole, path: req.path }, 'DEV AUTH BYPASS active — set X-Dev-Role header for non-viewer access');
      return next();
    }
  }

  // Production: verify Clerk JWT token from Authorization header or __session cookie
  verifyClerkSession(req)
    .then((auth) => {
      req.auth = auth;
      const store = requestContext.getStore();
      if (store) {
        store.userId = auth.userId;
        store.orgId = auth.orgId;
      }
      logger.debug({ path: req.path }, 'Auth success');
      next();
    })
    .catch((error) => {
      logger.warn(
        {
          err: error,
          path: req.path,
          method: req.method,
          hasAuthHeader: !!req.headers.authorization,
          hasSessionCookie: !!req.cookies?.__session,
          nodeEnv: env.NODE_ENV,
        },
        'Auth verification failed',
      );
      next(new UnauthorizedError('No valid session found'));
    });
}

async function verifyClerkSession(req: Request): Promise<{
  userId: string;
  orgId: string;
  role: string;
  sessionId?: string;
}> {
  // Extract session token from Authorization header or cookie
  const authHeader = req.headers.authorization;
  const sessionToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.cookies?.__session as string);

  if (!sessionToken) {
    logger.warn({ path: req.path }, 'Auth: no session token in request');
    throw new Error('No session token found');
  }

  logger.debug({ tokenLength: sessionToken.length, path: req.path }, 'Auth: verifying token');

  // Verify the JWT token with Clerk
  const verifyToken = await getVerifyToken();
  let payload: any;
  try {
    payload = await verifyToken(sessionToken, {
      secretKey: env.CLERK_SECRET_KEY,
    });
  } catch (err) {
    logger.warn({ err, path: req.path, secretKeySet: !!env.CLERK_SECRET_KEY }, 'Auth: verifyToken threw');
    throw err;
  }

  if (!payload || !payload.sub) {
    logger.warn({ payload: payload ? Object.keys(payload) : null, path: req.path }, 'Auth: invalid payload');
    throw new Error('Invalid session');
  }

  const userId = payload.sub;
  const sessionId = payload.sid;

  // Get active organization from JWT claims; fall back to X-Clerk-Org-Id header
  // but ONLY after verifying the user is actually a member of that org (#20).
  // Clerk v5+ uses short claim names: `o` = { id, rol, per } instead of org_id/org_role
  const orgIdFromToken = payload.org_id || payload.o?.id;
  const orgIdFromHeader = req.headers['x-clerk-org-id'] as string | undefined;

  let orgId: string | undefined = orgIdFromToken;

  if (!orgId && orgIdFromHeader) {
    // Header fallback: verify the user actually belongs to the claimed org (#20)
    try {
      const clerk = await getClerkClient();
      if (clerk) {
        const memberships = await clerk.organizations.getOrganizationMembershipList({
          organizationId: orgIdFromHeader,
        });
        const isMember = memberships.data?.some(
          (m: any) => m.publicUserData?.userId === userId,
        );
        if (isMember) {
          orgId = orgIdFromHeader;
        } else {
          logger.warn({ userId, orgIdFromHeader, path: req.path }, 'Auth: X-Clerk-Org-Id header rejected — user is not a member');
          throw new Error('User is not a member of the claimed organization');
        }
      }
    } catch (membershipErr: any) {
      throw membershipErr;
    }
  }

  logger.debug({
    userId,
    orgId,
    orgFromHeader: !!req.headers['x-clerk-org-id'],
    orgFromToken: !!payload.org_id,
    orgFromShortClaim: !!payload.o?.id,
    oClaimValue: payload.o,
  }, 'Auth: extracted claims');

  if (!orgId) {
    logger.warn({ userId, path: req.path, tokenClaims: Object.keys(payload), oClaim: payload.o }, 'Auth: no orgId in token or header');
    throw new Error('No active organization. Please select an organization.');
  }

  // Get user's role from token claims or Clerk API
  // Clerk v5+ uses `o.rol` instead of `org_role`, and returns roles as "org:owner", "org:admin" etc.
  // Normalize to strip the "org:" prefix so RBAC checks work correctly.
  let role = (payload.org_role || payload.o?.rol || 'member').replace(/^org:/, '');

  // If role not in token, fetch from Clerk API
  if (!payload.org_role && !payload.o?.rol) {
    try {
      const clerk = await getClerkClient();
      if (clerk) {
        const memberships = await clerk.organizations.getOrganizationMembershipList({
          organizationId: orgId,
        });
        const membership = memberships.data?.find((m: any) => m.publicUserData?.userId === userId);
        role = (membership?.role || 'member').replace(/^org:/, '');
      }
    } catch {
      // Fall back to default role
    }
  }

  return {
    userId,
    orgId,
    role,
    sessionId,
  };
}

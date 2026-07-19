/**
 * Auth Middleware — Baton
 * Validates local sessions and populates req.auth
 *
 * Production: verifies the `baton_session` JWT cookie (see local-auth.service)
 * Development: bypass with X-Dev-UserId / X-Dev-OrgId headers
 *
 * The AuthProvider seam lets alternative providers (e.g. a hosted-cloud SSO
 * build) replace session verification without touching route code.
 */
import { Request, Response, NextFunction } from 'express';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { UnauthorizedError } from './error-handler';
import { logger } from '../lib/logger';
import { requestContext } from '../lib/context';
import { getDocClient, TableNames } from '../db/client';
import {
  getSessionTokenFromRequest,
  verifySession,
} from '../services/local-auth.service';
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

export interface AuthContext {
  userId: string;
  orgId: string;
  role: string;
  sessionId?: string;
}

/**
 * Pluggable auth provider seam. authenticate() must resolve to the auth
 * context or throw — requireAuth converts any throw into a 401.
 */
export interface AuthProvider {
  name: string;
  authenticate(req: Request): Promise<AuthContext>;
}

/**
 * Default provider: verifies the `baton_session` JWT cookie and loads the
 * user row so orgId/role always reflect the database (revoking a user or
 * changing their role takes effect on the next request, not at token expiry).
 */
export class LocalAuthProvider implements AuthProvider {
  name = 'local';

  async authenticate(req: Request): Promise<AuthContext> {
    const token = getSessionTokenFromRequest(req);
    if (!token) {
      throw new Error('No session token found');
    }

    const session = verifySession(token);
    if (!session) {
      throw new Error('Invalid or expired session token');
    }

    const doc = getDocClient();
    const result = await doc.send(new GetCommand({
      TableName: TableNames.USERS,
      Key: { id: session.userId },
    }));

    const user = result.Item;
    if (!user) {
      throw new Error('Session user no longer exists');
    }
    if (!user.passwordHash) {
      // Pending invite rows have no password — they cannot hold a session.
      throw new Error('User has not completed account setup');
    }

    return {
      userId: user.id,
      orgId: user.orgId || env.BATON_ORG_ID,
      role: user.role || 'member',
    };
  }
}

let authProvider: AuthProvider = new LocalAuthProvider();

/** Swap the active auth provider (used by closed-source cloud builds). */
export function setAuthProvider(provider: AuthProvider): void {
  authProvider = provider;
}

export function getAuthProvider(): AuthProvider {
  return authProvider;
}

/**
 * Session validation middleware
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

  authProvider.authenticate(req)
    .then((auth) => {
      req.auth = auth;
      const store = requestContext.getStore();
      if (store) {
        store.userId = auth.userId;
        store.orgId = auth.orgId;
      }
      logger.debug({ path: req.path, provider: authProvider.name }, 'Auth success');
      next();
    })
    .catch((error) => {
      logger.warn(
        {
          err: error,
          path: req.path,
          method: req.method,
          provider: authProvider.name,
          hasCookieHeader: !!req.headers.cookie,
          nodeEnv: env.NODE_ENV,
        },
        'Auth verification failed',
      );
      next(new UnauthorizedError('No valid session found'));
    });
}

/**
 * RBAC Middleware — Baton
 * Role-based access control for API endpoints
 */
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from './error-handler';
import { UserRole } from '../lib/types';

/**
 * Require one of the specified roles to access an endpoint
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(new UnauthorizedError());
    }

    const userRole = req.auth.role as UserRole;

    if (!allowedRoles.includes(userRole)) {
      return next(new ForbiddenError(
        `Role '${userRole}' does not have access. Required: ${allowedRoles.join(', ')}`,
      ));
    }

    next();
  };
}

/**
 * Require superuser or owner — can create/delete apps and manage integrations.
 * Owner always has superuser-level access.
 */
export const requireSuperUser = requireRole('superuser', 'owner');

/**
 * Require at least admin role (includes superuser so they can also manage org settings)
 */
export const requireAdmin = requireRole('owner', 'admin', 'superuser');

/**
 * Require at least member role (can modify rules, workflows)
 */
export const requireMember = requireRole('owner', 'admin', 'superuser', 'member');

/**
 * Require at least viewer role (read-only access)
 */
export const requireViewer = requireRole('owner', 'admin', 'superuser', 'member', 'viewer');

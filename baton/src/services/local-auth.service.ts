/**
 * Local Auth Service — Baton
 *
 * Self-contained email/password authentication (open-core, no external IdP):
 *   - bcrypt password hashing (cost 12)
 *   - JWT session tokens (HS256, 7-day expiry) carried in an httpOnly cookie
 *   - invite tokens for adding members (random hex, 72h expiry)
 *
 * Used by routes/local-auth.ts, routes/settings.ts (invites), middleware/auth.ts
 * (session verification) and scripts/seed.ts (headless first-run setup).
 */
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logWarn } from '../lib/logger';
import { getFeaturesForPlan } from '../lib/feature-flags';
import type { OrgPlan } from '../lib/types';
import env from '../env';

// ─── Constants ───────────────────────────────────────────────

export const SESSION_COOKIE_NAME = 'baton_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;    // 72 hours
const BCRYPT_COST = 12;

// Dummy hash ("not-a-real-password") — compared against when the email is
// unknown so login timing doesn't reveal whether an account exists.
const DUMMY_HASH = '$2a$12$8vPB1rQEFTSK5QIYtEim1eKtrNDOZOOtBW1zRZTt0PxHc4dEy0P6y';

// ─── Password hashing ────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash?: string): Promise<boolean> {
  try {
    // Always run a compare so unknown-email and bad-password take the same time.
    return await bcrypt.compare(password, passwordHash || DUMMY_HASH);
  } catch {
    return false;
  }
}

// ─── JWT sessions ────────────────────────────────────────────

function getJwtSecret(): string {
  if (env.AUTH_JWT_SECRET) return env.AUTH_JWT_SECRET;
  // Production refuses to start without AUTH_JWT_SECRET (env.ts zod schema);
  // this fallback only ever applies in development so the server is usable
  // out of the box.
  logWarn('AUTH_JWT_SECRET is not set — using an INSECURE development-only secret');
  return 'baton-dev-insecure-jwt-secret-do-not-use-in-prod';
}

export function signSession(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySession(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    if (typeof payload === 'object' && payload !== null && typeof (payload as any).userId === 'string') {
      return { userId: (payload as any).userId };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Session cookie helpers ──────────────────────────────────

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.FRONTEND_URL.startsWith('https'),
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}

/**
 * Read the session token from the request. cookie-parser is not installed, so
 * fall back to parsing the raw Cookie header when req.cookies is absent.
 */
export function getSessionTokenFromRequest(req: Request): string | null {
  const parsed = (req as any).cookies?.[SESSION_COOKIE_NAME];
  if (parsed) return parsed;

  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// ─── Invite tokens ───────────────────────────────────────────

export function createInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function inviteExpiresAt(): string {
  return new Date(Date.now() + INVITE_TTL_MS).toISOString();
}

export function isInviteExpired(expiresAt?: string): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

// ─── User lookup ─────────────────────────────────────────────
//
// NOTE: email and invite-token lookups use a table Scan. There is no GSI on
// these attributes; a self-hosted install has a handful of users, so a Scan
// is a couple of KB. If user counts ever grow, add an email-index GSI.

export async function findUserByEmail(email: string): Promise<Record<string, any> | null> {
  const doc = getDocClient();
  const result = await doc.send(new ScanCommand({
    TableName: TableNames.USERS,
    FilterExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email.toLowerCase() },
  }));
  return result.Items?.[0] || null;
}

export async function findUserByInviteToken(token: string): Promise<Record<string, any> | null> {
  const doc = getDocClient();
  const result = await doc.send(new ScanCommand({
    TableName: TableNames.USERS,
    FilterExpression: 'inviteToken = :token',
    ExpressionAttributeValues: { ':token': token },
  }));
  return result.Items?.[0] || null;
}

/** True when no user rows exist yet (first-run — owner setup required). */
export async function needsSetup(): Promise<boolean> {
  const doc = getDocClient();
  const result = await doc.send(new ScanCommand({
    TableName: TableNames.USERS,
    Select: 'COUNT',
    Limit: 1,
  }));
  return (result.Count || 0) === 0;
}

// ─── First-run setup (shared by POST /api/auth/setup and scripts/seed.ts) ──

export interface SetupInput {
  orgName: string;
  name: string;
  email: string;
  password: string;
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

/**
 * Create the organization + owner user. Caller must have verified needsSetup().
 *
 * The org row mirrors the field shape the old Clerk webhook wrote, but with
 * top-tier values (enterprise, unlimited relays, meter-exempt) so nothing
 * downstream — feature flags, subscription gates, relay metering — blocks a
 * self-hosted install.
 */
export async function performSetup(input: SetupInput): Promise<{ user: Record<string, any>; org: Record<string, any> }> {
  const doc = getDocClient();
  const now = new Date().toISOString();
  const { firstName, lastName } = splitName(input.name);

  const org = {
    id: env.BATON_ORG_ID,
    name: input.orgName,
    slug: input.orgName.toLowerCase().replace(/\s+/g, '-'),
    plan: 'enterprise' as OrgPlan,
    subscriptionStatus: 'active',
    includedRelays: null,       // unlimited
    overageEnabled: false,
    overageRateCents: 0,
    exemptFromMeter: true,      // never emit usage to a billing meter
    billingCycleStart: now,
    executionsUsed: 0,
    createdAt: now,
    updatedAt: now,
  };

  const user = {
    id: uuidv4(),
    orgId: env.BATON_ORG_ID,
    email: input.email.toLowerCase(),
    fullName: input.name.trim(),
    firstName,
    lastName,
    role: 'owner',
    passwordHash: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };

  await doc.send(new PutCommand({ TableName: TableNames.ORGANIZATIONS, Item: org }));
  await doc.send(new PutCommand({ TableName: TableNames.USERS, Item: user }));

  return { user, org };
}

// ─── /api/auth/me response shape ─────────────────────────────
// Must stay identical to GET /api/auth/me in routes/auth.ts — the frontend
// consumes both interchangeably (login/setup responses hydrate the same store).

export function buildMeResponse(user: Record<string, any>, org: Record<string, any> | null | undefined) {
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      role: user.role,
    },
    organization: org ? {
      id: org.id,
      name: org.name,
      plan: org.plan || 'starter',
      executionsUsed: org.executionsUsed || 0,
      features: getFeaturesForPlan((org.plan || 'starter') as OrgPlan),
      createdAt: org.createdAt,
    } : {
      id: user.orgId || env.BATON_ORG_ID,
      plan: 'starter',
      features: getFeaturesForPlan('starter'),
    },
  };
}

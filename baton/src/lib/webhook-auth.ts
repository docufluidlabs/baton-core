/**
 * Inbound webhook credentials - Baton
 *
 * Checks shared by the two catalog webhook routes (the per-app URL in
 * routes/webhooks/app.ts and the per-automation URL in routes/webhooks/rule.ts)
 * and the custom endpoint receiver, so a credential is compared the same way
 * wherever it arrives.
 */
import * as crypto from 'crypto';

/**
 * Constant-time string comparison. timingSafeEqual needs buffers of equal
 * length, so a value of the wrong length is replaced by the expected one for
 * the comparison: the same work is done either way, and the length check
 * decides the result.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const sameLength = a.length === b.length;
  const equal = crypto.timingSafeEqual(sameLength ? a : b, b);
  return sameLength && equal;
}

/**
 * Headers that carry a credential because of how a catalog template verifies:
 * a static token travels in whichever header the template names. The event
 * store masks these in the copy it keeps.
 */
export function credentialHeadersOf(method: { type: string; headerName?: string }): string[] {
  return method.type === 'static_token' && method.headerName ? [method.headerName] : [];
}

export type BasicAuthResult =
  | { ok: true }
  | {
      ok: false;
      /** 401 for anything the caller sent wrong, 500 when the stored secret is unusable. */
      status: 401 | 500;
      error: string;
      reason: 'missing' | 'scheme' | 'malformed' | 'misconfigured' | 'mismatch';
    };

/**
 * Verify an `Authorization: Basic` header against a stored `username:password`
 * secret. The first colon separates the two on both sides, so passwords may
 * contain colons.
 */
export function verifyBasicAuth(authorization: string | undefined, storedSecret: string): BasicAuthResult {
  if (!authorization) {
    return { ok: false, status: 401, error: 'Missing Authorization header', reason: 'missing' };
  }
  if (!authorization.startsWith('Basic ')) {
    return { ok: false, status: 401, error: 'Invalid authorization scheme', reason: 'scheme' };
  }

  const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  const colonAt = decoded.indexOf(':');
  if (colonAt === -1) {
    return { ok: false, status: 401, error: 'Malformed Authorization header', reason: 'malformed' };
  }

  const storedColonAt = storedSecret.indexOf(':');
  if (storedColonAt === -1) {
    return { ok: false, status: 500, error: 'Internal configuration error', reason: 'misconfigured' };
  }

  // Compare both halves unconditionally so a wrong username costs the same
  // time as a wrong password.
  const usernameMatch = safeEqual(decoded.slice(0, colonAt), storedSecret.slice(0, storedColonAt));
  const passwordMatch = safeEqual(decoded.slice(colonAt + 1), storedSecret.slice(storedColonAt + 1));
  if (!usernameMatch || !passwordMatch) {
    return { ok: false, status: 401, error: 'Invalid credentials', reason: 'mismatch' };
  }
  return { ok: true };
}

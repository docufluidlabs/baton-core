/**
 * API Client — Baton Frontend
 * Thin fetch wrapper. Auth rides the httpOnly `baton_session` cookie set by
 * the backend (/api/auth/*) — same-origin requests send it automatically, so
 * no token plumbing is needed here.
 *
 * Fix: VITE_DEV_AUTH=true is now blocked in production builds via a build-time
 * assertion. Previously this flag could accidentally reach staging if the env
 * var leaked into a non-dev build, giving anyone admin access with no token.
 */

const API_BASE = '/api';

// ─── Production guard ────────────────────────────────────────
// Vite replaces import.meta.env.PROD at build time — this assertion fires
// once at module load before any requests are made.
if (import.meta.env.PROD && import.meta.env.VITE_DEV_AUTH === 'true') {
  throw new Error(
    '[api] VITE_DEV_AUTH=true is set in a production build. ' +
    'Remove this env variable before building for production.',
  );
}

// Dev headers — only injected outside production builds
const DEV_HEADERS: Record<string, string> =
  !import.meta.env.PROD && import.meta.env.VITE_DEV_AUTH === 'true'
    ? {
        'X-Dev-UserId': 'dev-user-1',
        'X-Dev-OrgId': 'dev-org-1',
        // 'superuser' role needed to test App Registration feature.
        // Change back to 'admin' or 'viewer' to test RBAC restrictions.
        'X-Dev-Role': import.meta.env.VITE_DEV_ROLE || 'superuser',
      }
    : {};

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...DEV_HEADERS,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new ApiError(res.status, body.error || body.message || 'Request failed');
    // A 401 outside the auth endpoints means the session cookie is gone or
    // expired — tell the AuthContext so the app flips to the sign-in screen.
    // /auth/* is excluded: a failed login or an anonymous /auth/me probe is
    // handled locally by the caller, not treated as a session loss.
    if (err.status === 401 && !path.startsWith('/auth/')) {
      _onUnauthorized?.();
    }
    _onApiError?.(err);
    throw err;
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Global error handler ────────────────────────────────────
// Set from AppLayout while the authenticated app is mounted; called for every
// non-ok response before the error is thrown, so components don't need their
// own toast calls. Pass null to unregister (AppLayout unmount).
type ApiErrorHandler = (err: ApiError) => void;
let _onApiError: ApiErrorHandler | null = null;

export function setApiErrorHandler(handler: ApiErrorHandler | null) {
  _onApiError = handler;
}

// ─── Session-expiry handler ──────────────────────────────────
// Registered by AuthContext. Invoked on any 401 outside /auth/* so the
// provider can drop the in-memory user and route back to /signin.
type UnauthorizedHandler = () => void;
let _onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  _onUnauthorized = handler;
}

// ─── Typed API methods ───────────────────────────────────────

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ─── SWR Fetcher ─────────────────────────────────────────────

export const fetcher = <T = unknown>(path: string) => api.get<T>(path);

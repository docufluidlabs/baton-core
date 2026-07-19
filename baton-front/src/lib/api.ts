/**
 * API Client — Baton Frontend
 * Thin fetch wrapper with auth headers
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

// ─── Auth token integration ─────────────────────────────────
// Components call setAuthTokenGetter() to wire in Clerk's getToken.
// The getter is invoked before every request to obtain a fresh JWT.
type TokenGetter = () => Promise<string | null>;
let _getAuthToken: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter) {
  _getAuthToken = getter;
}

// ─── Auth-ready gate ─────────────────────────────────────────
// SWR hooks fire before AppLayout's useEffect wires up Clerk (children
// effects run before parents in React). We gate every request behind this
// promise so they wait until Clerk is loaded and the token is available.
let _authReadyResolve: (() => void) | null = null;
const _authReadyPromise: Promise<void> = new Promise((resolve) => {
  _authReadyResolve = resolve;
});
let _authIsReady = false;

export function markAuthReady() {
  if (!_authIsReady) {
    _authIsReady = true;
    _authReadyResolve?.();
  }
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;

  // Wait for Clerk to finish loading before sending any authenticated request.
  // Without this gate, SWR fires requests during the first render before the
  // Bearer token is available, causing a wave of 401s on page load/refresh.
  if (!_authIsReady) await _authReadyPromise;

  // Build auth header: prefer Clerk token, fall back to dev headers
  const authHeaders: Record<string, string> = {};
  if (_getAuthToken) {
    const token = await _getAuthToken();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...DEV_HEADERS,
      ...authHeaders,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new ApiError(res.status, body.error || body.message || 'Request failed');
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
// Set once from AppLayout after Clerk loads; called for every non-ok response
// before the error is thrown, so components don't need their own toast calls.
type ApiErrorHandler = (err: ApiError) => void;
let _onApiError: ApiErrorHandler | null = null;

export function setApiErrorHandler(handler: ApiErrorHandler) {
  _onApiError = handler;
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

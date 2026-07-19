/**
 * Authenticated calls for the docs editor.
 *
 * The docs render outside AppLayout, so the shared api.ts client (which gates on
 * AppLayout wiring up Clerk) can't be used here — it would hang on its auth-ready
 * promise. This is a self-contained authed fetch instead:
 *   - dev (VITE_DEV_AUTH): send the same X-Dev-* headers api.ts uses, so the
 *     backend's dev bypass accepts the request;
 *   - prod: attach a fresh Clerk Bearer token.
 * The backend re-checks FluidLabs membership server-side regardless (see
 * middleware/require-edit-access.ts), so this client is never the security boundary.
 */
type GetToken = () => Promise<string | null>;

const DEV_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH === 'true';

async function authedFetch(path: string, init: RequestInit, getToken: GetToken): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (DEV_AUTH) {
    headers['X-Dev-UserId'] = 'dev-user-1';
    headers['X-Dev-OrgId'] = 'dev-org-1';
    headers['X-Dev-Role'] = import.meta.env.VITE_DEV_ROLE || 'superuser';
  } else {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`/api${path}`, { ...init, headers });
}

async function unwrap(res: Response): Promise<any> {
  if (res.status === 403) throw new Error('Editing is restricted.');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function saveDocOverride(slug: string, contentMarkdown: string, getToken: GetToken) {
  return unwrap(await authedFetch(`/doc-content/${slug}`, {
    method: 'PUT',
    body: JSON.stringify({ contentMarkdown }),
  }, getToken));
}

export async function revertDocOverride(slug: string, getToken: GetToken) {
  return unwrap(await authedFetch(`/doc-content/${slug}`, { method: 'DELETE' }, getToken));
}

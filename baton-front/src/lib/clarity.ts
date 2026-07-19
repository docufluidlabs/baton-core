/**
 * Microsoft Clarity — session recording & heatmaps.
 *
 * Injects the Clarity tracking snippet when VITE_CLARITY_PROJECT_ID is set.
 * No-op otherwise, so dev environments without the ID stay clean.
 */

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;

let initialized = false;

/**
 * Inject the Clarity tracking script. Safe to call multiple times — only
 * runs once and only when a project ID is configured.
 */
export function initClarity(): void {
  if (initialized || !PROJECT_ID) return;
  initialized = true;

  // Queue-based stub so calls before the script loads are buffered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: unknown[][] = [];
  window.clarity = (...args: unknown[]) => { q.push(args); };
  (window.clarity as any).q = q;

  // Inject the async Clarity script tag.
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
  document.head.appendChild(s);
}

/**
 * Associate the current Clarity session with an authenticated user.
 * Call after the session is established (AuthContext resolves /auth/me).
 */
export function clarityIdentify(userId: string, orgId?: string): void {
  if (!window.clarity) return;
  window.clarity('identify', userId);
  if (orgId) {
    window.clarity('set', 'orgId', orgId);
  }
}

/**
 * Tag the current page view so sessions can be filtered in the Clarity dashboard.
 */
export function claritySetPage(pageName: string): void {
  if (!window.clarity) return;
  window.clarity('set', 'page', pageName);
}

/**
 * Lightweight client-side error reporter.
 * Sends errors to the backend /api/errors endpoint for centralized logging.
 *
 * Fix: sensitive URL parameters (code, state, token, access_token) are stripped
 * before the URL is included in the report, preventing OAuth codes and tokens
 * from appearing in error logs.
 */

const REPORT_URL = '/api/errors';

/** URL query parameters that must never appear in error reports. */
const SENSITIVE_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'api_key',
]);

interface ErrorReport {
  message: string;
  stack?: string;
  /** URL with sensitive query parameters redacted. */
  url: string;
  timestamp: string;
  userAgent: string;
  extra?: Record<string, unknown>;
}

/**
 * Strip sensitive query parameters from a URL string.
 * e.g. /callback?code=abc&state=xyz → /callback?code=[redacted]&state=[redacted]
 */
function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    const params = new URLSearchParams(url.search);
    let modified = false;

    for (const key of params.keys()) {
      if (SENSITIVE_PARAMS.has(key.toLowerCase())) {
        params.set(key, '[redacted]');
        modified = true;
      }
    }

    if (!modified) return rawUrl;
    url.search = params.toString();
    return url.pathname + url.search + url.hash;
  } catch {
    // If URL parsing fails, return a safe fallback instead of the raw URL
    return '[unparseable url]';
  }
}

export function reportError(error: Error | string, extra?: Record<string, unknown>) {
  const report: ErrorReport = {
    message: typeof error === 'string' ? error : error.message,
    stack: typeof error === 'string' ? undefined : error.stack,
    url: sanitizeUrl(window.location.href),
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    extra,
  };

  // Fire-and-forget — never block the UI
  fetch(REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  }).catch(() => {
    // Silently ignore reporting failures to avoid infinite error loops
  });
}

// Global handlers for uncaught errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, { type: 'uncaught' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    reportError(error, { type: 'unhandledrejection' });
  });
}

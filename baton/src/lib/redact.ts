/**
 * Redaction - Baton
 *
 * Logs and stored webhook events outlive the request they describe, and are
 * read by people the request was never addressed to. A value that works as a
 * credential - an OAuth code, a bootstrap token, a Basic auth header - is
 * masked before it reaches either. Names are kept so the record still shows
 * what was sent; only values are replaced.
 */

export const REDACTED = '[REDACTED]';

/**
 * Query-parameter names whose value is a credential or a one-time grant:
 * OAuth `code` and `state`, the Salesforce package's `bootstrap` token, and
 * the usual spellings of tokens, keys, secrets and signatures. Matching is
 * deliberately broad - an over-redacted log line costs nothing.
 */
const SENSITIVE_PARAM =
  /^(code|state|bootstrap|auth|authorization|jwt|session|sig|signature|password|passwd|pwd)$|token$|secret$|key$/i;

/** Headers that carry a credential rather than describe the request. */
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|password|api-?key/i;

/** Headers whose value is a URL, which may carry credentials in its query. */
const URL_HEADER = /^(x-baton-request-uri|referer|x-original-url|x-forwarded-uri)$/i;

function isSensitiveParam(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replace(/\+/g, ' '));
  } catch {
    // Malformed escape: judge the name as it was sent.
  }
  // `token[]` and `token[0]` address the same parameter as `token`.
  return SENSITIVE_PARAM.test(name.replace(/\[.*$/, '').trim());
}

function redactPairs(pairs: string): string {
  return pairs
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const name = pair.slice(0, eq);
      return isSensitiveParam(name) ? `${name}=${REDACTED}` : pair;
    })
    .join('&');
}

/**
 * Mask credential values in a URL's query string and fragment. Works on full
 * URLs and on bare paths (`req.originalUrl`), and never throws: a string it
 * cannot make sense of comes back unchanged apart from any pairs it found.
 */
export function redactUrl(url: string | undefined | null): string {
  if (!url) return '';
  const hashAt = url.indexOf('#');
  const head = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? null : url.slice(hashAt + 1);

  const queryAt = head.indexOf('?');
  let out = queryAt === -1
    ? head
    : `${head.slice(0, queryAt)}?${redactPairs(head.slice(queryAt + 1))}`;

  if (fragment !== null) {
    out += `#${fragment.includes('=') ? redactPairs(fragment) : fragment}`;
  }
  return out;
}

function redactHeaderValue(name: string, value: unknown): unknown {
  if (URL_HEADER.test(name)) {
    return typeof value === 'string' ? redactUrl(value) : value;
  }
  if (!CREDENTIAL_HEADER.test(name)) return value;
  // Keep the scheme ("Basic", "Bearer"): it says how the caller authenticated
  // without saying with what.
  if (/^(proxy-)?authorization$/i.test(name) && typeof value === 'string') {
    const space = value.indexOf(' ');
    if (space > 0) return `${value.slice(0, space)} ${REDACTED}`;
  }
  return REDACTED;
}

/**
 * Copy of `headers` with credential values masked. `alsoRedact` names headers
 * that are credentials only by configuration - a catalog template's static
 * token header, whatever it is called.
 */
export function redactHeaders<T extends Record<string, unknown> | undefined>(
  headers: T,
  alsoRedact: string[] = [],
): T {
  if (!headers) return headers;
  const extra = new Set(alsoRedact.map((h) => h.toLowerCase()));
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = extra.has(name.toLowerCase()) ? REDACTED : redactHeaderValue(name, value);
  }
  return out as T;
}

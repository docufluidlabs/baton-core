/**
 * Request value normalizers - Baton
 *
 * Express exposes header values as `string | string[] | undefined` and query
 * values as `string | string[] | ParsedQs | undefined`. Treating either as a
 * plain string invites type confusion (an attacker can send a duplicate key
 * and turn a string into an array). These helpers collapse every shape into a
 * plain string exactly once, at the boundary, so downstream code never
 * branches on shape.
 */

/** Collapse a raw header value into a string. Multi-valued headers are joined with a comma, identical to the previous
  *  String(value) coercion; absent values become ''. */
export function headerString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : '';
}

/** Read a query parameter as a string, or undefined when it is absent or not
 *  a plain string (arrays / nested objects are rejected rather than coerced). */
export function queryString(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A list of strings from a payload field that arrives as an array in JSON and
 * as one comma-separated string when the same webhook is sent as a form post.
 */
export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'number') return [String(value)];
  return [];
}

/**
 * The raw request body, or null when the request did not arrive as one.
 *
 * Webhook routes verify signatures over the exact bytes received, which exist
 * only because express.raw() is mounted ahead of them
 * (middleware/body-parsers.ts). This checks that instead of assuming it;
 * callers answer null with a 400.
 */
export function rawBodyOf(req: { body?: unknown }): Buffer | null {
  const body: unknown = req.body;
  if (typeof body === 'string' || Array.isArray(body)) return null;
  return Buffer.isBuffer(body) ? body : null;
}

/**
 * Parse a webhook body by its content type. Form posts - what Zoho workflow
 * webhooks send unless told otherwise - become a flat object of strings;
 * anything else must be JSON. Throws on a body that is neither.
 */
export function parseWebhookBody(rawBody: Buffer, contentType: string | string[] | undefined): any {
  const text = rawBody.toString('utf8');
  if (headerString(contentType).toLowerCase().includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return JSON.parse(text);
}

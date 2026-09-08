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

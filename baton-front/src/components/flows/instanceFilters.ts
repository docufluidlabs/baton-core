/**
 * Shared instance filtering / sorting helpers.
 *
 * Pure logic backing the search box, "This / Previous month" date chips, and
 * newest-first ordering used by both InstancesSidebar and ActivityLogSidebar.
 * Kept React-free so it can be unit-tested directly.
 */

export type MonthsRange = 'this' | 'prev' | 'all';

/** Inclusive-min / exclusive-max epoch-ms bounds for a month range, or null for "all". */
export interface DateBounds {
  min: number;
  max: number;
}

/**
 * Resolve the date window for a month chip relative to `now`.
 *  - 'this' → from the 1st of the current month, open-ended
 *  - 'prev' → the whole previous calendar month [prevStart, thisStart)
 *  - 'all'  → null (no filtering)
 */
export function monthRangeBounds(range: MonthsRange, now: Date): DateBounds | null {
  if (range === 'all') return null;
  const startOfThis = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (range === 'this') return { min: startOfThis, max: Infinity };
  const startOfPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  return { min: startOfPrev, max: startOfThis };
}

/** True if `startedAt` falls within the bounds (min inclusive, max exclusive). Null bounds = always true. */
export function withinBounds(startedAt: string, bounds: DateBounds | null): boolean {
  if (!bounds) return true;
  const t = new Date(startedAt).getTime();
  return t >= bounds.min && t < bounds.max;
}

/** Flatten resolved input params into one searchable string (key + value pairs). */
export function inputsToText(inputs: Record<string, unknown>): string {
  return Object.entries(inputs)
    .map(([k, v]) => `${k} ${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
}

/**
 * Case-insensitive substring match of `q` against a set of haystack parts.
 * Falsy parts are dropped. An empty/whitespace query matches everything.
 */
export function matchesQuery(parts: Array<string | null | undefined>, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = parts.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

/**
 * Comparator: newest first, strictly by creation time, so recently-completed
 * older instances don't jump above newly-started ones.
 */
export function byStartedAtDesc(a: { startedAt: string }, b: { startedAt: string }): number {
  return b.startedAt.localeCompare(a.startedAt);
}

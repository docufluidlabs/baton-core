/**
 * instanceFilters — unit tests
 *
 * Covers Friday's Activity Log / Instances sidebar work:
 *  - monthRangeBounds  — "This / Previous month" date chips (46a6442)
 *  - withinBounds      — date-window membership
 *  - matchesQuery      — params/text search (46fa6b1)
 *  - inputsToText      — flattening resolved params for search (46fa6b1)
 *  - byStartedAtDesc   — newest-first ordering (b7a7d29)
 */
import { describe, it, expect } from 'vitest';
import {
  monthRangeBounds,
  withinBounds,
  matchesQuery,
  inputsToText,
  byStartedAtDesc,
} from './instanceFilters';

// Fixed reference: 15 Mar 2026, local time.
const NOW = new Date(2026, 2, 15, 12, 0, 0);
const startOfMarch = new Date(2026, 2, 1).getTime();
const startOfFebruary = new Date(2026, 1, 1).getTime();

// ─── monthRangeBounds ────────────────────────────────────────

describe('monthRangeBounds', () => {
  it('returns null for "all" (no filtering)', () => {
    expect(monthRangeBounds('all', NOW)).toBeNull();
  });

  it('"this" starts at the 1st of the current month, open-ended', () => {
    expect(monthRangeBounds('this', NOW)).toEqual({ min: startOfMarch, max: Infinity });
  });

  it('"prev" spans the whole previous calendar month', () => {
    expect(monthRangeBounds('prev', NOW)).toEqual({ min: startOfFebruary, max: startOfMarch });
  });

  it('"prev" rolls back across a year boundary', () => {
    const jan = new Date(2026, 0, 10);
    expect(monthRangeBounds('prev', jan)).toEqual({
      min: new Date(2025, 11, 1).getTime(),
      max: new Date(2026, 0, 1).getTime(),
    });
  });

  it('the previous-month max equals the this-month min (contiguous, non-overlapping)', () => {
    const prev = monthRangeBounds('prev', NOW)!;
    const cur = monthRangeBounds('this', NOW)!;
    expect(prev.max).toBe(cur.min);
  });
});

// ─── withinBounds ────────────────────────────────────────────

describe('withinBounds', () => {
  it('always true when bounds are null', () => {
    expect(withinBounds('2020-01-01T00:00:00Z', null)).toBe(true);
  });

  it('includes the min edge and excludes the max edge', () => {
    const bounds = { min: startOfFebruary, max: startOfMarch };
    expect(withinBounds(new Date(startOfFebruary).toISOString(), bounds)).toBe(true);
    expect(withinBounds(new Date(startOfMarch).toISOString(), bounds)).toBe(false);
  });

  it('rejects dates before the window', () => {
    const bounds = monthRangeBounds('this', NOW);
    expect(withinBounds('2026-02-15T00:00:00', bounds)).toBe(false);
  });

  it('accepts a date inside the current-month window', () => {
    const bounds = monthRangeBounds('this', NOW);
    expect(withinBounds('2026-03-20T09:00:00', bounds)).toBe(true);
  });
});

// ─── inputsToText ────────────────────────────────────────────

describe('inputsToText', () => {
  it('joins key/value pairs into one string', () => {
    expect(inputsToText({ employeeId: '86', name: 'Ann' })).toBe('employeeId 86 name Ann');
  });

  it('renders null/undefined values as empty (key still searchable)', () => {
    expect(inputsToText({ a: null, b: undefined })).toBe('a  b ');
  });

  it('JSON-stringifies object values', () => {
    expect(inputsToText({ data: { id: 1 } })).toBe('data {"id":1}');
  });

  it('returns empty string for no inputs', () => {
    expect(inputsToText({})).toBe('');
  });
});

// ─── matchesQuery ────────────────────────────────────────────

describe('matchesQuery', () => {
  it('matches everything when the query is empty or whitespace', () => {
    expect(matchesQuery(['anything'], '')).toBe(true);
    expect(matchesQuery(['anything'], '   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesQuery(['BambooHR Webhook'], 'bamboo')).toBe(true);
  });

  it('drops falsy parts before matching', () => {
    expect(matchesQuery([null, undefined, '', 'contact.creation'], 'contact')).toBe(true);
  });

  it('returns false when no part contains the needle', () => {
    expect(matchesQuery(['running', 'docusign'], 'salesforce')).toBe(false);
  });

  it('matches across the joined haystack (param key + value)', () => {
    const haystack = ['My Instance', 'docusign', inputsToText({ employeeId: '86' })];
    expect(matchesQuery(haystack, 'employeeid 86')).toBe(true);
  });
});

// ─── byStartedAtDesc ─────────────────────────────────────────

describe('byStartedAtDesc', () => {
  it('orders newest first', () => {
    const items = [
      { startedAt: '2026-06-01T10:00:00Z' },
      { startedAt: '2026-06-05T10:00:00Z' },
      { startedAt: '2026-06-03T10:00:00Z' },
    ];
    const sorted = [...items].sort(byStartedAtDesc).map((i) => i.startedAt);
    expect(sorted).toEqual([
      '2026-06-05T10:00:00Z',
      '2026-06-03T10:00:00Z',
      '2026-06-01T10:00:00Z',
    ]);
  });

  it('returns 0 for equal timestamps (stable)', () => {
    expect(byStartedAtDesc({ startedAt: 'x' }, { startedAt: 'x' })).toBe(0);
  });
});

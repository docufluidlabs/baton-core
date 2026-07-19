import { describe, it, expect, vi, afterEach } from 'vitest';
import { cn, timeAgo, formatDuration, truncate, daysPassed, overdueLevel, overdueThresholdMs, isInstanceOverdue } from './utils';

// ─── cn ─────────────────────────────────────────────────────

describe('cn', () => {
  it('single class', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('multiple classes', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('conditional', () => {
    expect(cn('foo', false && 'bar')).toBe('foo');
  });

  it('truthy conditional', () => {
    expect(cn('foo', true && 'bar')).toBe('foo bar');
  });
});

// ─── timeAgo ────────────────────────────────────────────────

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('just now (< 1 minute)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:30Z'));
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('just now');
  });

  it('minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:05:00Z'));
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('5m ago');
  });

  it('hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('3h ago');
  });

  it('days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-17T12:00:00Z'));
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('2d ago');
  });

  it('> 30 days returns formatted date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    const result = timeAgo('2026-01-15T12:00:00Z');
    // Should not be "Xd ago" but a date string
    expect(result).not.toContain('d ago');
  });
});

// ─── formatDuration ─────────────────────────────────────────

describe('formatDuration', () => {
  it('milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('seconds', () => {
    expect(formatDuration(2500)).toBe('2.5s');
  });

  it('minutes', () => {
    expect(formatDuration(120_000)).toBe('2m');
  });

  it('boundary: 999ms', () => {
    expect(formatDuration(999)).toBe('999ms');
  });

  it('boundary: 1000ms = 1.0s', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('boundary: 60000ms = 1m', () => {
    expect(formatDuration(60_000)).toBe('1m');
  });
});

// ─── truncate ───────────────────────────────────────────────

describe('truncate', () => {
  it('short string unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('exact length unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('long string truncated with ellipsis', () => {
    const result = truncate('hello world', 5);
    expect(result).toBe('hello…');
    expect(result.length).toBe(6); // 5 chars + ellipsis
  });
});

// ─── daysPassed ─────────────────────────────────────────────

describe('daysPassed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when startedAt is "now"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'));
    expect(daysPassed('2026-06-04T12:00:00Z')).toBe(0);
  });

  it('floors partial days down', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'));
    // 23h59m later → still 0 full days
    expect(daysPassed('2026-06-03T12:00:01Z')).toBe(0);
  });

  it('counts full elapsed days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
    expect(daysPassed('2026-06-04T12:00:00Z')).toBe(6);
  });

  it('returns 0 for future startedAt (clock skew)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'));
    expect(daysPassed('2026-06-05T12:00:00Z')).toBe(0);
  });

  it('returns 0 for invalid date string', () => {
    expect(daysPassed('not-a-date')).toBe(0);
  });
});

// ─── overdueLevel ───────────────────────────────────────────

describe('overdueLevel', () => {
  it("'normal' when days < expected", () => {
    expect(overdueLevel(3, 7)).toBe('normal');
  });

  it("'warning' exactly at expected (boundary)", () => {
    expect(overdueLevel(7, 7)).toBe('warning');
  });

  it("'warning' between expected and 1.5× expected", () => {
    expect(overdueLevel(8, 7)).toBe('warning');
  });

  it("'overdue' at 1.5× expected boundary", () => {
    // 7 * 1.5 = 10.5 → days=11 crosses, days=10 does not
    expect(overdueLevel(11, 7)).toBe('overdue');
    expect(overdueLevel(10, 7)).toBe('warning');
  });

  it("'overdue' far past threshold", () => {
    expect(overdueLevel(100, 7)).toBe('overdue');
  });

  it("'normal' when expected is 0 / missing", () => {
    expect(overdueLevel(100, 0)).toBe('normal');
    // @ts-expect-error — runtime guard against undefined
    expect(overdueLevel(100, undefined)).toBe('normal');
  });

  it("'normal' when expected is negative (defensive)", () => {
    expect(overdueLevel(100, -5)).toBe('normal');
  });

  it("'normal' for fresh instance (days=0, expected=7)", () => {
    expect(overdueLevel(0, 7)).toBe('normal');
  });
});

// ─── overdueThresholdMs ─────────────────────────────────────

const DAY = 86_400_000;

describe('overdueThresholdMs', () => {
  it('null when no expected duration and never postponed', () => {
    expect(overdueThresholdMs({ startedAt: '2026-06-01T00:00:00Z' })).toBeNull();
    expect(overdueThresholdMs({ startedAt: '2026-06-01T00:00:00Z' }, 0)).toBeNull();
  });

  it('startedAt + expectedDurationDays when not postponed', () => {
    const startedAt = '2026-06-01T00:00:00Z';
    const expected = new Date(startedAt).getTime() + 5 * DAY;
    expect(overdueThresholdMs({ startedAt }, 5)).toBe(expected);
  });

  it('uses overdueSnoozedUntil over expected duration when postponed', () => {
    const snooze = '2026-07-01T00:00:00Z';
    expect(
      overdueThresholdMs({ startedAt: '2026-06-01T00:00:00Z', overdueSnoozedUntil: snooze }, 5),
    ).toBe(new Date(snooze).getTime());
  });

  it('snooze applies even with no expected duration', () => {
    const snooze = '2026-07-01T00:00:00Z';
    expect(
      overdueThresholdMs({ startedAt: '2026-06-01T00:00:00Z', overdueSnoozedUntil: snooze }),
    ).toBe(new Date(snooze).getTime());
  });
});

// ─── isInstanceOverdue ──────────────────────────────────────

describe('isInstanceOverdue', () => {
  afterEach(() => vi.useRealTimers());

  it('false when there is no threshold (no expected, not postponed)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    expect(isInstanceOverdue({ startedAt: '2026-06-01T00:00:00Z' })).toBe(false);
  });

  it('true once expectedDurationDays has elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-07T00:00:00Z')); // 6 days after start
    expect(isInstanceOverdue({ startedAt: '2026-06-01T00:00:00Z' }, 5)).toBe(true);
  });

  it('false while still within expectedDurationDays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00Z')); // 3 days after start
    expect(isInstanceOverdue({ startedAt: '2026-06-01T00:00:00Z' }, 5)).toBe(false);
  });

  it('overdue at the exact threshold boundary', () => {
    const startedAt = '2026-06-01T00:00:00Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(new Date(startedAt).getTime() + 5 * DAY)); // exactly 5 days
    expect(isInstanceOverdue({ startedAt }, 5)).toBe(true);
  });

  it('postpone hides it from overdue until the window elapses', () => {
    const startedAt = '2026-06-01T00:00:00Z'; // long past its 5-day duration
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    // Postponed 7 days from "now" → not overdue yet, even though startedAt is ancient.
    const overdueSnoozedUntil = new Date(Date.now() + 7 * DAY).toISOString();
    expect(isInstanceOverdue({ startedAt, overdueSnoozedUntil }, 5)).toBe(false);
  });

  it('re-enters overdue once the postpone window passes', () => {
    const startedAt = '2026-06-01T00:00:00Z';
    vi.useFakeTimers();
    // "now" is just past a snooze that ended an hour ago.
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    const overdueSnoozedUntil = new Date(Date.now() - 3600_000).toISOString();
    expect(isInstanceOverdue({ startedAt, overdueSnoozedUntil }, 5)).toBe(true);
  });
});

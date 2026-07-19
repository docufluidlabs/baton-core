import { describe, it, expect } from 'vitest';
import {
  getExpectedDurationDays,
  inControlCenterScope,
  isInProgressInstance,
} from './ControlCenterPage';
import type { WorkflowInstance } from '@/hooks/useApi';

type RuleStub = { actionConfig?: Record<string, unknown> };

const DAY = 86_400_000;

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'i-1',
    workflowId: 'w-1',
    status: 'running',
    startedAt: new Date(Date.now() - 10 * DAY).toISOString(),
    ...overrides,
  } as WorkflowInstance;
}

function makeMap(entries: Array<[string, RuleStub]>): Map<string, RuleStub> {
  return new Map(entries);
}

describe('getExpectedDurationDays', () => {
  it('returns undefined when instance has no triggerRuleId', () => {
    const map = makeMap([['rule-1', { actionConfig: { expectedDurationDays: 7 } }]]);
    expect(getExpectedDurationDays({ triggerRuleId: undefined }, map)).toBeUndefined();
  });

  it('returns undefined when rule is missing from map', () => {
    const map = makeMap([]);
    expect(getExpectedDurationDays({ triggerRuleId: 'rule-1' }, map)).toBeUndefined();
  });

  it('returns undefined when rule has no actionConfig', () => {
    const map = makeMap([['rule-1', {}]]);
    expect(getExpectedDurationDays({ triggerRuleId: 'rule-1' }, map)).toBeUndefined();
  });

  it('returns undefined when expectedDurationDays is missing', () => {
    const map = makeMap([['rule-1', { actionConfig: { fieldMapping: {} } }]]);
    expect(getExpectedDurationDays({ triggerRuleId: 'rule-1' }, map)).toBeUndefined();
  });

  it('returns undefined for non-number values (string/null/object)', () => {
    expect(
      getExpectedDurationDays(
        { triggerRuleId: 'r' },
        makeMap([['r', { actionConfig: { expectedDurationDays: '7' } }]]),
      ),
    ).toBeUndefined();
    expect(
      getExpectedDurationDays(
        { triggerRuleId: 'r' },
        makeMap([['r', { actionConfig: { expectedDurationDays: null } }]]),
      ),
    ).toBeUndefined();
  });

  it('returns undefined for zero or negative values', () => {
    expect(
      getExpectedDurationDays(
        { triggerRuleId: 'r' },
        makeMap([['r', { actionConfig: { expectedDurationDays: 0 } }]]),
      ),
    ).toBeUndefined();
    expect(
      getExpectedDurationDays(
        { triggerRuleId: 'r' },
        makeMap([['r', { actionConfig: { expectedDurationDays: -3 } }]]),
      ),
    ).toBeUndefined();
  });

  it('returns the number when present and positive', () => {
    const map = makeMap([['rule-1', { actionConfig: { expectedDurationDays: 14 } }]]);
    expect(getExpectedDurationDays({ triggerRuleId: 'rule-1' }, map)).toBe(14);
  });
});

describe('inControlCenterScope', () => {
  it('is false for an untouched running instance', () => {
    expect(inControlCenterScope(makeInstance())).toBe(false);
  });

  it('is true when auto-retried, manually retried/cancelled, or postponed', () => {
    expect(inControlCenterScope(makeInstance({ retryCount: 1 }))).toBe(true);
    expect(inControlCenterScope(makeInstance({ manuallyRetriedAt: 'x' }))).toBe(true);
    expect(inControlCenterScope(makeInstance({ manuallyCancelledAt: 'x' }))).toBe(true);
    expect(inControlCenterScope(makeInstance({ overdueSnoozedUntil: 'x' }))).toBe(true);
  });
});

describe('isInProgressInstance', () => {
  it('keeps a postponed instance In Progress while its reschedule window is still open', () => {
    const inst = makeInstance({ overdueSnoozedUntil: new Date(Date.now() + 3 * DAY).toISOString() });
    expect(isInProgressInstance(inst, 5)).toBe(true);
  });

  // Regression: an overdue card that was rescheduled used to stay in BOTH Overdue
  // and In Progress after its reschedule time passed. Once the window expires it is
  // overdue again and must drop out of In Progress entirely.
  it('drops a postponed instance from In Progress once its reschedule window has passed', () => {
    const inst = makeInstance({ overdueSnoozedUntil: new Date(Date.now() - 3600_000).toISOString() });
    expect(isInProgressInstance(inst, 5)).toBe(false);
  });

  it('keeps a retried-but-not-overdue instance In Progress', () => {
    // started 1 day ago, expected duration 5 days → not overdue
    const inst = makeInstance({ retryCount: 1, startedAt: new Date(Date.now() - 1 * DAY).toISOString() });
    expect(isInProgressInstance(inst, 5)).toBe(true);
  });

  it('drops a retried instance from In Progress once it becomes overdue', () => {
    // started 10 days ago, expected duration 5 days → overdue
    const inst = makeInstance({ retryCount: 1 });
    expect(isInProgressInstance(inst, 5)).toBe(false);
  });

  it('is false for an untouched instance regardless of overdue state', () => {
    expect(isInProgressInstance(makeInstance(), 5)).toBe(false);
    expect(isInProgressInstance(makeInstance(), undefined)).toBe(false);
  });
});

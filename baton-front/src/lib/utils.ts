import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

export function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Floored full days between startedAt and now (never negative). */
export function daysPassed(startedAt: string): number {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * Overdue severity for a running instance:
 *   - 'normal'  : days < expected
 *   - 'warning' : days >= expected (overdue, yellow)
 *   - 'overdue' : days >= expected * 1.5 (red)
 */
export type OverdueLevel = 'normal' | 'warning' | 'overdue';
export function overdueLevel(days: number, expected: number): OverdueLevel {
  if (!expected || expected <= 0) return 'normal';
  if (days >= expected * 1.5) return 'overdue';
  if (days >= expected) return 'warning';
  return 'normal';
}

const DAY_MS = 86_400_000;

/**
 * Timestamp (ms) at which a running instance becomes Overdue, or null if it
 * never can (no expected duration and never postponed). A postpone stores
 * `overdueSnoozedUntil`, which overrides the expected-duration threshold and
 * counts from the moment of the postpone rather than from startedAt.
 */
export function overdueThresholdMs(
  inst: { startedAt: string; overdueSnoozedUntil?: string },
  expectedDurationDays?: number,
): number | null {
  if (inst.overdueSnoozedUntil) return new Date(inst.overdueSnoozedUntil).getTime();
  if (expectedDurationDays && expectedDurationDays > 0) {
    return new Date(inst.startedAt).getTime() + expectedDurationDays * DAY_MS;
  }
  return null;
}

/** Whether a running instance is currently past its Overdue threshold. */
export function isInstanceOverdue(
  inst: { startedAt: string; overdueSnoozedUntil?: string },
  expectedDurationDays?: number,
): boolean {
  const t = overdueThresholdMs(inst, expectedDurationDays);
  return t != null && Date.now() >= t;
}

export const PLATFORM_LABELS: Record<string, string> = {
  salesforce: 'Salesforce',
  hubspot: 'HubSpot',
  zohocrm: 'Zoho CRM',
  docusign: 'Docusign',
  mondaycom: 'monday.com',
  zendesk: 'Zendesk',
  bamboohr: 'BambooHR',
  greenhouse: 'Greenhouse',
  powerautomate: 'Power Automate',
};

export const PLATFORM_ICONS: Record<string, string> = {
  salesforce: '☁️',
  hubspot: '🔶',
  zohocrm: '💼',
  docusign: '📝',
  mondaycom: '📅',
  zendesk: '🎫',
  bamboohr: '🎋',
  greenhouse: '🌱',
  powerautomate: '⚡',
};

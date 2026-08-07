/**
 * Notification Service — Baton
 *
 * Delivers notifications via:
 *   - In-app (DynamoDB + real-time polling)
 *   - Email (Resend API)
 *   - Slack (Bot API + Block Kit — see slack.service.ts)
 *
 * Called by: notification-sender.worker.ts
 */

import * as crypto from 'crypto';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logError, logDebug } from '../lib/logger';
import { sendSlackNotification as sendSlackBotNotification } from './slack.service';
import env from '../env';

// ─── Types ───────────────────────────────────────────────────

export type NotificationChannel = 'in_app' | 'email' | 'slack';
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

export interface NotificationPayload {
  orgId: string;
  recipientId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  category: string;
  metadata?: Record<string, any>;
  channels?: NotificationChannel[];
  actionUrl?: string;
  /**
   * Roll-up key: an in-app notification with the same key for the same
   * recipient is INCREMENTED (count + freshness) instead of inserted, so
   * per-instance events read "5 instances failed in X" rather than five rows.
   * Callers bake the time window into the key (e.g. an hour bucket suffix).
   */
  collapseKey?: string;
}

export interface EventChannelPrefs {
  inApp: boolean;
  email: boolean;
}

export interface NotificationPreferences {
  userId: string;
  email: boolean;
  inApp: boolean;
  mutedCategories: string[];
  /** Per-event, per-channel granular preferences */
  events?: Record<string, EventChannelPrefs>;
}

// ─── Send Notification ───────────────────────────────────────

export async function sendNotification(payload: NotificationPayload): Promise<void> {
  // MVP: preferences are per-org, not per-user
  const prefs = await getOrgPreferences(payload.orgId);

  logInfo('Notification dispatch', {
    category: payload.category,
    orgId: payload.orgId,
    severity: payload.severity,
    hasEvents: !!prefs.events,
    eventPref: prefs.events?.[payload.category],
  });

  if (prefs.mutedCategories.includes(payload.category)) {
    logDebug('Notification muted by user preference', {
      category: payload.category,
      recipientId: payload.recipientId,
    });
    return;
  }

  const channels = payload.channels || determineChannels(payload.severity, prefs, payload.category);
  logInfo('Notification channels resolved', { category: payload.category, channels });

  const promises: Promise<void>[] = [];

  if (channels.includes('in_app')) {
    promises.push(createInAppNotification(payload));
  }

  if (channels.includes('email') && prefs.email) {
    promises.push(sendEmailNotification(payload));
  }

  if (channels.includes('slack')) {
    // Slack Bot API — channel routing (incl. per-event "don't send") is
    // resolved inside the Slack service from the per-org SlackConfig.
    promises.push(sendSlackBotNotification(payload));
  }

  const results = await Promise.allSettled(promises);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    logError('Some notification channels failed', null, {
      category: payload.category,
      failures: failed.map(f => (f as PromiseRejectedResult).reason?.message),
    });
  }
}

// ─── Channel Determination ───────────────────────────────────

function determineChannels(
  severity: NotificationSeverity,
  prefs: NotificationPreferences,
  category?: string,
): NotificationChannel[] {
  // Per-event prefs only cover in-app/email — Slack is gated by the per-org
  // channelRouting in SlackConfig, so we always opt into a Slack send attempt
  // and let the Slack service decide whether (and where) to deliver.
  if (category && prefs.events?.[category]) {
    const ep = prefs.events[category];
    const channels: NotificationChannel[] = ['slack'];
    if (ep.inApp) channels.push('in_app');
    if (ep.email) channels.push('email');
    return channels;
  }

  // Fallback: severity-based defaults
  const channels: NotificationChannel[] = ['slack'];

  if (prefs.inApp) channels.push('in_app');

  if ((severity === 'error' || severity === 'warning') && prefs.email) {
    channels.push('email');
  }

  return channels;
}

// ─── In-App (DynamoDB) ──────────────────────────────────────

async function createInAppNotification(payload: NotificationPayload): Promise<void> {
  const doc = getDocClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    // Roll-up: same collapseKey + recipient → bump the existing entry instead
    // of stacking a new one. The key carries its own time window, so a simple
    // recent-page scan is enough.
    if (payload.collapseKey) {
      const recent = await doc.send(new QueryCommand({
        TableName: TableNames.NOTIFICATIONS,
        IndexName: 'recipientId-createdAt-index',
        KeyConditionExpression: 'recipientId = :r',
        FilterExpression: 'collapseKey = :k AND dismissed <> :true',
        ExpressionAttributeValues: { ':r': payload.recipientId, ':k': payload.collapseKey, ':true': true },
        ScanIndexForward: false,
        Limit: 50,
      }));
      const existing = recent.Items?.[0];
      if (existing) {
        await doc.send(new UpdateCommand({
          TableName: TableNames.NOTIFICATIONS,
          Key: { id: existing.id },
          // count starts at 1 for the original entry; body refreshes to the
          // latest message; the entry surfaces as new again.
          UpdateExpression: 'SET #count = if_not_exists(#count, :one) + :one, body = :body, createdAt = :now, #read = :false REMOVE readAt',
          ExpressionAttributeNames: { '#count': 'count', '#read': 'read' },
          ExpressionAttributeValues: { ':one': 1, ':body': payload.body, ':now': now, ':false': false },
        }));
        logDebug('In-app notification rolled up', { id: existing.id, collapseKey: payload.collapseKey });
        return;
      }
    }

    await doc.send(new PutCommand({
      TableName: TableNames.NOTIFICATIONS,
      Item: {
        id,
        recipientId: payload.recipientId,
        orgId: payload.orgId,
        title: payload.title,
        body: payload.body,
        severity: payload.severity,
        category: payload.category,
        metadata: payload.metadata,
        actionUrl: payload.actionUrl,
        ...(payload.collapseKey ? { collapseKey: payload.collapseKey } : {}),
        read: false,
        dismissed: false,
        createdAt: now,
      },
    }));
    logDebug('In-app notification created', { id, recipientId: payload.recipientId });
  } catch (error: any) {
    logError('Failed to create in-app notification', error);
  }
}

// ─── Email (Resend API) ─────────────────────────────────────

async function sendEmailNotification(payload: NotificationPayload): Promise<void> {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    logDebug('Resend API key not configured, skipping email');
    return;
  }

  try {
    const recipientEmail = await getRecipientEmail(payload.recipientId);
    if (!recipientEmail) {
      logDebug('No email found for recipient, skipping', { recipientId: payload.recipientId });
      return;
    }

    const severityEmoji: Record<string, string> = {
      error: '🔴', warning: '🟡', success: '🟢', info: 'ℹ️',
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'Baton <notifications@baton.dev>',
        to: [recipientEmail],
        subject: `${severityEmoji[payload.severity] || ''} ${payload.title}`,
        html: buildEmailHtml(payload),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError('Resend email failed', { status: response.status, error });
    } else {
      logInfo('Email notification sent', { recipientEmail, title: payload.title });
    }
  } catch (error: any) {
    logError('Failed to send email notification', error);
  }
}

// Escape user-controlled values before HTML interpolation (#16)
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function buildEmailHtml(payload: NotificationPayload): string {
  const safeTitle = escapeHtml(payload.title.slice(0, 200));
  const safeBody = escapeHtml(payload.body.slice(0, 1000));
  const safeActionUrl = payload.actionUrl?.startsWith('http') ? payload.actionUrl : '';

  const actionButton = safeActionUrl
    ? `<p style="margin-top:16px"><a href="${safeActionUrl}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:6px;text-decoration:none">View Details</a></p>`
    : '';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px;color:#111">${safeTitle}</h2>
      <p style="color:#555;font-size:15px;line-height:1.5">${safeBody}</p>
      ${actionButton}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px">Sent by Baton · <a href="${env.FRONTEND_URL}/settings/notifications" style="color:#999">Manage preferences</a></p>
    </div>
  `.trim();
}

// ─── Helpers ─────────────────────────────────────────────────

// Defaults follow one rule: notify when something STOPPED and needs a human,
// when something the user deliberately started FINISHED, or when a limit is
// about to change behavior. Routine success confirmations (sync, connect,
// per-instance launches/completions) are the Activity Log's job - their sends
// were removed, and workflow_completed defaults fully off for anyone who
// re-enables it deliberately.
const DEFAULT_EVENT_PREFS: Record<string, EventChannelPrefs> = {
  workflow_failed:           { inApp: true,  email: true  },
  workflow_completed:        { inApp: false, email: false },
  automation_failed:         { inApp: true,  email: true  },
  batch_run_completed:       { inApp: true,  email: false },
  batch_run_stopped:         { inApp: true,  email: true  },
  connection_degraded:       { inApp: true,  email: true  },
  webhook_failed:            { inApp: true,  email: true  },
};

/** MVP: preferences are per-org, not per-user */
async function getOrgPreferences(orgId: string): Promise<NotificationPreferences> {
  try {
    const doc = getDocClient();
    const result = await doc.send(new QueryCommand({
      TableName: TableNames.NOTIFICATION_PREFERENCES,
      IndexName: 'orgId-index',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      Limit: 1,
    }));

    const item = result.Items?.[0];
    if (item) {
      const events = { ...DEFAULT_EVENT_PREFS, ...item.events };
      return {
        userId: orgId,
        email: item.email !== false,
        inApp: item.inApp !== false,
        mutedCategories: item.mutedCategories || [],
        events,
      };
    }
  } catch (error: any) {
    logError('Failed to load notification preferences', error);
  }

  return { userId: orgId, email: true, inApp: true, mutedCategories: [], events: DEFAULT_EVENT_PREFS };
}

async function getRecipientEmail(userId: string): Promise<string | null> {
  try {
    const doc = getDocClient();
    const result = await doc.send(new GetCommand({
      TableName: TableNames.USERS,
      Key: { id: userId },
    }));
    return result.Item?.email || null;
  } catch {
    return null;
  }
}

// ─── Pre-built Notification Templates ────────────────────────
// Removed on purpose (QA/product decision 2026-08-07): workflowLaunched,
// workflowSynced and connectionCreated templates - success confirmations of
// routine operations are the Activity Log's job, not notifications.

export function workflowFailedNotification(
  orgId: string,
  recipientId: string,
  workflowName: string,
  instanceId: string,
  errorMessage: string,
  extra?: { errorStep?: string; retryCount?: number; instanceName?: string; maestroInstanceUrl?: string; platform?: string; automationName?: string; actionNumber?: number },
): NotificationPayload {
  const title = extra?.actionNumber && extra?.automationName && extra?.platform
    ? `${extra.platform} - ${extra.automationName} - Action ${extra.actionNumber}`
    : `Workflow "${workflowName}" failed`;
  return {
    orgId,
    recipientId,
    title,
    body: `Instance ${instanceId} failed with error: ${errorMessage}`,
    severity: 'error',
    category: 'workflow_failed',
    actionUrl: `${env.FRONTEND_URL}/instances/${instanceId}`,
    metadata: { workflowName, instanceId, errorMessage, ...extra },
  };
}

export function workflowCompletedNotification(
  orgId: string,
  recipientId: string,
  workflowName: string,
  instanceId: string,
  durationMs?: number,
  extra?: { instanceName?: string; maestroInstanceUrl?: string },
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `Workflow "${workflowName}" completed`,
    body: `Instance ${instanceId} finished successfully.`,
    severity: 'success',
    category: 'workflow_completed',
    actionUrl: `${env.FRONTEND_URL}/instances/${instanceId}`,
    metadata: { workflowName, instanceId, durationMs, ...extra },
  };
}

export function retryExhaustedNotification(
  orgId: string,
  recipientId: string,
  workflowName: string,
  instanceId: string,
  retryMaxAttempts: number,
  extra?: { instanceName?: string; maestroInstanceUrl?: string; platform?: string; automationName?: string; actionNumber?: number },
): NotificationPayload {
  const title = extra?.actionNumber && extra?.automationName && extra?.platform
    ? `${extra.platform} - ${extra.automationName} - Action ${extra.actionNumber}`
    : `Automation failed: "${workflowName}"`;
  return {
    orgId,
    recipientId,
    title,
    body: `After ${retryMaxAttempts} retry attempts, the workflow could not be launched. Manual intervention required.`,
    severity: 'error',
    category: 'automation_failed',
    actionUrl: `${env.FRONTEND_URL}/instances/${instanceId}`,
    metadata: { workflowName, instanceId, retryMaxAttempts, ...extra },
  };
}

export function connectionErrorNotification(
  orgId: string,
  recipientId: string,
  platform: string,
  errorMessage: string,
  connectionId?: string,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `${platform} connection error`,
    body: `Your ${platform} connection encountered an error: ${errorMessage}. Please check your connection settings.`,
    severity: 'warning',
    category: 'connection_degraded',
    actionUrl: `${env.FRONTEND_URL}/connections`,
    metadata: { platform, errorMessage, connectionId },
  };
}

export function rulePausedNotification(
  orgId: string,
  recipientId: string,
  ruleName: string,
  reason: string,
  failureCount?: number,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `Rule "${ruleName}" auto-paused`,
    body: `The automation rule was automatically paused due to: ${reason}`,
    severity: 'warning',
    category: 'rule_error',
    actionUrl: `${env.FRONTEND_URL}/flows`,
    metadata: { ruleName, reason, failureCount },
  };
}

// ─── New Event Types ─────────────────────────────────────────

/**
 * One summary per finished Bulk Upload run - the answer to "can I close the
 * tab after clicking Start". A clean run stays in-app; failures escalate to
 * email (explicit channels, deliberate override of the per-event preference).
 */
export function batchRunCompletedNotification(
  orgId: string,
  recipientId: string,
  processorName: string,
  runNumber: number,
  fileName: string,
  counts: { completed: number; failed: number; cancelled: number; skipped: number },
): NotificationPayload {
  const parts = [`${counts.completed} completed`];
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  return {
    orgId,
    recipientId,
    title: `Run ${runNumber} finished - ${processorName}`,
    body: `${fileName}: ${parts.join(', ')}.`,
    severity: counts.failed > 0 ? 'warning' : 'success',
    category: 'batch_run_completed',
    ...(counts.failed > 0 ? { channels: ['in_app', 'email', 'slack'] as NotificationChannel[] } : {}),
    actionUrl: `${env.FRONTEND_URL}/bulk-upload`,
    metadata: { processorName, runNumber, fileName, ...counts },
  };
}

/**
 * The run auto-stopped on consecutive failures - rows are waiting and nothing
 * moves until a human resumes. The loudest Bulk Upload event by design.
 */
export function batchRunStoppedNotification(
  orgId: string,
  recipientId: string,
  processorName: string,
  runNumber: number,
  fileName: string,
  consecutiveFailures: number,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `Run ${runNumber} stopped - ${processorName}`,
    body: `${fileName} stopped automatically after ${consecutiveFailures} consecutive failures. Remaining rows are on hold - fix the cause, then resume the run.`,
    severity: 'error',
    category: 'batch_run_stopped',
    actionUrl: `${env.FRONTEND_URL}/bulk-upload`,
    metadata: { processorName, runNumber, fileName, consecutiveFailures },
  };
}

export function webhookFailedNotification(
  orgId: string,
  recipientId: string,
  platform: string,
  reason: string,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `${platform} webhook signature rejected`,
    body: `Incoming webhook HMAC signature was invalid: ${reason}. Verify the webhook secret matches the platform's configuration.`,
    severity: 'warning',
    category: 'webhook_failed',
    actionUrl: `${env.FRONTEND_URL}/connections`,
    metadata: { platform, reason },
  };
}

export function connectionDisconnectedNotification(
  orgId: string,
  recipientId: string,
  platform: string,
  displayName: string,
  reason?: string,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `${displayName} disconnected`,
    body: reason
      ? `${platform} connection "${displayName}" was disconnected: ${reason}`
      : `${platform} connection "${displayName}" has been removed.`,
    severity: 'error',
    category: 'connection_disconnected',
    actionUrl: `${env.FRONTEND_URL}/connections`,
    metadata: { platform, displayName, reason },
  };
}

export const _testExports = { determineChannels, buildEmailHtml, getOrgPreferences, getRecipientEmail };

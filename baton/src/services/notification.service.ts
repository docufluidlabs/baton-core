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

const DEFAULT_EVENT_PREFS: Record<string, EventChannelPrefs> = {
  workflow_failed:           { inApp: true,  email: true  },
  workflow_completed:        { inApp: true,  email: false },
  workflow_launched:         { inApp: true,  email: false },
  automation_failed:         { inApp: true,  email: true  },
  connection_degraded:       { inApp: true,  email: true  },
  execution_quota_warning:   { inApp: true,  email: true  },
  execution_quota_exceeded:  { inApp: true,  email: true  },
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

export function workflowLaunchedNotification(
  orgId: string,
  recipientId: string,
  workflowName: string,
  instanceId: string,
  instanceName?: string,
  maestroInstanceUrl?: string,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `Workflow "${workflowName}" launched`,
    body: instanceName ? `Instance "${instanceName}" is now running.` : `A new instance is now running.`,
    severity: 'info',
    category: 'workflow_launched',
    actionUrl: `${env.FRONTEND_URL}/workflows`,
    metadata: { workflowName, instanceId, instanceName, maestroInstanceUrl },
  };
}

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

export function workflowSyncedNotification(
  orgId: string,
  recipientId: string,
  syncedCount: number,
  newCount?: number,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `${syncedCount} workflow${syncedCount === 1 ? '' : 's'} synced`,
    body: newCount
      ? `${newCount} new and ${syncedCount - newCount} updated workflows synced from Docusign Workflow Builder.`
      : `${syncedCount} workflows synced from Docusign Workflow Builder.`,
    severity: 'info',
    category: 'workflow_synced',
    actionUrl: `${env.FRONTEND_URL}/workflows`,
    metadata: { syncedCount, newCount },
  };
}

export function connectionCreatedNotification(
  orgId: string,
  recipientId: string,
  platform: string,
  displayName: string,
): NotificationPayload {
  return {
    orgId,
    recipientId,
    title: `${displayName} connected`,
    body: `New ${platform} connection "${displayName}" established successfully.`,
    severity: 'success',
    category: 'connection_created',
    actionUrl: `${env.FRONTEND_URL}/connections`,
    metadata: { platform, displayName },
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

/**
 * Slack Bot Service — Baton
 *
 * Sends rich Block Kit notifications via the Slack Bot API (chat.postMessage).
 * Each org installs the bot via OAuth — per-org tokens are stored encrypted in DynamoDB.
 * Per-org channel routing is stored in baton-slack-configs (DynamoDB).
 *
 * Supported notification types:
 *   workflow_failed      → 🔴 error
 *   workflow_completed   → 🟢 success
 *   workflow_launched    → 🔵 info
 *   retry_exhausted      → 🔴 error
 *   retry_in_progress    → 🟡 warning
 *   webhook_failed       → 🔴 error
 *   connection_degraded  → 🟡 warning
 *   rule_error           → 🔴 error
 *   rule_triggered       → 🔵 info
 */

import * as crypto from 'crypto';
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logWarn, logError, logDebug } from '../lib/logger';
import { decryptToken } from '../lib/encryption';
import type { NotificationPayload } from './notification.service';
import type { SlackConfig } from '../lib/types';
import env from '../env';

// ─── Slack API types ─────────────────────────────────────────

type TextObject =
  | { type: 'plain_text'; text: string; emoji?: boolean }
  | { type: 'mrkdwn'; text: string };

type Block =
  | { type: 'header'; text: TextObject }
  | { type: 'section'; text?: TextObject; fields?: TextObject[] }
  | { type: 'context'; elements: TextObject[] }
  | { type: 'divider' }
  | { type: 'actions'; elements: ActionElement[] };

interface ActionElement {
  type: 'button';
  text: TextObject;
  url?: string;
  style?: 'primary' | 'danger';
  action_id?: string;
}

interface PostMessagePayload {
  channel: string;
  text: string;            // fallback for notifications
  blocks?: Block[];
  attachments?: Array<{ color: string; blocks?: Block[] }>;
  unfurl_links?: boolean;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
  team?: string;
}

// ─── Color palette ───────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  error:   '#dc2626',   // red-600
  warning: '#d97706',   // amber-600
  success: '#16a34a',   // green-600
  info:    '#2563eb',   // blue-600
};

const SEVERITY_EMOJI: Record<string, string> = {
  error:   '🔴',
  warning: '🟡',
  success: '🟢',
  info:    '🔵',
};

// ─── Config loader ───────────────────────────────────────────

let configCache: Map<string, { config: SlackConfig; cachedAt: number }> = new Map();
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getSlackConfig(orgId: string): Promise<SlackConfig | null> {
  const cached = configCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    const docClient = getDocClient();
    const result = await docClient.send(new GetCommand({
      TableName: TableNames.SLACK_CONFIGS,
      Key: { orgId },
    }));

    if (!result.Item) return null;

    const config = result.Item as SlackConfig;
    configCache.set(orgId, { config, cachedAt: Date.now() });
    return config;
  } catch (err) {
    logError('Failed to load Slack config', err as Error, { orgId });
    return null;
  }
}

export async function upsertSlackConfig(config: SlackConfig): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new PutCommand({
    TableName: TableNames.SLACK_CONFIGS,
    Item: config,
  }));
  // Invalidate cache
  configCache.delete(config.orgId);
  logInfo('Slack config saved', { orgId: config.orgId });
}

/** Find the first org config connected to a given Slack teamId. */
export async function getSlackConfigByTeamId(teamId: string): Promise<SlackConfig | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.SLACK_CONFIGS,
    FilterExpression: 'teamId = :teamId',
    ExpressionAttributeValues: { ':teamId': teamId },
  }));
  const item = result.Items?.[0];
  return item ? (item as SlackConfig) : null;
}

/**
 * Find all orgs connected to the given Slack teamId and remove their bot token.
 * Called when Slack sends app_uninstalled or tokens_revoked events.
 * Uses a scan — acceptable because the table is small (one row per org).
 */
export async function revokeSlackByTeamId(teamId: string): Promise<void> {
  const docClient = getDocClient();
  const result = await docClient.send(new ScanCommand({
    TableName: TableNames.SLACK_CONFIGS,
    FilterExpression: 'teamId = :teamId',
    ExpressionAttributeValues: { ':teamId': teamId },
  }));

  for (const item of result.Items ?? []) {
    const config = item as SlackConfig;
    await upsertSlackConfig({
      ...config,
      botTokenEnc: undefined,
      teamId:      undefined,
      teamName:    undefined,
      enabled:     false,
      updatedAt:   new Date().toISOString(),
    });
    logInfo('Slack token revoked', { orgId: config.orgId, teamId });
  }
}

/**
 * Resolve channel for a given event category.
 *   - `null` in routing → explicitly disabled, do not send
 *   - non-empty string → send to that channel
 *   - `undefined` / empty string → fall back to `default`, then env default
 */
function resolveChannel(config: SlackConfig | null, category: string): string | null {
  if (!config?.enabled) return null;

  const routing = config.channelRouting;
  const eventChannel = (routing as any)[category];
  if (eventChannel === null) return null;
  if (typeof eventChannel === 'string' && eventChannel) return eventChannel;

  if (routing.default === null) return null;
  return routing.default || env.SLACK_DEFAULT_CHANNEL || null;
}

/** Get the effective bot token from the per-org OAuth install. Returns null if not connected. */
export function resolveToken(config: SlackConfig | null): string | null {
  if (!config?.botTokenEnc) return null;
  try {
    return decryptToken(config.botTokenEnc);
  } catch {
    logWarn('Failed to decrypt per-org Slack bot token');
    return null;
  }
}

// ─── Slack API call ──────────────────────────────────────────

export async function postSlackMessage(
  token: string,
  payload: PostMessagePayload,
): Promise<SlackApiResponse> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ unfurl_links: false, unfurl_media: false, ...payload }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await response.json() as SlackApiResponse;

  if (!data.ok) {
    logWarn('Slack API error', { error: data.error, channel: payload.channel });
  }

  return data;
}

// ─── Block Kit builders ──────────────────────────────────────

function headerBlock(emoji: string, title: string): Block {
  return {
    type: 'header',
    text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true },
  };
}

function contextBlock(orgId: string, extra?: string): Block {
  const ts = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = [`*Org:* ${orgId}`, `*Time:* ${ts}`];
  if (extra) parts.push(extra);
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: parts.join('  •  ') }],
  };
}

function actionButton(text: string, url: string, style?: 'primary' | 'danger'): ActionElement {
  return { type: 'button', text: { type: 'plain_text', text }, url, style };
}

/** Build blocks for a generic notification */
function buildGenericBlocks(payload: NotificationPayload): Block[] {
  const emoji = SEVERITY_EMOJI[payload.severity] || '📢';
  const blocks: Block[] = [
    headerBlock(emoji, payload.title),
    { type: 'section', text: { type: 'mrkdwn', text: payload.body } },
    { type: 'divider' },
    contextBlock(payload.orgId, `Category: \`${payload.category}\``),
  ];

  if (payload.actionUrl) {
    blocks.push({
      type: 'actions',
      elements: [actionButton('View Details ↗', payload.actionUrl)],
    });
  }

  return blocks;
}

/** Build rich blocks for workflow_launched */
function buildWorkflowLaunchedBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🔵', 'Workflow Launched'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Workflow:*\n${meta.workflowName || '-'}` },
        { type: 'mrkdwn', text: `*Instance:*\n${meta.instanceName || meta.instanceId || '-'}` },
      ],
    },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  const buttons: ActionElement[] = [];
  if (payload.actionUrl) buttons.push(actionButton('View in Baton', payload.actionUrl, 'primary'));
  if (meta.maestroInstanceUrl) buttons.push(actionButton('Open in Workflow Builder ↗', meta.maestroInstanceUrl as string));
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons });

  return blocks;
}

/** Build rich blocks for workflow_failed */
function buildWorkflowFailedBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🔴', 'Workflow Failed'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Workflow:*\n${meta.workflowName || '-'}` },
        { type: 'mrkdwn', text: `*Instance:*\n${meta.instanceName || meta.instanceId || '-'}` },
      ],
    },
  ];

  if (meta.errorStep) {
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Failed at step:*\n${meta.errorStep}` },
        { type: 'mrkdwn', text: `*Retries:*\n${meta.retryCount ?? 0}` },
      ],
    });
  }

  if (meta.errorMessage) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${String(meta.errorMessage).slice(0, 500)}\`\`\`` },
    });
  }

  blocks.push({ type: 'divider' }, contextBlock(payload.orgId));

  const buttons: ActionElement[] = [];
  if (payload.actionUrl) buttons.push(actionButton('View in Baton', payload.actionUrl, 'danger'));
  if (meta.maestroInstanceUrl) buttons.push(actionButton('Open in Workflow Builder ↗', meta.maestroInstanceUrl as string));
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons });

  return blocks;
}

/** Build rich blocks for workflow_completed */
function buildWorkflowCompletedBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🟢', 'Workflow Completed'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Workflow:*\n${meta.workflowName || '-'}` },
        { type: 'mrkdwn', text: `*Instance:*\n${meta.instanceName || meta.instanceId || '-'}` },
      ],
    },
  ];

  if (meta.durationMs) {
    const secs = Math.round((meta.durationMs as number) / 1000);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Duration:* ${secs}s` },
    });
  }

  blocks.push({ type: 'divider' }, contextBlock(payload.orgId));

  const buttons: ActionElement[] = [];
  if (payload.actionUrl) buttons.push(actionButton('View in Baton', payload.actionUrl, 'primary'));
  if (meta.maestroInstanceUrl) buttons.push(actionButton('Open in Workflow Builder ↗', meta.maestroInstanceUrl as string));
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons });

  return blocks;
}

/** Build rich blocks for connection_degraded / token_expiring */
function buildConnectionBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🟡', payload.title),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Platform:*\n${meta.platform || '-'}` },
        { type: 'mrkdwn', text: `*Connection:*\n${meta.connectionId || '-'}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: payload.body } },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  if (payload.actionUrl) {
    blocks.push({
      type: 'actions',
      elements: [actionButton('Check Connection ↗', payload.actionUrl)],
    });
  }

  return blocks;
}

/** Build rich blocks for rule_error */
function buildRuleErrorBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🔴', 'Automation Rule Error'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Rule:*\n${meta.ruleName || '-'}` },
        { type: 'mrkdwn', text: `*Failures:*\n${meta.failureCount || '-'}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: payload.body } },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  if (payload.actionUrl) {
    blocks.push({
      type: 'actions',
      elements: [actionButton('Open Flow Builder ↗', payload.actionUrl, 'danger')],
    });
  }

  return blocks;
}

/** Build rich blocks for retry_exhausted */
function buildRetryExhaustedBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const blocks: Block[] = [
    headerBlock('🔴', 'All Retries Exhausted'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Workflow:*\n${meta.workflowName || '-'}` },
        { type: 'mrkdwn', text: `*Instance:*\n${meta.instanceName || meta.instanceId || '-'}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Attempts:* ${meta.retryMaxAttempts || '-'}\n${payload.body}` },
    },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  const buttons: ActionElement[] = [];
  if (payload.actionUrl) buttons.push(actionButton('View in Baton', payload.actionUrl, 'danger'));
  if (meta.maestroInstanceUrl) buttons.push(actionButton('Open in Workflow Builder ↗', meta.maestroInstanceUrl as string));
  if (buttons.length > 0) blocks.push({ type: 'actions', elements: buttons });

  return blocks;
}

/** Build blocks for execution_quota_exceeded / execution_quota_warning */
function buildQuotaBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const isExceeded = payload.category === 'execution_quota_exceeded';
  const blocks: Block[] = [
    headerBlock(isExceeded ? '🔴' : '🟡', isExceeded ? 'Execution Limit Reached' : 'Execution Quota Warning'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Used:*\n${meta.used || 0} / ${meta.limit || 0}` },
        ...(meta.pct ? [{ type: 'mrkdwn' as const, text: `*Usage:*\n${meta.pct}%` }] : []),
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: payload.body } },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  if (payload.actionUrl) {
    blocks.push({ type: 'actions', elements: [actionButton('View Usage ↗', payload.actionUrl, isExceeded ? 'danger' : undefined)] });
  }
  return blocks;
}

/** Build blocks for workflow_synced */
function buildWorkflowSyncedBlocks(payload: NotificationPayload): Block[] {
  const blocks: Block[] = [
    headerBlock('🔄', 'Workflows Synced'),
    {
      type: 'section',
      text: { type: 'mrkdwn', text: payload.body },
    },
    { type: 'divider' },
    contextBlock(payload.orgId),
  ];

  if (payload.actionUrl) {
    blocks.push({ type: 'actions', elements: [actionButton('View Workflows ↗', payload.actionUrl, 'primary')] });
  }
  return blocks;
}

/** Build blocks for connection_created / connection_disconnected */
function buildConnectionLifecycleBlocks(payload: NotificationPayload): Block[] {
  const meta = payload.metadata || {};
  const isCreated = payload.category === 'connection_created';
  const blocks: Block[] = [
    headerBlock(isCreated ? '🟢' : '🔴', isCreated ? 'Connection Created' : 'Connection Disconnected'),
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Platform:*\n${meta.platform || '-'}` },
        { type: 'mrkdwn', text: `*Connection:*\n${meta.displayName || '-'}` },
      ],
    },
  ];

  if (!isCreated && meta.reason) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Reason:* ${meta.reason}` } });
  }

  blocks.push({ type: 'divider' }, contextBlock(payload.orgId));

  if (payload.actionUrl) {
    blocks.push({
      type: 'actions',
      elements: [actionButton(isCreated ? 'View Connection ↗' : 'Reconnect ↗', payload.actionUrl, isCreated ? 'primary' : 'danger')],
    });
  }
  return blocks;
}

// ─── PII sanitization ───────────────────────────────────────

/** Redact values that look like personal data from an error string */
function redactPII(text: string): string {
  return text
    // Email addresses → j***@example.com
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (m) => {
      const [local, domain] = m.split('@');
      return `${local[0]}***@${domain}`;
    })
    // Phone-like patterns → ***
    .replace(/\b\d[\d\s\-().]{7,}\d\b/g, '***');
}

/**
 * Strip raw input values from metadata before sending to Slack.
 * Only safe operational fields are kept; everything else is removed.
 */
function sanitizeMetadata(meta: Record<string, any>): Record<string, any> {
  const SAFE_KEYS = new Set([
    'workflowName', 'instanceId', 'instanceName', 'maestroInstanceUrl',
    'errorStep', 'retryCount', 'retryMaxAttempts', 'durationMs',
    'platform', 'connectionId', 'displayName', 'reason',
    'ruleName', 'failureCount',
    'used', 'limit', 'pct',
  ]);

  const safe: Record<string, any> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!SAFE_KEYS.has(key)) continue;
    safe[key] = typeof value === 'string' ? redactPII(value) : value;
  }
  return safe;
}

/** Pick the right Block Kit builder by category */
function buildBlocks(payload: NotificationPayload): Block[] {
  // Sanitize metadata and body before building Slack blocks
  const sanitized = {
    ...payload,
    body: redactPII(payload.body),
    metadata: payload.metadata ? sanitizeMetadata(payload.metadata) : undefined,
  };
  switch (sanitized.category) {
    case 'workflow_launched':  return buildWorkflowLaunchedBlocks(sanitized);
    case 'workflow_failed':    return buildWorkflowFailedBlocks(sanitized);
    case 'workflow_completed': return buildWorkflowCompletedBlocks(sanitized);
    case 'workflow_synced':    return buildWorkflowSyncedBlocks(sanitized);
    case 'connection_error':
    case 'connection_degraded':
    case 'token_expiring':     return buildConnectionBlocks(sanitized);
    case 'connection_created':
    case 'connection_disconnected': return buildConnectionLifecycleBlocks(sanitized);
    case 'execution_quota_exceeded':
    case 'execution_quota_warning': return buildQuotaBlocks(sanitized);
    case 'rule_paused':
    case 'rule_error':         return buildRuleErrorBlocks(sanitized);
    case 'automation_failed':
    case 'retry_exhausted':    return buildRetryExhaustedBlocks(sanitized);
    default:                   return buildGenericBlocks(sanitized);
  }
}

// ─── Main entry point ────────────────────────────────────────

/**
 * Send a Slack notification for the given payload.
 * Resolves channel and token from per-org config or env defaults.
 */
export async function sendSlackNotification(payload: NotificationPayload): Promise<void> {
  const config = await getSlackConfig(payload.orgId);
  const token = resolveToken(config);

  if (!token) {
    logDebug('Slack bot token not configured, skipping', { orgId: payload.orgId });
    return;
  }

  const channel = resolveChannel(config, payload.category);
  if (!channel) {
    logDebug('No Slack channel configured for category, skipping', {
      orgId: payload.orgId,
      category: payload.category,
    });
    return;
  }

  const emoji = SEVERITY_EMOJI[payload.severity] || '📢';
  const color = SEVERITY_COLOR[payload.severity] || '#6b7280';
  const blocks = buildBlocks(payload);

  try {
    const result = await postSlackMessage(token, {
      channel,
      // Fallback text for notifications/accessibility (PII-safe)
      text: `${emoji} ${payload.title}: ${redactPII(payload.body)}`,
      // Color bar via attachments wrapper; blocks inside for rich display
      attachments: [{ color, blocks }],
    });

    if (result.ok) {
      logInfo('Slack notification sent', {
        orgId: payload.orgId,
        category: payload.category,
        channel,
        ts: result.ts,
      });
    } else {
      logWarn('Slack notification failed', {
        orgId: payload.orgId,
        error: result.error,
        channel,
      });
    }
  } catch (err: any) {
    logError('Slack notification error', err, { orgId: payload.orgId, channel });
  }
}

// ─── Signature verification ──────────────────────────────────

/**
 * Verify a Slack request signature.
 * Slack signs every request with HMAC-SHA256 using the app's signing secret.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  rawBody: Buffer,
  timestamp: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes (replay attack guard)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');
  const expected = `v0=${hmac}`;

  // Constant-time comparison
  const buf1 = Buffer.from(signature);
  const buf2 = Buffer.from(expected);
  if (buf1.length !== buf2.length) return false;

  return crypto.timingSafeEqual(buf1, buf2);
}

// ─── app_mention command handler ─────────────────────────────

export interface SlackMentionEvent {
  type: 'app_mention';
  user: string;
  text: string;
  channel: string;
  ts: string;
  team: string;
}

/**
 * Handle @Baton Alerts Bot <command> mentions.
 * Supported commands: status, help, pause [minutes]
 */
export const _testExports = { resolveChannel, resolveToken, buildBlocks, buildGenericBlocks };

export async function handleAppMention(
  token: string,
  event: SlackMentionEvent,
): Promise<void> {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim().toLowerCase();
  let replyText: string;

  if (text.startsWith('status')) {
    replyText =
      '✅ *Baton is running*\n' +
      `Last checked: ${new Date().toLocaleString('en-GB', { hour12: false })}\n` +
      '_Use the Baton dashboard for full status._';
  } else if (text.startsWith('help')) {
    replyText =
      '*Baton Alerts Bot commands:*\n' +
      '• `@Baton Alerts Bot status` - Check if Baton is running\n' +
      '• `@Baton Alerts Bot help` - Show this message\n\n' +
      '_Configure alert channels at Settings → Slack in Baton._';
  } else {
    replyText = `I don't recognize that command. Try \`@Baton Alerts Bot help\`.`;
  }

  await postSlackMessage(token, {
    channel: event.channel,
    text: replyText,
  });
}

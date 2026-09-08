/**
 * Slack Routes — Baton
 *
 * Three route groups:
 *
 *  A) Public — Slack Event API (no session auth, Slack signature verification):
 *     POST /slack/events  — URL verification challenge + app_mention handler
 *
 *  B) Public — Slack OAuth callback (no session auth, HMAC-signed state):
 *     GET /slack/oauth/callback  — exchange code → save encrypted bot token
 *
 *  C) Authenticated — per-org config management:
 *     GET    /api/slack/oauth/install  — return Slack authorization URL
 *     GET    /api/slack/config         — fetch current config + connected state
 *     PUT    /api/slack/config         — save channel routing / enable-disable
 *     DELETE /api/slack/config         — disconnect workspace (remove token)
 *     POST   /api/slack/test           — send a test message
 */
import * as crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { SlackConfigInput } from '../docs/schemas/slack';
import { requireAdmin } from '../middleware/rbac';
import { logInfo, logWarn, logError } from '../lib/logger';
import { queryString } from '../lib/request';
import { encryptToken } from '../lib/encryption';
import {
  verifySlackSignature,
  handleAppMention,
  sendSlackNotification,
  getSlackConfig,
  getSlackConfigByTeamId,
  upsertSlackConfig,
  revokeSlackByTeamId,
  resolveToken,
} from '../services/slack.service';
import type { SlackMentionEvent } from '../services/slack.service';
import env from '../env';

// ─── A. Public Slack Event API ────────────────────────────────

export const slackEventsRouter = Router();

// Raw body is required for signature verification.
// Mounted at /slack/events (before express.json middleware).
slackEventsRouter.post('/', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  // ── Signature verification ────────────────────────────────
  const signingSecret = env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    logWarn('SLACK_SIGNING_SECRET not set — rejecting Slack event');
    res.status(500).json({ error: 'Slack integration not configured' });
    return;
  }

  if (!timestamp || !signature) {
    res.status(401).json({ error: 'Missing Slack signature headers' });
    return;
  }

  if (!verifySlackSignature(signingSecret, rawBody, timestamp, signature)) {
    logWarn('Invalid Slack signature', { timestamp });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // ── Parse event ───────────────────────────────────────────
  let body: any;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  // Slack URL verification challenge (happens once when setting up Events API)
  if (body.type === 'url_verification') {
    logInfo('Slack URL verification challenge received');
    res.json({ challenge: body.challenge });
    return;
  }

  // Acknowledge immediately — Slack expects < 3s response
  res.status(200).send();

  // ── Handle events async ───────────────────────────────────
  setImmediate(async () => {
    try {
      const event = body?.event;
      if (!event) return;

      if (event.type === 'app_mention') {
        // Resolve the token for the specific workspace that sent the mention.
        // For a distributed app each workspace has its own bot token.
        const teamId = body.team_id as string | undefined;
        const config = teamId ? await getSlackConfigByTeamId(teamId) : null;
        const token = resolveToken(config);
        if (!token) return;

        logInfo('Slack app_mention received', {
          user: event.user,
          channel: event.channel,
          text: event.text?.slice(0, 100),
          teamId,
        });

        await handleAppMention(token, event as SlackMentionEvent);
      }

      // ── app_uninstalled: user removed app from workspace ──
      if (body.type === 'event_callback' && body.event?.type === 'app_uninstalled') {
        const teamId = body.team_id as string;
        logInfo('Slack app_uninstalled received', { teamId });
        await revokeSlackByTeamId(teamId);
      }

      // ── tokens_revoked: specific tokens invalidated ───────
      if (body.type === 'event_callback' && body.event?.type === 'tokens_revoked') {
        const teamId = body.team_id as string;
        logInfo('Slack tokens_revoked received', { teamId });
        await revokeSlackByTeamId(teamId);
      }
    } catch (err: any) {
      logWarn('Failed to handle Slack event', { error: err.message });
    }
  });
});

// ─── B-0. Public Slack Install (Direct Install URL) ──────────
//
// Slack validates the Direct Install URL by checking it returns 302 → slack.com.
// No auth required — state is HMAC-signed without orgId.
// After OAuth the user is prompted to log in and connect from Settings.

export const slackInstallRouter = Router();

slackInstallRouter.get('/', (_req: Request, res: Response) => {
  if (!env.SLACK_CLIENT_ID) {
    res.status(500).send('Slack not configured');
    return;
  }

  const timestamp = Date.now().toString();
  // "pub" prefix distinguishes public-install state from org-scoped state
  const payload = Buffer.from(`pub:${timestamp}`).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', env.TOKEN_ENCRYPTION_KEY)
    .update(payload)
    .digest('hex');
  const state = `${payload}.${hmac}`;

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', 'chat:write,chat:write.public,channels:read,app_mentions:read');
  url.searchParams.set('state', state);
  if (env.SLACK_OAUTH_REDIRECT_URI) {
    url.searchParams.set('redirect_uri', env.SLACK_OAUTH_REDIRECT_URI);
  }

  res.redirect(url.toString());
});

// ─── B. Public Slack OAuth Callback ──────────────────────────
//
// Slack redirects the user's browser here after they approve the app.
// No session auth — identity is carried via HMAC-signed state param.

export const slackOAuthCallbackRouter = Router();

slackOAuthCallbackRouter.get('/', async (req: Request, res: Response) => {
  const code = queryString(req.query as Record<string, unknown>, 'code');
  const state = queryString(req.query as Record<string, unknown>, 'state');
  const error = queryString(req.query as Record<string, unknown>, 'error');
  const frontendBase = `${env.FRONTEND_URL}/notifications`;

  if (error) {
    logWarn('Slack OAuth denied by user', { error });
    res.redirect(`${frontendBase}?slack_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state || !state.includes('.')) {
    res.redirect(`${frontendBase}?slack_error=invalid_request`);
    return;
  }

  // ── Verify HMAC-signed state ──────────────────────────────
  const dotIdx = state.lastIndexOf('.');
  const payload = state.slice(0, dotIdx);
  const receivedHmac = state.slice(dotIdx + 1);

  const expectedHmac = crypto
    .createHmac('sha256', env.TOKEN_ENCRYPTION_KEY)
    .update(payload)
    .digest('hex');

  let stateValid = false;
  try {
    stateValid = crypto.timingSafeEqual(
      Buffer.from(receivedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex'),
    );
  } catch { stateValid = false; }

  if (!stateValid) {
    logWarn('Slack OAuth: invalid state HMAC');
    res.redirect(`${frontendBase}?slack_error=invalid_state`);
    return;
  }

  // ── Decode orgId + check freshness (15-min window) ────────
  let orgId: string;
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    // Public install flow (no orgId) — prompt user to connect from Settings
    if (decoded.startsWith('pub:')) {
      const timestamp = parseInt(decoded.slice(4), 10);
      if (Date.now() - timestamp > 15 * 60 * 1000) {
        res.redirect(`${frontendBase}?slack_error=state_expired`);
        return;
      }
      res.redirect(`${env.FRONTEND_URL}/login?slack_connect=1`);
      return;
    }
    const colonIdx = decoded.indexOf(':');
    orgId = decoded.slice(0, colonIdx);
    const timestamp = parseInt(decoded.slice(colonIdx + 1), 10);
    if (Date.now() - timestamp > 15 * 60 * 1000) {
      res.redirect(`${frontendBase}?slack_error=state_expired`);
      return;
    }
  } catch {
    res.redirect(`${frontendBase}?slack_error=invalid_state`);
    return;
  }

  // ── Exchange code for bot token ───────────────────────────
  try {
    const params = new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
    });
    if (env.SLACK_OAUTH_REDIRECT_URI) {
      params.set('redirect_uri', env.SLACK_OAUTH_REDIRECT_URI);
    }

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenData.ok) {
      logWarn('Slack OAuth token exchange failed', { slackError: tokenData.error, orgId });
      res.redirect(`${frontendBase}?slack_error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`);
      return;
    }

    const botToken: string = tokenData.access_token;
    const teamId: string  = tokenData.team?.id;
    const teamName: string = tokenData.team?.name;

    // Merge into existing config (preserve channel routing + enabled state)
    const existing = await getSlackConfig(orgId);
    await upsertSlackConfig({
      orgId,
      enabled:        existing?.enabled ?? true,
      channelRouting: existing?.channelRouting ?? { default: '#baton-alerts' },
      botTokenEnc:    encryptToken(botToken),
      teamId,
      teamName,
      updatedAt: new Date().toISOString(),
    });

    logInfo('Slack workspace connected via OAuth', { orgId, teamId, teamName });
    res.redirect(`${frontendBase}?slack_connected=1`);
  } catch (err: any) {
    logError('Slack OAuth callback error', err, { orgId: orgId! });
    res.redirect(`${frontendBase}?slack_error=server_error`);
  }
});

// ─── C. Authenticated Config API ──────────────────────────────

export const slackConfigRouter = Router();
slackConfigRouter.use(requireAuth);

// ── GET /api/slack/oauth/install ───────────────────────────────
// Returns the Slack authorization URL. The frontend navigates the browser
// there, so we return JSON rather than redirecting (frontend uses fetch + JWT).

slackConfigRouter.get('/oauth/install', requireAdmin, (req: Request, res: Response) => {
  if (!env.SLACK_CLIENT_ID) {
    res.status(500).json({ error: 'SLACK_CLIENT_ID not configured' });
    return;
  }

  const orgId = req.auth!.orgId;
  const timestamp = Date.now().toString();
  const payload = Buffer.from(`${orgId}:${timestamp}`).toString('base64url');
  const hmac = crypto
    .createHmac('sha256', env.TOKEN_ENCRYPTION_KEY)
    .update(payload)
    .digest('hex');
  const state = `${payload}.${hmac}`;

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', 'chat:write,chat:write.public,channels:read,app_mentions:read');
  url.searchParams.set('state', state);
  if (env.SLACK_OAUTH_REDIRECT_URI) {
    url.searchParams.set('redirect_uri', env.SLACK_OAUTH_REDIRECT_URI);
  }

  res.json({ url: url.toString() });
});

// ── GET /api/slack/config ──────────────────────────────────────

slackConfigRouter.get('/config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSlackConfig(req.auth!.orgId);
    res.json({
      config: config ?? {
        orgId: req.auth!.orgId,
        enabled: false,
        channelRouting: { default: env.SLACK_DEFAULT_CHANNEL || '' },
      },
      connected: !!(config?.botTokenEnc),
      teamName:  config?.teamName,
      teamId:    config?.teamId,
    });
  } catch (err) { next(err); }
});

// ── PUT /api/slack/config ──────────────────────────────────────

// Schema in src/docs/schemas/slack.ts. Event channels are tristate:
//   string  → send to that channel
//   null    → don't send for this event
//   missing → fall back to `default`

slackConfigRouter.put('/config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled, channelRouting } = SlackConfigInput.parse(req.body);
    const orgId = req.auth!.orgId;

    // Preserve botTokenEnc / teamId / teamName when updating channel settings
    const existing = await getSlackConfig(orgId);
    await upsertSlackConfig({
      orgId,
      enabled,
      channelRouting,
      botTokenEnc: existing?.botTokenEnc,
      teamId:      existing?.teamId,
      teamName:    existing?.teamName,
      updatedAt:   new Date().toISOString(),
      updatedBy:   req.auth!.userId,
    });

    logInfo('Slack config updated', { orgId, enabled });
    res.json({ message: 'Slack config saved' });
  } catch (err) { next(err); }
});

// ── DELETE /api/slack/config ───────────────────────────────────
// Disconnects the Slack workspace — removes the stored bot token.

slackConfigRouter.delete('/config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.auth!.orgId;
    const existing = await getSlackConfig(orgId);
    if (existing) {
      await upsertSlackConfig({
        ...existing,
        botTokenEnc: undefined,
        teamId:      undefined,
        teamName:    undefined,
        enabled:     false,
        updatedAt:   new Date().toISOString(),
        updatedBy:   req.auth!.userId,
      });
    }
    logInfo('Slack workspace disconnected', { orgId });
    res.json({ message: 'Slack workspace disconnected' });
  } catch (err) { next(err); }
});

// ── GET /api/slack/channels ───────────────────────────────────
// Lists all channels the bot has access to (conversations.list API).
// Used by the frontend channel select dropdown.

slackConfigRouter.get('/channels', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSlackConfig(req.auth!.orgId);
    const token = resolveToken(config);
    if (!token) {
      res.status(400).json({ error: 'Slack not connected' });
      return;
    }

    const channels: { id: string; name: string; is_private: boolean; num_members: number }[] = [];
    let cursor: string | undefined;

    // Paginate through all channels (max 1000 per page, Slack default is 100)
    do {
      const params = new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
      });
      if (cursor) params.set('cursor', cursor);

      const res2 = await fetch(`https://slack.com/api/conversations.list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res2.json() as {
        ok: boolean;
        channels?: { id: string; name: string; is_private: boolean; num_members: number }[];
        response_metadata?: { next_cursor?: string };
        error?: string;
      };

      if (!data.ok) {
        logWarn('Slack conversations.list error', { error: data.error, orgId: req.auth!.orgId });
        res.status(502).json({ error: `Slack API error: ${data.error}` });
        return;
      }

      channels.push(...(data.channels ?? []));
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Sort: public first, then alphabetical
    channels.sort((a, b) => {
      if (a.is_private !== b.is_private) return a.is_private ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    res.json({ channels });
  } catch (err) { next(err); }
});

// ── POST /api/slack/test ───────────────────────────────────────

slackConfigRouter.post('/test', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getSlackConfig(req.auth!.orgId);
    const token = resolveToken(config);
    if (!token) {
      res.status(400).json({ error: 'Slack not connected. Use "Connect Slack" to install the bot in your workspace.' });
      return;
    }

    const channel = config?.channelRouting.default || env.SLACK_DEFAULT_CHANNEL;
    if (!channel) {
      res.status(400).json({ error: 'No default Slack channel configured' });
      return;
    }

    await sendSlackNotification({
      orgId:       req.auth!.orgId,
      recipientId: req.auth!.userId,
      title:       'Baton test notification',
      body:        'Your Slack integration is working correctly 🎉',
      severity:    'success',
      category:    'workflow_completed',
      metadata: {
        workflowName: 'Test Workflow',
        instanceId:   'test-' + Date.now(),
        durationMs:   1234,
      },
      actionUrl: `${env.FRONTEND_URL}/dashboard`,
    });

    res.json({ message: `Test message sent to ${channel}` });
  } catch (err) { next(err); }
});

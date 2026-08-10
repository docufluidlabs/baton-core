# Slack Notifications - Self-Hosted Setup

Baton can deliver notifications (failed runs, auto-pauses, workflow events - anything you enable on the Notifications page) to Slack channels, and answer **@Baton** mentions in your workspace.

**Self-hosted installs register their own Slack app.** The hosted edition ships with Fluidlabs' Slack app; your instance talks to Slack as *your* app, in your workspace, with tokens stored encrypted in your database. One-time setup, roughly 10 minutes.

## 1. Create the Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → pick your workspace, and paste this manifest (replace `baton.yourcompany.com` with your Baton domain - the same host as `API_URL`):

```yaml
display_information:
  name: Baton
  description: Webhook → Docusign Workflow Builder automation alerts
  background_color: "#1a1a2e"
features:
  bot_user:
    display_name: Baton
    always_online: true
oauth_config:
  redirect_urls:
    - https://baton.yourcompany.com/api/slack/oauth/callback
  scopes:
    bot:
      - chat:write        # post notifications
      - chat:write.public # post to public channels without being invited
      - channels:read     # populate the channel picker in Settings
      - app_mentions:read # respond to @Baton mentions (optional feature)
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

> Local evaluation (no public URL yet)? Slack requires `https` redirect URLs, so the OAuth connect flow needs your instance reachable over HTTPS - a tunnel domain works fine. Everything else in Baton runs without Slack; you can add this integration later.

## 2. Collect the credentials

From your new app's **Basic Information** page, copy three values into `baton/.env`:

| Env var | Where it lives in Slack |
|---------|------------------------|
| `SLACK_CLIENT_ID` | App Credentials → Client ID |
| `SLACK_CLIENT_SECRET` | App Credentials → Client Secret |
| `SLACK_SIGNING_SECRET` | App Credentials → Signing Secret |
| `SLACK_OAUTH_REDIRECT_URI` | The exact redirect URL from the manifest: `https://baton.yourcompany.com/api/slack/oauth/callback` |

Optional: `SLACK_DEFAULT_CHANNEL` (defaults to `#baton-alerts`) - the fallback channel before you configure routing in the UI.

Restart the API container after editing the env:

```bash
docker compose up -d baton-api
```

## 3. Connect your workspace

In Baton, open **Notifications → Slack tab → Connect Slack**. You'll be sent through Slack's authorize screen; on approval Baton stores the workspace's bot token (encrypted, AES-256-GCM) and the tab switches to connected state. Then:

1. Flip the **master enable toggle** so Baton may post.
2. Under **Channel Routing**, pick the default channel and any per-event routing you want.
3. Send yourself a test from the same tab.

**Channel access:** public channels work immediately (`chat:write.public`). To post to a **private** channel, invite the bot first: `/invite @Baton` in that channel.

## 4. Optional - @Baton mentions

If you want the bot to respond when mentioned, enable the Events API on the app (**Event Subscriptions → Enable**, then subscribe to the `app_mention` bot event):

- **Request URL:** `https://baton.yourcompany.com/api/slack/events`
- Slack's URL-verification challenge is answered automatically - the URL turns "Verified" as soon as your instance is reachable.
- Every event is signature-verified with `SLACK_SIGNING_SECRET` and rejected otherwise (fail closed), so the endpoint is safe to expose.

After changing scopes or events on an already-installed app, Slack will prompt you to **reinstall** it to the workspace - do that, then reconnect in Baton if the tab asks.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Slack shows `redirect_uri did not match` | `SLACK_OAUTH_REDIRECT_URI` differs from the app's redirect URL - they must be byte-identical, including scheme and path |
| `?slack_error=invalid_state` / `state_expired` after authorize | The connect link was stale - start again from the Slack tab |
| Events URL won't verify | Instance not reachable on that URL, or `SLACK_SIGNING_SECRET` missing/wrong (the endpoint rejects unsigned requests) |
| Messages don't arrive in a private channel | The bot isn't a member - `/invite @Baton` there |
| `channel_not_found` on test | The configured channel was renamed/archived - re-pick it under Channel Routing |

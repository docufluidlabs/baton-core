# HubSpot Webhook Integration - Baton

## Overview

HubSpot integration is **webhook-only** (no OAuth). HubSpot sends POST requests to Baton when Contacts, Deals, or Companies are created/updated/deleted.

**Flow:**
- **Baton provides** → webhook URL (the endpoint HubSpot will send requests to)
- **HubSpot provides** → Client Secret (to verify signatures of incoming webhooks)

There are **two ways** to receive HubSpot webhooks:

| Method | URL | Verification | Best for |
|--------|-----|--------------|----------|
| **App Webhook** (recommended) | `/api/webhooks/app/:webhookKey` | Per-org webhook key in URL | Simple setup, multi-tenant |
| **Dedicated Route** | `/api/webhooks/hubspot` | HMAC-SHA256 v3 signature | HubSpot Private App subscriptions |

---

## Method 1: App Webhook (Recommended)

The simplest approach - no HubSpot Private App required.

### Step 1: Add HubSpot App in Baton UI

1. Go to the **Apps** page
2. Click **Add App** → select **HubSpot**
3. Copy the generated **Webhook URL**

The URL will look like:
```
https://your-domain.com/api/webhooks/app/abc123-def456-...
```

### Step 2: Configure HubSpot Workflows

In HubSpot, use **Workflows** to send webhooks to Baton:

1. In HubSpot: **Automation → Workflows**
2. Create a new workflow (e.g., "Send to Baton on Contact Created")
3. Trigger: **Contact is created** (or any trigger you need)
4. Add action: **Send a webhook**
   - Method: `POST`
   - URL: paste the Baton webhook URL from Step 1
   - Include all properties in the request body
5. Enable the workflow

Repeat for other objects (Deals, Companies) as needed.

### Step 3: Create an Automation Rule in Baton

1. Go to the **Automations** page in Baton
2. Click **Create Rule**
3. Source: **HubSpot**
4. Event type: e.g., `contact.created`
5. Select target workflow → save and activate

### Step 4: Test

```bash
curl -X POST https://your-domain.com/api/webhooks/app/YOUR_WEBHOOK_KEY \
  -H "Content-Type: application/json" \
  -d '[{
    "objectType": "CONTACT",
    "objectId": 123,
    "changeType": "CREATION",
    "subscriptionType": "contact.creation",
    "portalId": 12345678,
    "eventId": 1
  }]'
```

Expected response:
```json
{ "received": true, "eventId": "..." }
```

---

## Method 2: Dedicated Route (HubSpot Private App)

Use this if you have a HubSpot Private App with webhook subscriptions.

### Step 1: Create a HubSpot Private App

1. In HubSpot: **Settings → Integrations → Private Apps** (or Legacy Apps)
2. Create a new Private App
3. Go to the **Webhooks** tab → **Edit webhooks**
4. **Target URL**: `https://your-domain.com/api/webhooks/hubspot`
5. Subscribe to the required events: Contacts, Deals, Companies (creation/update/deletion)
6. Go to the **Auth** tab → click **Show secret** → copy the **Client Secret**

### Step 2: Configure Baton

Add the **Client Secret** from the HubSpot Private App to your `.env`:
```env
HUBSPOT_WEBHOOK_SECRET=your-hubspot-private-app-client-secret
```

HubSpot uses this client secret to sign webhooks (HMAC-SHA256 v3).

**How verification works (v3):**
1. HubSpot constructs a string: `POST` + request URL + request body + timestamp
2. Signs it with HMAC-SHA256 using the client secret
3. Base64-encodes the result and sends it in the `X-HubSpot-Signature-v3` header
4. Baton reproduces the same process and compares signatures (timing-safe)
5. Additionally validates `X-HubSpot-Request-Timestamp` - rejects requests older than 5 minutes

HubSpot documentation: https://developers.hubspot.com/docs/api/webhooks/validating-requests

### Step 3: Connection Matching

Baton resolves each incoming event to your org by matching the `portalId` in the payload against the `accountId` of a HubSpot record in the `platform-connections` table. Find your Portal ID in HubSpot under **Settings → Account Defaults → Account Info**.

Since HubSpot has no OAuth flow in Baton, there is currently no API endpoint to create this connection record - it must be inserted directly into the `baton-platform-connections` table (with `platform: "hubspot"` and `accountId` set to your portal ID). Events arriving without a matching connection are stored as **unmatched** and are visible in the Events UI.

For this reason, **Method 1 (App Webhook) is the recommended path** unless you specifically need Private App subscriptions.

### Step 4: Test

```bash
curl -X POST https://your-domain.com/api/webhooks/hubspot \
  -H "Content-Type: application/json" \
  -d '[{
    "objectType": "CONTACT",
    "objectId": 123,
    "changeType": "CREATION",
    "subscriptionType": "contact.creation",
    "portalId": 12345678,
    "eventId": 1
  }]'
```

> Note: Without `HUBSPOT_WEBHOOK_SECRET` set, signature verification is skipped (logged as a warning).

---

## Supported Event Types

| Event Type | Label | Description |
|------------|-------|-------------|
| `contact.created` | Contact Created | A new contact was created |
| `contact.updated` | Contact Updated | A contact was updated |
| `contact.deleted` | Contact Deleted | A contact was deleted |
| `deal.created` | Deal Created | A new deal was created |
| `deal.updated` | Deal Updated | A deal was updated |
| `deal.deleted` | Deal Deleted | A deal was deleted |
| `company.created` | Company Created | A new company was created |
| `company.updated` | Company Updated | A company was updated |
| `company.deleted` | Company Deleted | A company was deleted |
| `contact.*` | All Contact Events | Wildcard - any contact event |
| `deal.*` | All Deal Events | Wildcard - any deal event |
| `company.*` | All Company Events | Wildcard - any company event |

## HubSpot Webhook Payload Format

HubSpot sends events as a **JSON array** (batched):

```json
[
  {
    "objectType": "CONTACT",
    "objectId": 123456,
    "changeType": "CREATION",
    "subscriptionType": "contact.creation",
    "portalId": 12345678,
    "eventId": 1,
    "occurredAt": 1679000000000,
    "attemptNumber": 0
  }
]
```

Baton normalizes `changeType` as follows:
- `CREATION` → `created`
- `UPDATE` / `PROPERTYCHANGE` → `updated`
- `DELETION` → `deleted`
- `MERGE` → `updated`

## HubSpot Limitations
- Maximum 1,000 subscriptions per Private App
- Maximum 10 concurrent requests per app
- Each request can contain up to 100 events (batched)

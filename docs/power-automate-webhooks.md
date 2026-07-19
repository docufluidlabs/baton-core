# Microsoft Power Automate Webhook Integration - Baton

## Overview

Power Automate is **webhook-only** (no OAuth). A Power Automate cloud flow uses the premium **HTTP** action to `POST` events into Baton whenever something happens in Microsoft 365, Dataverse, SharePoint, Outlook, Teams, Forms, etc. Baton normalizes them into events like `invoice.approved` and runs them through the rule engine, which triggers the target Docusign Workflow Builder workflows.

Webhooks are received via the **App Webhook**:

| URL | Authentication | Setup |
|-----|----------------|-------|
| `/api/webhooks/app/:webhookKey` | **Basic Auth** (username + password) | "out of the box" via the app install wizard in the UI |

This is the same path used by Zoho CRM - see [zohocrm-webhooks.md](zohocrm-webhooks.md) for the shared App Webhook mechanics.

---

## ⭐ Most important: where to get the username and password

**You don't "get" them - you make them up yourself.**

The **Basic Auth Username / Password** fields in the Baton form are **not** your Microsoft login. They are an arbitrary credential pair that you:

1. **make up yourself** (any values - e.g. `baton-pa` / a long random string as the password),
2. enter into the Baton form while installing the app,
3. and then enter **the same values** on the HTTP action of your flow (Authentication → Basic).

The point: Basic Auth on an **inbound** webhook means "whoever knocks on this URL (your flow) must prove it's really them" - via a username/password pair known only to you and Baton.

---

## Setup

### Step 1. Install the Power Automate app in Baton

1. **Apps** page → find **Microsoft Power Automate** → **Install**.
2. The wizard immediately generates and shows a **Webhook URL** like:
   ```
   https://your-domain.com/api/webhooks/app/<webhookKey>
   ```
   Copy it.
3. In the **Basic Auth Credentials** fields, enter the **made-up** username and password (see the section above).
4. Give the app a name and click **Install**.

### Step 2. Add an HTTP action to your flow

1. In Power Automate, open (or create) a **cloud flow** with whatever trigger you need (e.g. "When an item is created" in SharePoint, "When a new response is submitted" in Forms).
2. Add a new step → search for **HTTP** (premium) → choose the **HTTP** action.
3. Configure it:
   - **Method**: `POST`
   - **URI**: paste the Baton webhook URL from Step 1
   - **Headers**: `Content-Type` → `application/json`
   - **Body**: a JSON object containing at least `event` and `recordId` (see [Payload format](#payload-format-and-normalization)). For example:
     ```json
     {
       "event": "item.created",
       "recordId": "@{triggerOutputs()?['body/ID']}",
       "summary": "New SharePoint item",
       "data": "@{triggerBody()}"
     }
     ```
4. Expand **Advanced parameters** → set **Authentication** to **Basic** → enter the **same** username/password from Step 1.
5. Save the flow.

### Step 3. Create an Automation Rule in Baton

1. **Automations** page → **Create Rule**.
2. **Source**: Microsoft Power Automate.
3. **Event type**: e.g. `item.created` (or the wildcard `*`). Any string you send in `event` works.
4. Select the target workflow → save and activate.

### Step 4. Testing

```bash
# username:password in the header - this is base64("baton-pa:your-password")
curl -X POST https://your-domain.com/api/webhooks/app/YOUR_WEBHOOK_KEY \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(printf 'baton-pa:your-password' | base64)" \
  -d '{ "event": "invoice.approved", "recordId": "INV-1001", "data": { "amount": 4200 } }'
```

Expected response:
```json
{ "received": true, "eventId": "..." }
```

Rejection checks (see [app.ts](../baton/src/routes/webhooks/app.ts)):
- no `Authorization` header → `401 { "error": "Missing Authorization header" }`
- wrong username/password → `401 { "error": "Invalid credentials" }`
- unknown `webhookKey` → `404`
- app deactivated → `403`

---

## Payload format and normalization

The body Baton expects (at minimum):
```json
{ "event": "invoice.approved", "recordId": "INV-1001" }
```

The connector ([powerautomate.connector.ts](../baton/src/services/connectors/powerautomate.connector.ts)) normalizes it:

| Field sent by the flow | Baton uses it as | Fallbacks |
|------------------------|------------------|-----------|
| `event` | event type (lowercased) | `eventType`, `event_type`, `type`, else `flow.triggered` |
| `recordId` | source record id | `record_id`, `id`, `data.id` |
| `summary` | human-readable summary | auto-generated from the event label + record id |
| `userEmail` | user attribution | `actingUserEmail`, `user.email` |
| `data` | passed through into event metadata | - |

The event type **is** whatever string you put in `event`. `invoice.approved` becomes event type `invoice.approved` with label "Invoice Approved".

---

## Supported event types

The catalog lists a few illustrative events for rule creation in the UI:

| Event Type | Description |
|------------|-------------|
| `flow.triggered` | Generic - a flow sent an event |
| `item.created` / `item.updated` | SharePoint / Dataverse / list item |
| `approval.completed` | A Power Automate approval finished |
| `form.submitted` | A Microsoft Forms response |
| `email.received` | An Outlook email arrived |
| `*` | Match any event string |

This is just the list for UI selection - **any** `event` string works.

---

## Caveats and gotchas

- **Premium connector.** Both the **HTTP** action (Power Automate → Baton) and the **"When a HTTP request is received"** trigger (Baton → Power Automate, not part of this phase) are premium connectors and require an appropriate Power Platform license.
- **No HMAC.** Power Automate's HTTP action has no built-in HMAC signing (there is no `hmacSha256` expression in the workflow definition language), so Baton uses **Basic Auth** for inbound verification - exactly like Zoho CRM. Use a long random password.
- **You make up the credentials.** The Basic Auth username/password is not your Microsoft login; you set them yourself and enter them identically in Baton and on the HTTP action.
- **Define the body envelope.** Always send at least `event`; otherwise the event type defaults to `flow.triggered` and rules keyed on a specific type won't match.
- **Idempotency.** Repeated deliveries are dropped in `storeWebhookEvent` (`event.id === 'duplicate'` → post-processing is skipped).

## Future work (not in this phase)

- **Baton → Power Automate (outbound):** add a new rule `actionType` so Baton can call a flow's **"When a HTTP request is received"** trigger URL (SAS-signed), turning Baton into a *source* that drives Microsoft 365 automations.
- **Custom Connector:** publish a Power Automate Custom Connector from Baton's OpenAPI spec ([docs/generator.ts](../baton/src/docs/generator.ts)) so users get a native "Baton → Launch Workflow" action instead of hand-configuring the HTTP action.

## Useful links
- Power Automate HTTP action: https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/http
- "When a HTTP request is received" trigger: https://learn.microsoft.com/en-us/power-automate/trigger-flow-http-request

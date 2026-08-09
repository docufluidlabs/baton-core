# Baton for Salesforce — what it installs and why it's safe

*For the Salesforce administrator being asked to install this package. Everything below is verifiable in your own org before you commit to anything.*

## What it is

Baton for Salesforce adds **one action to Flow Builder: "Send to Baton."** That's the whole feature.

You drop that action into a Flow you build and control — pick your own object, your own trigger conditions — and when it runs, it tells Baton "record X of type Y changed." Baton then starts the Docusign workflow your team configured.

The package does not create Flows for you, does not run on its own schedule, and does not change any existing automation. Until someone adds the action to a Flow, it does nothing at all.

## What data leaves your org

This is usually the first question, so here it is exactly. Each event sends nine values:

| Field | Example |
|---|---|
| Event ID | a random UUID generated per event |
| Organization ID | your Salesforce Org Id |
| User ID | the Id of the user whose action fired the Flow |
| Object API name | `Opportunity` |
| Record ID | `006...` |
| Event type | the literal string `flow.invoked` |
| Idempotency key | `<orgId>:<recordId>:<eventId>`, so replays are de-duplicated |
| Timestamp | epoch milliseconds |
| Attempt number | 1, 2, 3… for retries |

**No field values are sent.** Not the amount, not the account name, not the close date — nothing from the record itself. Baton receives a pointer, not your data.

That isn't a policy promise, it's a structural one: **the package contains no SOQL query against any business object.** It never reads the record. It converts the record Id into an object name using a describe call, which needs no data access, and sends the Id onward.

## What it does *not* do

- **No inbound access.** No REST endpoint, no SOAP web service, no Sites or guest-user access, no Connected App. Nothing outside your org can call into it.
- **No reading of your records**, as above.
- **No stored Salesforce credentials.** The package never holds a Salesforce token — it only makes outbound calls.
- **No `without sharing` code.** All seven production classes are declared `with sharing`.
- **Two outbound destinations only**, both HTTPS-only and both blocked unless the hostname is on an allowlist *and* has a Remote Site Setting you created. Plain HTTP is rejected outright.

## What lands in your org

| Component | Count | Notes |
|---|---|---|
| Apex classes | 7 | Namespaced `baton`; bodies are not editable |
| Custom setting | 1 | `BatonWebhookSecret__c` — Protected; stores the signing key |
| Custom metadata type + 1 record | 1 | The hostname allowlist |
| Permission sets | 2 | `Baton_User` (send), `Baton_Admin` (view registrations) |
| Custom permissions | 2 | `Baton_Send`, `Baton_Admin_Access` |
| Lightning component + tab | 1 each | A small admin panel showing what's registered |
| Sample Flow | 1 | Inactive. A worked example you can clone or delete |
| Remote site setting | 1 | For Baton's cloud host — you'll add your own, see below |

**Nobody can send anything until you grant permission.** The action refuses to run unless the running user holds the `Baton_Send` custom permission, checked at runtime on every call — so assigning the permission set is a deliberate act, not a default.

The signing key lives in a **Protected** custom setting, which means it is readable only by the package's own code — not by your users, not by other Apex in the org, and not through the admin panel, which deliberately never selects that field.

## Installing it (about 3 minutes)

1. Open the install link your Baton contact gave you.
2. Log into the target org. **Use a sandbox first** — see below.
3. Choose **Install for Admins Only**.
4. Assign the `Baton_User` permission set to whoever will run the Flows.

## Two extra steps if Baton is self-hosted

If your company runs Baton on its own server rather than Baton's cloud, the package needs to be told that your server is legitimate. Two short entries, about five minutes:

1. **Setup → Custom Metadata Types → Baton Allowed Host → Manage Records → New.** Add your Baton hostname (for example `baton.yourcompany.com`).
2. **Setup → Security → Remote Site Settings → New.** Add `https://baton.yourcompany.com`.

Both are required by Salesforce itself: no outbound call can reach a host you haven't explicitly approved. This is the mechanism that guarantees the package can only ever talk to servers *you* have named.

> **Use the exact hostname, with no redirect in front of it.** Apex does not follow redirects, so a host that forwards `baton.yourcompany.com` to `www.baton.yourcompany.com` will never deliver.

## How to verify all of this yourself

You don't have to take our word for any of it:

- **Install into a sandbox first** and wire up a test Flow. Nothing here behaves differently in production.
- **Watch what actually leaves.** Setup → Debug Logs on the user running the Flow shows the callout and its body — compare it against the nine fields listed above.
- **Confirm the destinations.** Remote Site Settings is the complete list of hosts this package can reach. Remove them and it can reach nothing.
- **Check the permissions.** Setup → Permission Sets shows exactly what each set grants.
- **Uninstall cleanly at any time.** Setup → Installed Packages → Uninstall. Salesforce removes every component listed above.

## Honest status

Baton for Salesforce is **not yet listed on AppExchange**, so it has not been through Salesforce's AppExchange Security Review. We are pursuing that listing; until it completes, this package is distributed as a direct install link.

We're saying that plainly because your review process should weigh it. What we can tell you is that every release build is gated in CI on the Salesforce Code Analyzer's security ruleset at Moderate severity and above, and that the behavior described in this document is verifiable by the steps in the previous section. This describes our engineering process, not a warranty — the software is provided as-is under its licence.

Questions, or something that doesn't match what you observe: **app-support@fluidlabs.com**.

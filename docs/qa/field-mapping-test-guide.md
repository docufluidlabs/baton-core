# QA Test Guide — Automation Field Mapping

**Feature:** Map webhook payload fields → Maestro workflow trigger inputs
**Location:** Flow Builder → New / Edit Automation panel → **Maestro API Parameters** section

---

## 1. What this feature does

When a webhook fires (e.g. from Zendesk), Baton launches a Maestro workflow.
**Field Mapping** controls *which value from the incoming webhook payload* is sent into
*each Maestro trigger input*.

Each mapping row answers one question:

> "Maestro input **X** should be filled with value **Y** taken from the webhook."

```
┌─────────────────────────────────────────┐
│ ticket_id                          🗑    │ ← TARGET: the Maestro input name
│ [ Path ▾ ]  [ $.ticket.id            ]   │ ← SOURCE: where the value comes from + how
└─────────────────────────────────────────┘
```

---

## 2. The three source types

| Type | What it does | Example source value | Result sent to Maestro |
|------|--------------|----------------------|------------------------|
| **Path** | Reads a value from the webhook payload by JSON path (dot notation). `$.` is added automatically if omitted. | `$.ticket.requester.email` | the actual email from the payload |
| **Static** | A fixed constant. The payload is ignored. | `production` | always `production` |
| **Template** | Text with `{{field}}` placeholders interpolated from the payload. | `Ticket #{{ticket.id}}` | `Ticket #12345` |

Example webhook payload used in the table above:
```json
{ "ticket": { "id": 12345, "requester": { "email": "a@b.com" } } }
```

---

## 3. Two UI modes (important)

The section behaves differently depending on whether the **target Maestro workflow has
published trigger inputs** (API parameters defined in Maestro).

### Mode A — Workflow HAS API parameters
- Each declared Maestro input appears as a **pre-filled row** with a fixed name, its data
  type (`string`, `number`, …) and a `required` marker.
- The tester only chooses the **source** (type + value) for each one.
- Required inputs that are left unmapped are highlighted in amber.

### Mode B — Workflow has NO API parameters
- An amber note "No API parameters found" is shown.
- The tester clicks **+ Add field** to create rows manually.
- In this mode the **target name is editable** (`maestro_input_name`) — you type the exact
  Maestro input name yourself.
- ⚠️ The target name must exactly match an input your Maestro workflow expects, otherwise
  the value will not land where intended.

> To switch a workflow from Mode B to Mode A: add the parameters in Maestro, then click the
> **Sync** (↻) button next to *Target Maestro Workflow*.

---

## 4. Preconditions before testing

1. A logged-in Baton account with at least one webhook source (e.g. Zendesk) connected.
2. At least one **active** Maestro workflow available as a target.
   - For Mode A testing: a workflow with trigger inputs defined in Maestro.
   - For Mode B testing: a workflow with no trigger inputs (e.g. "Test workflow").
3. A way to send a test webhook to the automation's **Permanent Webhook URL**
   (Postman / curl / the source platform's "send test" button).

---

## 5. Test cases

### TC-1 — Mapping rows appear for a workflow with parameters (Mode A)
1. Open Flow Builder → create or edit an automation.
2. Select a webhook source and a target workflow **that has API parameters**.
3. Scroll to **Maestro API Parameters**.

**Expected:** Each Maestro input is listed as a row with its name, type, and `required` tag.
Each row has a type dropdown (Path/Static/Template) and a source input.

---

### TC-2 — "Add field" works for a workflow without parameters (Mode B)
1. Select a target workflow **with no API parameters** (e.g. "Test workflow").

**Expected:** Amber "No API parameters found" note + an **+ Add field** button.

2. Click **+ Add field**.

**Expected:** A new row appears with an **editable** target name field
(`maestro_input_name`), a type dropdown, and a source input.

---

### TC-3 — Path mapping
1. Add a field. Target = `ticket_id`. Type = **Path**. Source = `$.ticket.id`
   (or just `ticket.id`).
2. Save the automation (Update / Create Automation).
3. Reopen the automation.

**Expected:**
- Save succeeds with a success toast.
- On reopen, the row is restored exactly (`ticket_id` → `$.ticket.id`, type Path).
- If `$.` was omitted on input, it is stored/displayed with `$.` prefix.

---

### TC-4 — Static mapping
1. Add a field. Target = `source_env`. Type = **Static**. Source = `production`.
2. Save and reopen.

**Expected:** Row restored as Static with value `production`.

---

### TC-5 — Template mapping
1. Add a field. Target = `summary`. Type = **Template**.
   Source = `Ticket #{{ticket.id}} from {{ticket.requester.email}}`.
2. Save and reopen.

**Expected:** Row restored as Template with the same string.

---

### TC-6 — Empty rows are ignored
1. Add a field but leave the **source** empty (only the target name filled, or nothing).
2. Save and reopen.

**Expected:** The empty row is dropped — it is not saved and does not appear after reopen.
No `$.` placeholder junk is stored.

---

### TC-7 — Delete a row
1. Add one or more custom rows.
2. Click the 🗑 (trash) icon on a row.

**Expected:** That row is removed immediately. Saving persists the removal.

---

### TC-8 — Required-input warning (Mode A only)
1. Use a workflow that has at least one **required** input.
2. Leave that required input's source empty.

**Expected:** An amber hint lists the required inputs that are not yet mapped.
(Note: this is a *warning only* — it does **not** block saving.)

---

### TC-9 — Editing an existing automation preserves mappings
1. Open an automation that already has field mappings saved.

**Expected:** All previously saved mappings are pre-filled correctly (target, type, source).

---

### TC-10 — End-to-end: webhook → Maestro
1. Configure a Path mapping, e.g. target `ticket_id` ← `$.ticket.id`.
2. Save the automation. Copy the **Permanent Webhook URL**.
3. Send a test webhook with a payload containing that field, e.g.:
   ```json
   { "ticket": { "id": 99999, "requester": { "email": "qa@test.com" } } }
   ```
4. Check the launched workflow instance (Instances sidebar / Maestro).

**Expected:** The Maestro instance is triggered, and the `ticket_id` trigger input
received the value `99999` (sent as a string).

---

### TC-11 — No mapping = pass-through by schema
1. Create an automation with **zero** field mappings.
2. Trigger a webhook whose payload field names match the workflow's inputs.

**Expected:** Baton auto-maps the raw payload to the workflow's declared inputs by name.
Payload fields that are **not** declared in the workflow schema are **not** sent.

---

## 6. Things to watch for / known behavior

- **Values are sent as strings.** Numbers/booleans from the payload arrive in Maestro as
  their string form (e.g. `12345` → `"12345"`).
- **Manual (Mode B) targets are passed through as-is** — no schema validation on the Baton
  side. A typo in the target name means the value goes to Maestro under the wrong key.
- **Mode A targets are constrained** to the names from the workflow schema, so they can't be
  mistyped.
- The required-input warning is **non-blocking** by design.
- Mapping changes only take effect **after Save** (Update / Create Automation).

---

## 7. Quick smoke checklist

- [ ] Mode A: rows auto-appear for a workflow with params
- [ ] Mode B: "Add field" adds an editable-target row
- [ ] Path / Static / Template each save and reload correctly
- [ ] Empty source rows are ignored on save
- [ ] Delete removes a row
- [ ] Required-not-mapped hint shows (Mode A) but doesn't block save
- [ ] End-to-end: value from payload reaches the Maestro trigger input

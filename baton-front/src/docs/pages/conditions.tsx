import { Lead, Callout, Cards, Card, TableWrap, FlowStrip, FlowNode, KV, KVRow } from '../ui';

export default function Conditions() {
  return (
    <>
      <h1>Conditions & field mapping</h1>
      <Lead>
        Most automations need no setup beyond picking a workflow - Baton matches payload fields to Workflow
        Builder parameters by name automatically. When you need more control, two optional layers let you
        filter which webhooks fire and rename payload fields.
      </Lead>

      <h2>The everyday path: automatic name-matching</h2>
      <p>
        By default, a verified webhook on an active automation simply fires its workflow. Baton reads the
        target workflow's parameter contract - the parameters its start trigger declares - scans the incoming
        payload, and matches whatever fits the parameter names. You don't configure anything: if the payload
        field is called <code>objectId</code> and the workflow declares <code>objectId</code>, Baton matches it
        and passes it through. The Edit Automation panel's <strong>Workflow Builder API Parameters</strong>{' '}
        section shows this list and lets you override where each value comes from.
      </p>

      <Callout type="note" title="Conditions are advanced controls">
        The everyday in-app experience uses the simpler "match by parameter name" model described above - no
        conditions required. Field mapping lives right in the automation editor (the Workflow Builder API
        Parameters section), while conditions are advanced controls available on request: the Baton team can
        configure them for you, or they can be set via the API. Read on to understand what they do and when to
        ask for them.
      </Callout>

      <h2>The per-webhook decision order</h2>
      <p>
        When a webhook arrives, Baton processes it through up to four stages. Conditions and field mapping slot
        in as the optional second and third stages.
      </p>

      <FlowStrip>
        <FlowNode k="Step 1" t="Verify signature" d="Fail = reject the webhook." />
        <FlowNode k="Step 2" t="Match conditions" d={'No match = skip, recorded as a "condition skip".'} />
        <FlowNode k="Step 3" t="Map fields" d="Build the workflow inputs from the payload." />
        <FlowNode k="Step 4" t="Trigger Workflow Builder" d="Fire the target workflow." />
      </FlowStrip>

      <h2>Conditions - filter which webhooks count</h2>
      <p>
        Conditions let you decide which webhooks should actually fire the workflow. A{' '}
        <strong>condition set</strong> has a top-level operator and a flat list of rules:
      </p>
      <KV>
        <KVRow label="Top-level operator">
          <code>and</code> means every rule must pass; <code>or</code> means any one rule passing is enough. The
          default is <code>and</code>.
        </KVRow>
        <KVRow label="Rules">
          A flat list. Each rule has a <strong>field</strong> (a dot-path into the payload, e.g.{' '}
          <code>data.contact.id</code>), an <strong>operator</strong>, and a <strong>value</strong>.
        </KVRow>
        <KVRow label="Empty set">
          An empty condition set always matches - so a webhook with no conditions configured always proceeds.
        </KVRow>
      </KV>

      <h3>Supported operators</h3>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Operator</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td><code>eq</code> / <code>neq</code></td><td>Equality / inequality.</td></tr>
            <tr><td><code>gt</code>, <code>gte</code>, <code>lt</code>, <code>lte</code></td><td>Numeric comparisons (greater / greater-or-equal / less / less-or-equal).</td></tr>
            <tr><td><code>in</code> / <code>not_in</code></td><td>Value is an array; the field must be (not) in it.</td></tr>
            <tr><td><code>contains</code> / <code>not_contains</code></td><td>Case-insensitive substring match.</td></tr>
            <tr><td><code>starts_with</code> / <code>ends_with</code></td><td>Case-insensitive prefix / suffix match.</td></tr>
            <tr><td><code>exists</code> / <code>not_exists</code></td><td>The field is present (not null/undefined) or not.</td></tr>
            <tr><td><code>regex</code></td><td>The value is a regular-expression pattern tested against the field.</td></tr>
          </tbody>
        </table>
      </TableWrap>
      <p>
        Comparisons coerce types reasonably - for example, the string <code>"123"</code> equals the number{' '}
        <code>123</code>.
      </p>

      <h3>Example condition set</h3>
      <p>This set fires only when a deal is closed-won <em>and</em> the amount is over 1000:</p>
      <pre><code>{`{
  "operator": "and",
  "rules": [
    { "field": "status", "operator": "eq", "value": "closed_won" },
    { "field": "amount", "operator": "gt", "value": 1000 }
  ]
}`}</code></pre>

      <h3>Failure messages in the Action log</h3>
      <p>
        When conditions don't match, the webhook is skipped and the reason is recorded. In <code>and</code>{' '}
        mode, the Action log shows which rule failed - for example{' '}
        <code>{'Condition 2 failed: field "status"'}</code>. In <code>or</code> mode, where no single rule is to
        blame, the reason reads <em>"No conditions matched"</em>.
      </p>

      <h2>Field mapping - rename payload fields to workflow parameters</h2>
      <p>
        Use field mapping when the source payload's field names don't match the workflow's parameter names.
        You map them explicitly: the <strong>keys</strong> are Workflow Builder trigger-input names, and the{' '}
        <strong>values</strong> are dot-paths into the payload (a leading <code>$.</code> is optional).
      </p>

      <pre><code>{`{
  "fieldMapping": {
    "approver_email": "$.contact.email",
    "amount_usd": "$.total.value"
  }
}`}</code></pre>

      <h3>Resolution rules and limits</h3>
      <ul>
        <li>
          A source path that resolves to nothing is dropped. Workflow Builder then errors if that input is
          required, or falls back to its own default.
        </li>
        <li>
          In the automation editor, each mapped field can read a payload <strong>Path</strong>, send a fixed{' '}
          <strong>Static</strong> value, or interpolate a <strong>Template</strong> like{' '}
          <code>{'{{field}}'}</code>.
        </li>
        <li>
          Field mapping does not compute or transform values beyond simple template interpolation.
        </li>
      </ul>

      <Callout type="warning" title="Transformations belong in Workflow Builder">
        If you need to do arithmetic or otherwise compute values, do that work inside the workflow's first
        step. Field mapping renames, selects, and templates existing payload values - it does not run logic.
      </Callout>

      <h2>When to use which</h2>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Goal</th><th>Use</th></tr>
          </thead>
          <tbody>
            <tr><td>"Only fire when X" / "skip test records"</td><td>Conditions</td></tr>
            <tr><td>"The payload calls it <code>objectId</code> but my workflow expects <code>contactId</code>"</td><td>Field mapping</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="flow-builder" title="Flow Builder">
          Create automations and see the parameters preview that drives name-matching.
        </Card>
        <Card to="workflows" title="Workflow Checker">
          See the start-trigger parameter contract each workflow declares.
        </Card>
      </Cards>
    </>
  );
}

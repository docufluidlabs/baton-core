import { Lead, Callout, Cards, Card, TableWrap, FlowStrip, FlowNode, KV, KVRow, DocLink } from '../ui';

export default function Conditions() {
  return (
    <>
      <h1>Conditions & field mapping</h1>
      <Lead>
        Most automations need no setup beyond picking a workflow - Baton matches payload fields to Docusign
        Workflow Builder parameters by name automatically. When you need more control, two optional layers let
        you filter which webhooks fire and say exactly where each parameter's value comes from.
      </Lead>

      <h2>The everyday path: automatic name-matching</h2>
      <p>
        By default, a verified webhook on an active automation simply fires its workflow. Baton reads the
        target workflow's parameter contract - the trigger inputs it publishes - scans the incoming payload,
        and matches whatever fits the parameter names. You don't configure anything: if the payload field is
        called <code>objectId</code> and the workflow declares <code>objectId</code>, Baton matches it and
        passes it through. The Edit Automation panel's <strong>Workflow Builder API Parameters</strong>{' '}
        section shows this list and lets you override where each value comes from.
      </p>
      <p>The matching is more forgiving than a literal string compare:</p>
      <ul>
        <li>
          Names are compared with case and separators ignored, so <code>Object ID</code>,{' '}
          <code>object_id</code>, <code>objectId</code> and <code>OBJECTID</code> are all the same name.
        </li>
        <li>
          Nested payload fields match on their last segment, so <code>data.objectId</code> fills a parameter
          named <code>objectId</code>. When two paths could fill the same parameter, the shallower one wins.
        </li>
        <li>
          A parameter with no match in the payload is left out of the launch request entirely rather than sent
          empty. Matched values are passed to Workflow Builder as strings.
        </li>
        <li>
          If the workflow publishes no trigger inputs at all, Baton flattens the payload instead and exposes
          each nested field under its short name as well as its full dot-path.
        </li>
      </ul>

      <Callout type="note" title="Conditions are an advanced control">
        The everyday in-app experience uses the simpler "match by parameter name" model described above - no
        conditions required. Field mapping lives right in the automation editor (the Workflow Builder API
        Parameters section), but there is no conditions editor in the app today: conditions are set through
        the automation API, as a <code>conditions</code> object on{' '}
        <code>POST /api/automations</code> or <code>PATCH /api/automations/:id</code>. Read on to understand
        what they do and when they are worth adding.
      </Callout>

      <h2>The per-webhook decision order</h2>
      <p>
        When a webhook arrives, Baton processes it through up to four stages. Conditions and field mapping slot
        in as the optional second and third stages.
      </p>

      <FlowStrip>
        <FlowNode k="Step 1" t="Verify the request" d="Fail = reject the webhook, nothing else runs." />
        <FlowNode k="Step 2" t="Match conditions" d="No match = the automation sits this one out." />
        <FlowNode k="Step 3" t="Map fields" d="Build the workflow inputs from the payload." />
        <FlowNode k="Step 4" t="Launch the workflow" d="Trigger the target workflow and log the relay." />
      </FlowStrip>
      <p>
        Step 1 uses whatever scheme the source platform supports - an HMAC signature, Basic Auth, or a secret
        token in the URL. See <DocLink to="verification">Webhook verification methods</DocLink> for the details
        per platform.
      </p>

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
          A flat list. Each rule has a <strong>field</strong> (a plain dot-path into the payload, e.g.{' '}
          <code>data.contact.id</code>), an <strong>operator</strong>, and a <strong>value</strong>. Unlike
          field mapping below, a condition field takes <em>no</em> <code>$.</code> prefix - a leading{' '}
          <code>$.</code> is read as part of the key and will never resolve.
        </KVRow>
        <KVRow label="Empty set">
          An empty condition set always matches, and so does one whose <code>rules</code> list is empty - a
          webhook with no conditions configured always proceeds.
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
            <tr><td><code>gt</code>, <code>gte</code>, <code>lt</code>, <code>lte</code></td><td>Numeric comparisons (greater / greater-or-equal / less / less-or-equal). A field that isn't a number never satisfies them.</td></tr>
            <tr><td><code>in</code> / <code>not_in</code></td><td>Value is an array; the field must be (not) in it.</td></tr>
            <tr><td><code>contains</code> / <code>not_contains</code></td><td>Case-insensitive substring match.</td></tr>
            <tr><td><code>starts_with</code> / <code>ends_with</code></td><td>Case-insensitive prefix / suffix match.</td></tr>
            <tr><td><code>exists</code> / <code>not_exists</code></td><td>The field is present (not null/undefined) or not.</td></tr>
            <tr><td><code>regex</code></td><td>The value is a regular-expression pattern tested against the field. A pattern that won't compile simply never matches.</td></tr>
          </tbody>
        </table>
      </TableWrap>
      <p>
        Longhand aliases are accepted for the common operators - <code>equals</code>, <code>not_equals</code>,{' '}
        <code>greater_than</code>, <code>greater_than_or_equal</code>, <code>less_than</code>,{' '}
        <code>less_than_or_equal</code> and <code>one_of</code> behave exactly like their short forms. Anything
        Baton doesn't recognize fails the rule rather than passing it.
      </p>
      <p>
        Equality compares the two sides as text, so types coerce the way you'd expect - the string{' '}
        <code>"123"</code> equals the number <code>123</code>.
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

      <h3>What a skip looks like</h3>
      <p>
        A skip is a non-event. The automation doesn't launch its workflow, and because Baton only logs a
        relay once a rule matches, nothing new appears in that automation's{' '}
        <DocLink to="logs">relay log</DocLink> either. That is the intended behavior - conditions exist to
        keep noise out - but it does mean the log can't tell you <em>why</em> a webhook you expected never
        ran.
      </p>

      <Callout type="warning" title="A skipped webhook leaves no trace on the automation">
        If an automation looks idle while the source platform insists it is sending events, check its
        conditions before you check anything else. Temporarily removing the condition set is the quickest way
        to confirm whether conditions are what's filtering the webhook out.
      </Callout>

      <h2>Field mapping - say where each parameter's value comes from</h2>
      <p>
        Use field mapping when the source payload's field names don't match the workflow's parameter names, or
        when a parameter should carry something the payload doesn't contain at all. You map them explicitly:
        the <strong>keys</strong> are Workflow Builder trigger-input names, and the <strong>values</strong> say
        where to read from. It lives on the automation's <code>actionConfig</code>:
      </p>

      <pre><code>{`{
  "actionConfig": {
    "fieldMapping": {
      "approver_email": "$.contact.email",
      "region": { "type": "static", "value": "EMEA" },
      "summary": { "type": "template", "template": "{{contact.name}} - {{total.value}}" }
    }
  }
}`}</code></pre>

      <p>
        The three forms match the three choices in the automation editor. A plain string is a{' '}
        <strong>Path</strong> - a dot-path into the payload, where a leading <code>$.</code> is optional.{' '}
        <strong>Static</strong> sends a fixed value regardless of the payload. <strong>Template</strong>{' '}
        interpolates payload values into a string with <code>{'{{field}}'}</code> placeholders, which also
        accept dot-paths; a placeholder that resolves to nothing becomes an empty string.
      </p>

      <Callout type="warning" title="Mapping one parameter turns off automatic matching for all of them">
        Field mapping replaces name-matching rather than supplementing it. The moment an automation has even
        one mapped parameter, Baton stops scanning the payload and sends only what the mapping produces -
        every other parameter is left out of the launch entirely, however obvious its name. If you map one,
        map them all.
      </Callout>

      <h3>Resolution rules and limits</h3>
      <ul>
        <li>
          A source path that resolves to nothing is dropped: the parameter is omitted from the launch request
          rather than sent blank, and Workflow Builder applies its own rules for a missing input.
        </li>
        <li>
          Use <strong>Add field</strong> in the Workflow Builder API Parameters section to map a parameter the
          workflow hasn't published - useful when a workflow has no published trigger inputs yet.
        </li>
        <li>
          Field mapping does not compute or transform values beyond template interpolation.
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
            <tr><td>"Every launch should carry the same fixed value"</td><td>Field mapping, Static</td></tr>
            <tr><td>"The names already line up"</td><td>Neither - leave both empty</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Bulk Upload maps its own way">
        Both layers on this page apply to webhook-driven automations. A Bulk Upload run has no webhook to
        filter, so it has no conditions - instead its wizard has a mapping step that pairs each file column
        with a workflow parameter, auto-matching headers by the same case- and separator-insensitive rule
        described above.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="flow-builder" title="Flow Builder">
          Create automations and see the parameters preview that drives name-matching.
        </Card>
        <Card to="workflows" title="Workflow Checker">
          See the trigger-input contract each workflow publishes.
        </Card>
        <Card to="logs" title="Relay logs & instances">
          Read what a launched relay recorded - and confirm what a skip didn't.
        </Card>
      </Cards>
    </>
  );
}

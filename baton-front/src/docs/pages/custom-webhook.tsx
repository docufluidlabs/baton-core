import { Lead, Callout, TableWrap, Steps, Step, Badge, FlowStrip, FlowNode, Cards, Card, DocLink } from '../ui';

export default function CustomWebhook() {
  return (
    <>
      <h1>Custom POST webhooks</h1>
      <Lead>A custom POST endpoint lets any source system that can send JSON - an internal app, a vendor portal, an IoT gateway - launch a Docusign Workflow Builder workflow through Baton, even if it is not in the catalog.</Lead>

      <h2>When to use a custom endpoint</h2>
      <p>Reach for a custom endpoint when your source is bespoke and you can pre-share a simple API key but cannot implement HMAC signing. When the source is a supported platform, use the catalog instead - it gives you native verification, the Add Platform wizard, and automations you can filter and field-map.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Consider</th><th>Catalog platform</th><th>Custom POST endpoint</th></tr></thead>
          <tbody>
            <tr><td>Best for</td><td>A supported source platform</td><td>A bespoke or internal source</td></tr>
            <tr><td>Verification</td><td>Native HMAC or Basic Auth</td><td>Optional static API key only - no signature</td></tr>
            <tr><td>Setup path</td><td>Add Platform wizard in Connections</td><td>The Baton API - see below</td></tr>
            <tr><td>Filtering</td><td>Rule conditions decide which events count</td><td>None - every accepted POST launches a run</td></tr>
            <tr><td>Field shaping</td><td>Field mapping per automation</td><td>Whole payload forwarded, plus one extracted record ID</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Custom endpoints are configured through the API">There is no screen for custom endpoints in the app yet. You create, update, and disable them with the <code>/api/webhook-endpoints</code> routes described below, which require an <strong>owner</strong>, <strong>admin</strong>, or <strong>superuser</strong> session. Everything else in this guide - the URL, the payload path, the API key - works exactly as described once the endpoint exists.</Callout>

      <h2>How a custom endpoint works</h2>
      <p>The lifecycle is short. You create the endpoint, hand its URL to your source system, and Baton does the rest on each POST:</p>

      <FlowStrip>
        <FlowNode k="You" t="Create the endpoint" d="Name it, pick a target Docusign workflow, and set a payload field path." />
        <FlowNode k="Baton" t="Returns a URL" d="Baton hands back a unique webhook URL, plus the API key if it generated one." />
        <FlowNode k="Source system" t="POSTs JSON" d="Your system sends a JSON payload to that URL." />
        <FlowNode k="Baton" t="Accepts & launches" d="Baton records the event, answers 200 right away, then queues the workflow launch." />
      </FlowStrip>

      <h2>Create the endpoint</h2>
      <p>Send a <code>POST /api/webhook-endpoints</code> request from an authenticated admin session with these fields:</p>
      <Steps>
        <Step title="name"> A label for the endpoint. It also appears in the launched instance's name, so make it recognizable.</Step>
        <Step title="platform"> A short source label used to attribute the events, for example <code>workday</code>. It is free text - it does not have to be a catalog platform.</Step>
        <Step title="workflowId"> The Docusign workflow this endpoint launches. It must already be synced and belong to your organization.</Step>
        <Step title="payloadFieldPath"> The dot-notation path to the record ID inside the incoming JSON (covered below).</Step>
        <Step title="generateApiKey or apiKey"> Optional. Set <code>generateApiKey: true</code> to have Baton mint a key, or pass your own in <code>apiKey</code>. Omit both to leave the endpoint unauthenticated.</Step>
        <Step title="rateLimitPerMinute"> Optional, defaults to <strong>60</strong> and accepts 1 to 10000.</Step>
      </Steps>
      <p>The response contains the endpoint's <code>webhookUrl</code> - paste that into your source system - and, on this one response only, the full <code>apiKey</code>. Save the key now; Baton masks it from then on.</p>

      <p>The URL Baton returns has this shape:</p>
      <pre><code>{`POST https://<your-baton-host>/api/postwebhook/<orgId>/<endpointId>`}</code></pre>

      <p>To change an endpoint later, use <code>PATCH /api/webhook-endpoints/:id</code> (this is also how you flip <code>enabled</code> on and off), <code>POST /api/webhook-endpoints/:id/regenerate-key</code> to rotate the API key, and <code>DELETE /api/webhook-endpoints/:id</code> to remove it.</p>

      <h2>Configuration options</h2>
      <TableWrap>
        <table>
          <thead><tr><th>Option</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><strong>name</strong></td><td>The endpoint's label, reused in the name of each workflow instance it launches.</td></tr>
            <tr><td><strong>platform</strong></td><td>A free-text source label the received events are attributed to. Fixed once the endpoint exists.</td></tr>
            <tr><td><strong>workflowId</strong></td><td>The Docusign workflow to launch on each accepted event.</td></tr>
            <tr><td><strong>payloadFieldPath</strong></td><td>Dot-notation path to the record ID in the payload. Required, and capped at 200 characters.</td></tr>
            <tr><td><strong>apiKey</strong> (optional)</td><td>A static token. If set, every request must send the header <code>X-API-Key: &lt;value&gt;</code> or it is rejected with 401. Returned in full only when it is created or regenerated; masked everywhere after that.</td></tr>
            <tr><td><strong>rateLimitPerMinute</strong></td><td>A per-endpoint cap, default <strong>60</strong>. Exceeding it returns 429 for the rest of the current 60-second window. The counter is held per API process, so a multi-replica deployment allows this many requests per replica.</td></tr>
            <tr><td><strong>enabled</strong></td><td><Badge color="green">enabled</Badge> or <Badge color="gray">disabled</Badge>. A disabled endpoint rejects everything with 403 and keeps its URL, so you can switch it back on without re-wiring the source.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Understanding the payload field path</h2>
      <p>The payload field path tells Baton where to find the record ID inside the JSON your system posts. It is written in dot notation, the leading <code>{'$.'}</code> is optional, and array positions are written as <code>items[0]</code>.</p>

      <pre><code>{`Path: data.contact.id
Payload:
{
  "data": { "contact": { "id": "7c2f-001" } }
}
→ Baton extracts  7c2f-001

Path: items[0].id
Payload:
{
  "items": [ { "id": 9912 }, { "id": 9913 } ]
}
→ Baton extracts  9912`}</code></pre>

      <h3>What Baton sends to Workflow Builder</h3>
      <p>The extracted value is not the only thing forwarded. Baton passes the <strong>whole top-level payload</strong> through as trigger inputs and adds the extracted record ID as <code>_recordId</code>. So the first example above sends the workflow two inputs: <code>data</code> and <code>_recordId</code>.</p>
      <p>Nested values are not flattened, which is what makes the field path worth setting: in that example <code>data</code> arrives as a whole object, while <code>_recordId</code> arrives as the plain string <code>7c2f-001</code>. Name your workflow's trigger parameters after the top-level keys your system already sends, and read the record ID from <code>_recordId</code>.</p>

      <Callout type="warning" title="An unresolved path does not stop the launch">If the path finds nothing, Baton does <em>not</em> reject the request. It accepts the POST, omits <code>_recordId</code>, and launches the workflow with the rest of the payload. A workflow that quietly starts without its record ID is the usual symptom of a wrong path, so test the endpoint with a real payload and confirm <code>_recordId</code> arrives.</Callout>

      <Callout type="note" title="Need conditions or field mapping?">A custom endpoint launches its workflow on every request it accepts - it cannot filter on payload contents, and it will not reshape fields for you. If you need to launch only on certain events, or to map several payload fields onto named workflow parameters, build a catalog-backed automation instead and use <DocLink to="conditions">conditions &amp; mapping</DocLink>.</Callout>

      <h2>What Baton returns</h2>
      <p>Baton checks each request in this order - endpoint lookup, enabled, API key, rate limit, then JSON parsing - and answers with the first failure it hits:</p>
      <TableWrap>
        <table>
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><Badge color="green">200</Badge></td><td>Accepted. Baton stored the event and queued the workflow launch.</td></tr>
            <tr><td><Badge color="amber">400</Badge></td><td>The body was not valid JSON.</td></tr>
            <tr><td><Badge color="red">401</Badge></td><td>The endpoint has an API key and the <code>X-API-Key</code> header was missing or wrong.</td></tr>
            <tr><td><Badge color="red">403</Badge></td><td>The endpoint is disabled.</td></tr>
            <tr><td><Badge color="red">404</Badge></td><td>No endpoint with that ID exists in that organization.</td></tr>
            <tr><td><Badge color="amber">429</Badge></td><td>The endpoint's per-minute rate limit was exceeded.</td></tr>
          </tbody>
        </table>
      </TableWrap>
      <p>Baton answers 200 as soon as it has stored the event, before the workflow actually launches, so your source system is never left waiting. That also means a launch failure cannot reach your source as an HTTP error - it is recorded in the <DocLink to="logs">relay log</DocLink> instead, which is where to look when a POST succeeded but no workflow started.</p>

      <h2>Security tradeoff</h2>
      <Callout type="warning" title="There is no signature verification">Custom endpoints do not verify a signature, so Baton cannot tell a genuine request from a forged one. Whoever holds the URL - plus the API key, if you set one - can launch your workflow at will, and there are no conditions in the way. Treat both like passwords: always set an API key, keep the URL out of shared docs and tickets, and prefer a catalog platform with real <DocLink to="verification">HMAC verification</DocLink> whenever your source supports it.</Callout>
      <p>If either value leaks, rotate the key with <code>POST /api/webhook-endpoints/:id/regenerate-key</code>. The old key stops working the moment the new one is issued, so update your source system at the same time. To stop traffic immediately while you investigate, <code>PATCH</code> the endpoint with <code>enabled: false</code> - it will reject every request with 403 until you re-enable it.</p>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="catalog" title="Supported platforms">Check whether your source is already in the catalog - if it is, you get native verification and richer handling.</Card>
        <Card to="verification" title="Verification methods">Compare HMAC, Basic Auth, and URL secrecy, and see what each asks of you.</Card>
        <Card to="conditions" title="Conditions &amp; mapping">The catalog-backed alternative when you need to filter events or map more than one field.</Card>
      </Cards>
    </>
  );
}

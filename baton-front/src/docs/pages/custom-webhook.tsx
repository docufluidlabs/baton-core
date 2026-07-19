import { Lead, Callout, TableWrap, Steps, Step, Badge, FlowStrip, FlowNode, Cards, Card } from '../ui';

export default function CustomWebhook() {
  return (
    <>
      <h1>Custom POST webhooks</h1>
      <Lead>A custom POST endpoint lets any source system that can send JSON - an internal app, a vendor portal, an IoT gateway - launch a Docusign Workflow Builder workflow through Baton, even if it is not in the catalog.</Lead>

      <h2>When to use a custom endpoint</h2>
      <p>Reach for a custom endpoint when your source is bespoke and you can pre-share a simple API key but cannot implement HMAC signing, or when you just want the smallest possible setup. When the source is a supported platform, use the catalog instead - it gives you richer per-platform handling, native HMAC, and the standard Add-Platform wizard.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Consider</th><th>Catalog platform</th><th>Custom POST endpoint</th></tr></thead>
          <tbody>
            <tr><td>Best for</td><td>A supported source platform</td><td>A bespoke or internal source</td></tr>
            <tr><td>Verification</td><td>Native HMAC or Basic Auth</td><td>Optional static API key only - no signature</td></tr>
            <tr><td>Setup path</td><td>Add-Platform wizard with per-platform steps</td><td>One small endpoint form</td></tr>
            <tr><td>Field shaping</td><td>Field mapping across many fields</td><td>Single record ID at one path</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Need more than one field?">For multi-field shaping, prefer a catalog-backed automation with field mapping. A custom endpoint extracts a single record ID from one path.</Callout>

      <h2>How a custom endpoint works</h2>
      <p>The lifecycle is short. You create the endpoint, hand its URL to your source system, and Baton does the rest on each POST:</p>

      <FlowStrip>
        <FlowNode k="You" t="Create the endpoint" d="Give it a name, a target Docusign workflow, and a payload field path." />
        <FlowNode k="Baton" t="Returns a URL" d="Baton hands back a unique webhook URL." />
        <FlowNode k="Source system" t="POSTs JSON" d="Your system sends a JSON payload to that URL." />
        <FlowNode k="Baton" t="Extracts & launches" d="Baton reads the record ID at the path and launches the workflow, responding 200 immediately." />
      </FlowStrip>

      <h2>Create the endpoint</h2>
      <Steps>
        <Step title="Give it a name"> A label that will appear in the Baton UI.</Step>
        <Step title="Choose the target workflow"> The Docusign workflow this endpoint should launch.</Step>
        <Step title="Set the payload field path"> The dot-notation path to the record ID inside the incoming JSON (covered below).</Step>
        <Step title="Set the optional API key, rate limit, and status"> Tune the security and availability options described below.</Step>
        <Step title="Copy the webhook URL"> Baton returns a unique URL. Paste it into your source system so it can POST events.</Step>
      </Steps>

      <h2>Configuration options</h2>
      <TableWrap>
        <table>
          <thead><tr><th>Option</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td><strong>name</strong></td><td>The label shown in the UI.</td></tr>
            <tr><td><strong>target workflow</strong></td><td>The Docusign workflow to launch on each accepted event.</td></tr>
            <tr><td><strong>payload field path</strong></td><td>Dot-notation path to the record ID in the payload. A missing path fails the webhook with a validation error.</td></tr>
            <tr><td><strong>API key</strong> (optional)</td><td>A static token. If set, every request must send the header <code>X-Api-Key: &lt;value&gt;</code> or it is rejected with 401. Stored masked.</td></tr>
            <tr><td><strong>rate limit per minute</strong></td><td>A per-endpoint cap. Exceeding it returns 429 until the next minute.</td></tr>
            <tr><td><strong>status</strong></td><td><Badge color="green">active</Badge> or <Badge color="gray">disabled</Badge>. A disabled endpoint rejects everything with 404.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Understanding the payload field path</h2>
      <p>The payload field path tells Baton where to find the record ID inside the JSON your system posts. It is written in dot notation, and the leading <code>{'$.'}</code> is optional. The extracted value is then passed to Workflow Builder under the parameter name the target workflow expects.</p>

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

      <p>If the path does not resolve to a value in the payload, Baton fails the webhook with a validation error rather than launching the workflow with nothing.</p>

      <h2>Security tradeoff</h2>
      <Callout type="warning" title="There is no signature verification">Custom endpoints do not verify a signature. A leaked URL - plus the API key, if you set one - is enough to forge events. Treat the webhook URL like a password: keep it secret, and rotate the endpoint if you suspect it has been exposed.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="catalog" title="Platform catalog">Check whether your source is already supported - the catalog gives you native verification and richer handling.</Card>
        <Card to="conditions" title="Conditions">Filter which incoming events actually launch a workflow using rule conditions.</Card>
      </Cards>
    </>
  );
}

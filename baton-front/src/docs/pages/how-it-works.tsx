import { Lead, FlowStrip, FlowNode, Steps, Step, KV, KVRow, Badge, Callout, TableWrap, Cards, Card } from '../ui';

export default function HowItWorks() {
  return (
    <>
      <h1>How Baton works</h1>
      <Lead>Baton listens for webhooks from your business platforms, launches the right Docusign Maestro workflow, and then watches that run so you can follow it without leaving Baton.</Lead>

      <h2>What Baton does, in one picture</h2>
      <p>Baton sits between your source platforms (Salesforce, HubSpot, Zendesk, BambooHR, and others) and Docusign Maestro. When a platform fires a webhook, Baton confirms the event is genuine, finds the value Maestro needs inside the payload, and triggers the matching workflow. From there, Maestro runs on its own and Baton keeps an eye on the result.</p>

      <FlowStrip>
        <FlowNode k="Source platform" t="Webhook fires" d="An event (deal won, record updated) sends a webhook to your automation's Baton URL." />
        <FlowNode k="Baton — Verify" t="Authenticate" d="Baton validates the HMAC signature or Basic Auth. Fail = rejected, nothing fires." />
        <FlowNode k="Baton — Route" t="Match & launch" d="Baton collects the parameters Maestro expects and launches the workflow." />
        <FlowNode k="Docusign Maestro" t="Runs the workflow" d="Maestro executes its own steps and returns a Maestro Instance ID." />
        <FlowNode k="Baton — Monitor" t="Poll & show status" d="Baton polls Maestro and updates the canvas and inbox live." />
      </FlowStrip>

      <h2>The end-to-end lifecycle, step by step</h2>
      <p>Here is everything that happens between a platform event and a finished Maestro run:</p>

      <Steps>
        <Step title="An event fires a webhook"> A source platform event hits the unique Baton webhook URL belonging to one of your automations.</Step>
        <Step title="Baton verifies the webhook"> Using HMAC signature or Basic Authentication, depending on the platform. If verification fails, the webhook is rejected and nothing downstream runs.</Step>
        <Step title="Baton matches the payload"> The target Maestro workflow's start trigger declares the parameter names and types it expects (for example <code>objectId</code>, <code>email</code>, <code>companyId</code>). Baton collects whatever in the payload fits that contract.</Step>
        <Step title="Conditions and field mapping apply (optional)"> Rule conditions can filter out webhooks you do not want, and field mapping can rename payload fields to the parameter names Maestro expects.</Step>
        <Step title="Baton routes the event"> It fires an authenticated POST to the Docusign Maestro API to launch the workflow, using your org's Docusign OAuth token. Maestro returns a Maestro Instance ID.</Step>
        <Step title="Maestro takes over"> Maestro runs the workflow's own steps independently of Baton.</Step>
        <Step title="Baton polls for status"> Baton asks Maestro for the instance status (Running, Completed, Failed, or Cancelled) so you can monitor the run from inside Baton.</Step>
        <Step title="Your screens update live"> The Flow Builder canvas and the Notifications Inbox refresh with current status.</Step>
      </Steps>

      <h2>The two phases Baton owns: Verify, then Route</h2>
      <p>Although the lifecycle has many steps, Baton's own responsibility is just two phases. Everything before is your source platform; everything after the launch is Maestro.</p>

      <KV>
        <KVRow label={<><Badge color="blue">Phase 1</Badge> Verify</>}>Confirm the webhook is authentic. Baton checks the HMAC signature or Basic Auth credentials before anything else happens.</KVRow>
        <KVRow label={<><Badge color="blue">Phase 2</Badge> Route</>}>Match the payload to the workflow's parameter contract and launch the workflow through the Docusign Maestro API.</KVRow>
      </KV>

      <Callout type="note" title="Baton always answers quickly">Baton responds with HTTP 200 right away so your source platform does not retry the webhook. If something goes wrong, the failure is surfaced in Baton's logs, not in the HTTP response the platform sees.</Callout>

      <h2>Maestro drives the contract</h2>
      <p>Baton does not hardcode which field is the identifier for any platform. Instead, the Maestro workflow declares the parameter names it expects in its start trigger, and Baton matches them against the incoming payload.</p>
      <p>For example, if the workflow's start trigger expects a parameter named <code>objectId</code> and the webhook payload contains that same key:</p>

      <pre><code>{`Maestro start trigger expects:  objectId  (string)

Incoming webhook payload:
{
  "objectId": 757533273294,
  "email": "buyer@example.com"
}

Baton matches objectId → launches the workflow
Resulting Maestro instance is tagged  #757533273294`}</code></pre>

      <p>To use a different field as the identifier, you design the Maestro workflow to expect that parameter name. The resulting instance is tagged with the matched id (for example <code>#757533273294</code>), so you can always trace a run back to the source record that started it.</p>

      <Callout type="tip" title="If a field name does not match">If your payload uses a different key (say <code>recordId</code> instead of <code>objectId</code>), use field mapping in the automation to rename it to the parameter the workflow expects.</Callout>

      <h2>Where Baton ends and Maestro begins</h2>
      <p>Baton triggers and monitors; Maestro runs the work. Keeping that boundary clear helps you know where to look when you have a question about a run.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Responsibility</th><th>Owned by Baton</th><th>Owned by Maestro</th></tr></thead>
          <tbody>
            <tr><td>Receiving the webhook</td><td>Yes</td><td>No</td></tr>
            <tr><td>Verifying authenticity</td><td>Yes</td><td>No</td></tr>
            <tr><td>Matching payload to parameters</td><td>Yes</td><td>No</td></tr>
            <tr><td>Launching the workflow</td><td>Yes (the trigger)</td><td>No</td></tr>
            <tr><td>Running the workflow's steps</td><td>No</td><td>Yes</td></tr>
            <tr><td>Extension app steps</td><td>No</td><td>Yes</td></tr>
            <tr><td>Reporting run status back to you</td><td>Yes (polls Maestro)</td><td>Yes (source of truth)</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Baton complements Maestro — it does not replace it">Baton does not run workflow steps of its own. Once a workflow launches, Maestro runs its steps independently, including any extension apps. Baton's job is to trigger the right workflow and then show you how the run is going.</Callout>

      <h2>The four Maestro instance states</h2>
      <p>Each launched workflow becomes a Maestro instance with one of these states, which Baton polls and displays:</p>

      <TableWrap>
        <table>
          <thead><tr><th>State</th><th>What it means</th></tr></thead>
          <tbody>
            <tr><td><Badge color="blue">Running</Badge></td><td>Maestro is actively working through the workflow's steps.</td></tr>
            <tr><td><Badge color="green">Completed</Badge></td><td>The workflow finished all of its steps successfully.</td></tr>
            <tr><td><Badge color="red">Failed</Badge></td><td>The workflow stopped on an error before finishing.</td></tr>
            <tr><td><Badge color="gray">Cancelled</Badge></td><td>The run was stopped before it could complete.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="concepts" title="Core concepts">The key terms — automation, connection, action, instance, and more — explained for admins.</Card>
        <Card to="quick-start" title="Quick start">A hands-on walkthrough to connect Docusign and wire your first live automation.</Card>
      </Cards>
    </>
  );
}

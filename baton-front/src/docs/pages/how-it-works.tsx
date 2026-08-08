import { Lead, FlowStrip, FlowNode, Steps, Step, KV, KVRow, Badge, Callout, TableWrap, Cards, Card, DocLink } from '../ui';

export default function HowItWorks() {
  return (
    <>
      <h1>How Baton works</h1>
      <Lead>Baton listens for webhooks from your business platforms, launches the right Docusign Workflow Builder workflow, and then watches that run so you can follow it without leaving Baton.</Lead>

      <h2>What Baton does, in one picture</h2>
      <p>Baton sits between your source platforms (Salesforce, HubSpot, Zendesk, Smartsheet, BambooHR, and others) and Docusign Workflow Builder. When a platform fires a webhook, Baton confirms the event is genuine, finds the values Workflow Builder needs inside the payload, and triggers the matching workflow. From there, Workflow Builder runs on its own and Baton keeps an eye on the result.</p>

      <FlowStrip>
        <FlowNode k="Source platform" t="Webhook fires" d="An event (deal won, record updated) sends a webhook to your automation's Baton URL." />
        <FlowNode k="Baton - Verify" t="Authenticate" d="Baton checks the platform's signature, credentials, or token. Fail = 401, nothing fires." />
        <FlowNode k="Baton - Route" t="Match & launch" d="Baton collects the parameters Workflow Builder expects and launches the workflow." />
        <FlowNode k="Docusign Workflow Builder" t="Runs the workflow" d="Workflow Builder executes its own steps and returns a Workflow Builder Instance ID." />
        <FlowNode k="Baton - Monitor" t="Poll & show status" d="Baton polls Workflow Builder every 30 seconds and refreshes your screens with the result." />
      </FlowStrip>

      <h2>The end-to-end lifecycle, step by step</h2>
      <p>Here is everything that happens between a platform event and a finished workflow run:</p>

      <Steps>
        <Step title="An event fires a webhook"> A source platform event hits the unique Baton webhook URL belonging to one of your automations.</Step>
        <Step title="Baton verifies the webhook"> Using whichever method that platform supports - an HMAC signature, Basic Authentication, a shared token, or, for platforms that cannot sign at all, the secrecy of the URL itself. If verification fails, Baton answers <code>401</code>, the webhook is rejected, and nothing downstream runs. See <DocLink to="verification">Verification methods</DocLink>.</Step>
        <Step title="Baton records the event and answers immediately"> The verified webhook is stored in Baton and queued for processing, and the platform gets its <code>200</code> straight away. Every step after this one happens in the background.</Step>
        <Step title="Baton matches the payload"> The target Docusign workflow's start trigger declares the parameter names it expects (for example <code>objectId</code>, <code>email</code>, <code>companyId</code>). Baton collects whatever in the payload fits that contract.</Step>
        <Step title="Conditions and field mapping apply (optional)"> Rule conditions can filter out webhooks you do not want, and field mapping can rename payload fields to the parameter names Workflow Builder expects.</Step>
        <Step title="Baton routes the event"> It fires an authenticated POST to the Docusign Workflow Builder API to launch the workflow, using your org's Docusign OAuth token. Workflow Builder returns a Workflow Builder Instance ID. If that call errors, Baton <DocLink to="logs">retries automatically</DocLink> before giving up.</Step>
        <Step title="Workflow Builder takes over"> Workflow Builder runs the workflow's own steps independently of Baton.</Step>
        <Step title="Baton polls for status"> Every 30 seconds Baton asks Workflow Builder for the status of each running instance (Running, Completed, Failed, or Cancelled) so you can monitor the run from inside Baton.</Step>
        <Step title="Your screens update live"> The Flow Builder canvas, the <DocLink to="control-center">Control Center</DocLink>, and the Notifications Inbox refresh with current status.</Step>
      </Steps>

      <Callout type="note" title="A webhook is not the only way a workflow starts">Two surfaces launch workflows without any inbound webhook. <strong>Bulk Upload</strong> takes a CSV, XLSX, or TSV file and launches one workflow per row on a throttle you set, and the <strong>Workflow Checker</strong> launches a single workflow by hand so you can test it. Both skip the Verify phase and join the lifecycle at Route, so everything from there on - launching, polling, and the screens that show the result - works exactly as described above.</Callout>

      <h2>The two phases Baton owns: Verify, then Route</h2>
      <p>Although the lifecycle has many steps, Baton's own responsibility is just two phases. Everything before is your source platform; everything after the launch is Workflow Builder.</p>

      <KV>
        <KVRow label={<><Badge color="blue">Phase 1</Badge> Verify</>}>Confirm the webhook is authentic. Baton checks the platform's signature, credentials, or token before anything else happens.</KVRow>
        <KVRow label={<><Badge color="blue">Phase 2</Badge> Route</>}>Match the payload to the workflow's parameter contract and launch the workflow through the Docusign Workflow Builder API.</KVRow>
      </KV>

      <Callout type="note" title="Baton answers before it does the work">Once a webhook passes verification, Baton stores it, replies HTTP 200, and does the matching and launching in the background. A slow or failing launch therefore never becomes a webhook timeout or a retry storm from your platform - the failure shows up in Baton's relay log instead. A webhook that fails verification never reaches that stage: it is rejected with 401 on the spot.</Callout>

      <h2>Workflow Builder drives the contract</h2>
      <p>Baton does not hardcode which field is the identifier for any platform. Instead, the Docusign workflow declares the parameter names it expects in its start trigger, and Baton matches them against the incoming payload.</p>
      <p>For example, if the workflow's start trigger expects a parameter named <code>objectId</code> and the webhook payload contains that same key:</p>

      <pre><code>{`Workflow Builder start trigger expects:  objectId  (string)

Incoming webhook payload:
{
  "objectId": 757533273294,
  "email": "buyer@example.com"
}

Baton matches objectId → launches the workflow
Resulting instance:  Deal Won #757533273294 - 2026-08-08 14:22:05`}</code></pre>

      <p>To use a different field as the identifier, you design the Docusign workflow to expect that parameter name. The resulting instance is named after the automation and tagged with the matched id (for example <code>#757533273294</code>), so you can always trace a run back to the source record that started it.</p>

      <p>Matching is forgiving about formatting. Baton compares names case-insensitively and ignores spaces, dashes, and underscores, and it looks a few levels into nested payloads - so a start trigger input named <code>objectId</code> still matches a payload key written <code>object_id</code>, <code>Object ID</code>, or <code>data.objectId</code>. Values are passed to Workflow Builder as strings, so a numeric id in the payload is fine.</p>

      <Callout type="tip" title="If the names are genuinely different">Near-misses match on their own, but <code>recordId</code> and <code>objectId</code> are two different names. When that happens, use <DocLink to="conditions">field mapping</DocLink> in the automation to point the workflow's parameter at the payload key you actually receive.</Callout>

      <h2>Where Baton ends and Workflow Builder begins</h2>
      <p>Baton triggers and monitors; Workflow Builder runs the work. Keeping that boundary clear helps you know where to look when you have a question about a run.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Responsibility</th><th>Owned by Baton</th><th>Owned by Workflow Builder</th></tr></thead>
          <tbody>
            <tr><td>Receiving the webhook</td><td>Yes</td><td>No</td></tr>
            <tr><td>Verifying authenticity</td><td>Yes</td><td>No</td></tr>
            <tr><td>Matching payload to parameters</td><td>Yes</td><td>No</td></tr>
            <tr><td>Launching the workflow</td><td>Yes (the trigger)</td><td>No</td></tr>
            <tr><td>Running the workflow's steps</td><td>No</td><td>Yes</td></tr>
            <tr><td>Extension app steps</td><td>No</td><td>Yes</td></tr>
            <tr><td>Reporting run status back to you</td><td>Yes (polls Workflow Builder)</td><td>Yes (source of truth)</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Baton complements Workflow Builder - it does not replace it">Baton does not run workflow steps of its own. Once a workflow launches, Workflow Builder runs its steps independently, including any extension apps. Baton's job is to trigger the right workflow and then show you how the run is going.</Callout>

      <h2>The four workflow instance states</h2>
      <p>Each launched workflow becomes a workflow instance with one of these states, which Baton polls and displays:</p>

      <TableWrap>
        <table>
          <thead><tr><th>State</th><th>What it means</th></tr></thead>
          <tbody>
            <tr><td><Badge color="blue">Running</Badge></td><td>Workflow Builder is actively working through the workflow's steps.</td></tr>
            <tr><td><Badge color="green">Completed</Badge></td><td>The workflow finished all of its steps successfully.</td></tr>
            <tr><td><Badge color="red">Failed</Badge></td><td>The workflow stopped on an error before finishing.</td></tr>
            <tr><td><Badge color="gray">Cancelled</Badge></td><td>The run was stopped before it could complete.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p><strong>Overdue</strong> is not a fifth state. It is Baton's own view of a run that is still Running but has been running longer than you expected - you set the number of days, and the <DocLink to="control-center">Control Center</DocLink> collects those runs on their own tab so a signature nobody chased does not sit unnoticed.</p>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="concepts" title="Core concepts">The key terms - automation, connection, relay, instance, and more - explained for admins.</Card>
        <Card to="quick-start" title="Quick start">A hands-on walkthrough to connect Docusign and wire your first live automation.</Card>
        <Card to="control-center" title="Control Center">Failed and overdue runs in one queue - retry, cancel, or postpone without leaving the page.</Card>
      </Cards>
    </>
  );
}

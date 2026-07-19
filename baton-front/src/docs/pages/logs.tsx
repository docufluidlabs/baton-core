import { Lead, Callout, TableWrap, FlowStrip, FlowNode, KV, KVRow, Badge, Cards, Card, DocLink } from '../ui';

export default function Logs() {
  return (
    <>
      <h1>Action logs & instances</h1>
      <Lead>
        Two panels give you the full history of what happened: the Action log shows every webhook your
        automation handled, and the Instances panel shows every run a workflow produced.
      </Lead>

      <h2>Action logs (per automation)</h2>
      <p>
        Open the Action log from the <strong>Logs</strong> button on an automation card in the Flow Builder. It
        lists every <strong>Action</strong> that automation has processed, newest first.
      </p>

      <h3>What one Action is</h3>
      <p>
        An Action is one webhook's complete lifecycle - received, verified, and routed, or rejected along the
        way. Baton handles every webhook in two steps: <strong>Verify</strong> (confirm the signature) then{' '}
        <strong>Route</strong> (launch the Docusign workflow). One Action covers both steps from end to end.
      </p>

      <FlowStrip>
        <FlowNode k="Step 1" t="Verify" d="Check the webhook's signature against the automation's secret." />
        <FlowNode k="Step 2" t="Route" d="Match the parameters and launch the target Docusign workflow." />
      </FlowStrip>

      <h3>What an expanded row shows</h3>
      <p>Click a row to expand it. The expanded view shows:</p>
      <ul>
        <li>The two-step <strong>Verify → Route</strong> lifecycle</li>
        <li>The <strong>Webhook ID</strong>, <strong>Action ID</strong>, and <strong>Workflow Builder Instance ID</strong> - all copyable</li>
        <li>The verification status, with a reason shown on failure</li>
        <li>The full raw webhook payload, behind a <strong>View Payload</strong> toggle</li>
        <li>Retry history, if the Action had any retries</li>
      </ul>

      <h3>Action statuses</h3>
      <p>Each Action carries one status that tells you exactly where it landed:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Status</th><th>What it means</th></tr>
          </thead>
          <tbody>
            <tr><td><Badge color="green">verified+launched</Badge></td><td>Both steps passed - the webhook was verified and the workflow launched.</td></tr>
            <tr><td><Badge color="red">verification_failed</Badge></td><td>The signature didn't match. Nothing was sent to Workflow Builder.</td></tr>
            <tr><td><Badge color="amber">validation_error</Badge></td><td>The payload didn't carry the required parameters. Inspect the payload to see what was missing.</td></tr>
            <tr><td><Badge color="gray">condition_skip</Badge></td><td>Rule conditions filtered this webhook out - intentionally skipped.</td></tr>
            <tr><td><Badge color="red">upstream_error</Badge></td><td>Workflow Builder returned an error; retries are in progress or exhausted.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h3>Queued webhooks when an automation is paused</h3>
      <p>
        When you pause an automation, incoming webhooks don't get dropped - they <strong>queue up</strong> and
        are shown inline in the Action log. For each queued entry you have two choices:
      </p>
      <KV>
        <KVRow label="Release">Process the queued webhook now.</KVRow>
        <KVRow label="Cancel">Drop the queued webhook.</KVRow>
      </KV>
      <p>This lets you fix a misconfiguration while paused without losing any legitimate webhook history.</p>

      <h2>Instances (per workflow)</h2>
      <p>
        Open the Instances panel from the <strong>View Instances</strong> button on a workflow card. It lists
        every instance for that workflow, newest first.
      </p>

      <h3>What each row shows</h3>
      <ul>
        <li>A status badge - Completed, Running, Failed, or Cancelled</li>
        <li>The triggering automation and the matched object ID</li>
        <li>The started timestamp</li>
        <li>The current or last step, with progress - for example <code>3/3</code></li>
        <li>The inputs Workflow Builder received - for example <code>objectId: 757533…</code></li>
      </ul>

      <h3>Row actions</h3>
      <KV>
        <KVRow label="Retry">Re-launch the instance with the same inputs. It then appears under <strong>In Progress</strong> in the <DocLink to="control-center">Resolution Center</DocLink>.</KVRow>
        <KVRow label="Cancel">Ask Workflow Builder to cancel a running instance.</KVRow>
        <KVRow label="Report Issue">Open a form that sends a support ticket to the Baton team. Whether you've reported an instance is remembered in your browser, so the "Reported" badge persists.</KVRow>
        <KVRow label="Detail">Open the in-Baton instance detail view.</KVRow>
        <KVRow label="Open in Docusign">Deep-link to the instance in Docusign Workflow Builder.</KVRow>
      </KV>

      <h3>The four instance states</h3>
      <p>
        After Baton triggers a workflow, Workflow Builder runs it independently. Baton periodically polls
        Workflow Builder for instance status so you can monitor from inside Baton without opening Docusign.
        Every instance is in one of four states:
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>State</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td><Badge color="blue">Running</Badge></td><td>The instance is executing.</td></tr>
            <tr><td><Badge color="green">Completed</Badge></td><td>The instance finished successfully.</td></tr>
            <tr><td><Badge color="red">Failed</Badge></td><td>The instance errored mid-run.</td></tr>
            <tr><td><Badge color="gray">Cancelled</Badge></td><td>The instance was stopped before completion.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        The per-instance detail view shows the triggering automation and matched object ID, the timestamp, a
        progress bar with step count, the current or final step description, and <strong>Detail</strong> +{' '}
        <strong>Open in Docusign</strong> links.
      </p>

      <Callout type="note" title="Status can be briefly stale">
        For long-running instances, Workflow Builder can take a few minutes to update. The panel may show
        slightly stale data while Baton polls for the latest status - it catches up on its own.
      </Callout>

      <h2>Automatic retries</h2>
      <p>
        Baton's job is two phases - <strong>Verify</strong> then <strong>Route</strong> - and failures are
        handled differently depending on where they happen:
      </p>
      <ul>
        <li><strong>Verification fails</strong> (the HMAC or Basic Auth signature didn't match): the Action is marked failed, nothing fires to Workflow Builder, and it's logged.</li>
        <li><strong>Parameter match returns nothing</strong> (the payload didn't contain the fields the workflow expects): the Action is marked <Badge color="amber">validation_error</Badge>, and you can inspect the payload.</li>
        <li><strong>Routing fails</strong> (the Workflow Builder API returned an error): Baton retries automatically up to <strong>6 times</strong> with exponential backoff. If all retries are exhausted, the Action is marked <Badge color="red">upstream_error</Badge> and an <strong>Automation Failed</strong> notification fires.</li>
      </ul>

      <h3>The retry schedule</h3>
      <p>There are 7 total attempts including the first, all completing within roughly 50 minutes:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Attempt</th><th>Delay from previous</th></tr>
          </thead>
          <tbody>
            <tr><td>1 (initial)</td><td>-</td></tr>
            <tr><td>2</td><td>2 seconds</td></tr>
            <tr><td>3</td><td>4 seconds</td></tr>
            <tr><td>4</td><td>8 seconds</td></tr>
            <tr><td>5</td><td>5 minutes</td></tr>
            <tr><td>6</td><td>15 minutes</td></tr>
            <tr><td>7 (final)</td><td>30 minutes</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        Every individual retry attempt is logged on the Action with its timestamp and the upstream error, so
        you can reconstruct the full failure history. A retry that eventually succeeds counts as{' '}
        <strong>one</strong> Action - not one per attempt.
      </p>

      <Callout type="note" title="Retries are built in">
        Automatic routing retries are part of Baton's core behavior - every automation gets the same
        schedule, with nothing to configure.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="control-center" title="Resolution Center">Your fix-it queue for failed instances - Retry, Cancel, or Report Issue in one place.</Card>
        <Card to="notifications" title="Notifications & alerts">Get an Automation Failed alert the moment all retries are exhausted.</Card>
      </Cards>
    </>
  );
}

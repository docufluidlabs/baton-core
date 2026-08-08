import { Lead, Callout, TableWrap, FlowStrip, FlowNode, KV, KVRow, Badge, Cards, Card, DocLink } from '../ui';

export default function Logs() {
  return (
    <>
      <h1>Relay logs & instances</h1>
      <Lead>
        Two panels give you the full history of what happened: the relay log shows every webhook one
        automation handled, and the Activity Log shows every run your workflows produced.
      </Lead>

      <Callout type="note" title="Relays were previously called Actions">
        Older release notes call a relay an <strong>Action</strong> - they mean the same thing: one webhook,
        one automation, one attempt to launch a workflow. Every label on screen says relay: the panel counts{' '}
        <strong>N relays</strong>, each entry is <strong>Relay 1</strong>, <strong>Relay 2</strong> and so on,
        and the copyable id is the <strong>Relay ID</strong>.
      </Callout>

      <h2>Relay logs (per automation)</h2>
      <p>
        Open the relay log from the <strong>Logs</strong> button on an automation card in the Flow Builder. It
        lists every relay that automation has processed, newest first, with a search box, status filter chips
        and a page-size selector. The panel never dims the canvas, so you can keep working behind it - close it
        with the X or the Escape key.
      </p>

      <h3>What one relay is</h3>
      <p>
        A relay is one webhook's complete lifecycle - received, verified, and routed, or rejected along the
        way. Baton handles every webhook in two steps: <strong>Verify</strong> (confirm the signature) then{' '}
        <strong>Route</strong> (launch the Docusign workflow). One relay covers both steps from end to end.
      </p>

      <FlowStrip>
        <FlowNode k="Step 1" t="Webhook verification" d="Check the webhook's signature or token against the automation's secret." />
        <FlowNode k="Step 2" t="Workflow Builder Trigger" d="Match the parameters and launch the target Docusign workflow." />
      </FlowStrip>

      <p>
        Those are the exact stage names you'll see inside an expanded row. A webhook that matches no automation,
        or that <DocLink to="conditions">conditions</DocLink> filter out, never becomes a relay - so it does not
        appear in this log at all.
      </p>

      <h3>What an expanded row shows</h3>
      <p>Click a row to expand it. The expanded view shows:</p>
      <ul>
        <li>The <strong>Webhook ID</strong>, <strong>Relay ID</strong>, and <strong>Workflow Builder Instance ID</strong> - all copyable</li>
        <li>The triggered timestamp, a completed marker, and a live <code>Retry 2/6</code> counter while retries are running</li>
        <li>The two stages, <strong>Webhook verification</strong> and <strong>Workflow Builder Trigger</strong>, each with its own status</li>
        <li>The full raw webhook payload, behind a <strong>View Payload</strong> toggle with a copy button</li>
        <li>A plain-language message on failure, plus the raw upstream error</li>
        <li>A <strong>Retry now</strong> button when the launch failed or is mid-retry, with a countdown to the next automatic attempt</li>
      </ul>

      <Callout type="note" title="Very large payloads are stored trimmed">
        Payloads over 50,000 characters are kept as a 500-character preview plus the original size, so one
        oversized webhook can't crowd out the rest of your history. Everything smaller is stored in full.
      </Callout>

      <h3>Relay statuses</h3>
      <p>
        A relay's job ends the moment the workflow is triggered - whatever happens to the instance afterwards
        belongs to the Activity Log. That gives three outcomes:
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Status</th><th>What it means</th></tr>
          </thead>
          <tbody>
            <tr><td><Badge color="green">completed</Badge></td><td>The webhook was verified and the workflow was triggered. An instance exists.</td></tr>
            <tr><td><Badge color="red">failed</Badge></td><td>The signature didn't match, or the launch failed for good. Read the message on the row.</td></tr>
            <tr><td><Badge color="blue">running</Badge></td><td>Still in flight - including while the automatic retry schedule works through its attempts.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        The filter chips at the top of the panel are <strong>Running/Queued</strong>, <strong>Completed</strong>,{' '}
        <strong>Failed</strong> and <strong>Cancelled</strong>, each with a count. Toggle any combination, or use{' '}
        <strong>Clear</strong> to see everything again.
      </p>

      <h3>Queued webhooks when an automation is paused</h3>
      <p>
        When you pause an automation, incoming webhooks don't get dropped - they <strong>queue up</strong> behind
        a yellow <em>Paused - webhooks in queue</em> banner at the top of the panel, with a count. For each queued
        entry you have two choices:
      </p>
      <KV>
        <KVRow label="Let through">Process the queued webhook now. It becomes a normal relay.</KVRow>
        <KVRow label="Cancel">Drop the queued webhook.</KVRow>
      </KV>
      <p>This lets you fix a misconfiguration while paused without losing any legitimate webhook history.</p>

      <h2>Instances (the Activity Log)</h2>
      <p>
        Instances live in the <strong>Activity Log</strong>, a panel that slides in from the left and is
        reachable from any page via the <strong>Activity</strong> icon in the header.{' '}
        <strong>View Instances</strong> on a workflow card opens that same panel pre-filtered to the workflow -
        its subtitle then counts the instances in that workflow rather than the ones across all of them, and
        the filter appears as a chip you can clear.
      </p>
      <p>
        The panel lists instances newest first and offers a search box - instance, workflow, user or
        parameter values - plus a filter menu behind the sliders icon, collapsed by default and badged with
        the number of filters you have applied. Inside it, in order: <strong>Period</strong> (This month /
        Previous month / All), <strong>Platform</strong>, <strong>Workflow</strong> (which appears once a
        platform is chosen, scoped to that platform), and <strong>Status</strong>. Running, Completed and
        Failed are on by default, so cancelled instances stay out of the way until you ask for them.
      </p>

      <h3>What each row shows</h3>
      <ul>
        <li>A status badge - Completed, Running, Failed, or Cancelled</li>
        <li>The triggering automation and the instance name</li>
        <li>What launched it: <strong>Launched by Relay 7</strong> for an automation - click it to jump straight to that relay - or <strong>Launched by Run 3 · row 42</strong> for a Bulk Upload</li>
        <li>When it started, who started it, and the source platform</li>
        <li>A progress bar with a step count - for example <code>3/3</code> - and the current step name, or <em>Failed at:</em> the step that broke</li>
        <li>An <strong>Auto-retry 2/6</strong> chip with a countdown while retries are running</li>
        <li>Tags you add yourself. Tags are stored on the instance and shared across your organization, so a label one teammate adds is visible to everyone</li>
      </ul>

      <Callout type="tip" title="Set an expected duration and the row starts counting">
        When the automation sets an expected duration, a running instance shows{' '}
        <code>4/10 days passed</code> instead of a plain timestamp, turning amber and then red as it approaches
        and passes the threshold. That is the same signal the Overdue tab in the{' '}
        <DocLink to="control-center">Control Center</DocLink> uses.
      </Callout>

      <h3>Row actions</h3>
      <p>Which buttons appear depends on the instance's status:</p>
      <KV>
        <KVRow label="Cancel">Ask Workflow Builder to stop a running instance. Also offered on failed instances.</KVRow>
        <KVRow label="Retry now">On a running instance that is mid-retry, skip the wait and attempt the launch immediately.</KVRow>
        <KVRow label="Try Again">On a failed or cancelled instance, re-launch it with the same inputs. It then appears under <strong>In Progress → After Failed</strong> in the <DocLink to="control-center">Control Center</DocLink>.</KVRow>
        <KVRow label="View Params">Expand the <strong>Input Parameters</strong> table - the exact keys and values Workflow Builder received, with a copy button.</KVRow>
        <KVRow label="Docusign">A small menu with two deep links: <strong>Detail</strong> opens the instance's monitor view in Docusign, and <strong>Open</strong> opens the instance itself. Both open in a new tab.</KVRow>
      </KV>

      <h3>The four instance states</h3>
      <p>
        After Baton triggers a workflow, Workflow Builder runs it independently. Baton polls Workflow Builder
        every 30 seconds for the status of running instances, so you can monitor from inside Baton without
        opening Docusign. Every instance is in one of four states:
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>State</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td><Badge color="blue">Running</Badge></td><td>The instance is executing - or Baton is still working through the retry schedule.</td></tr>
            <tr><td><Badge color="green">Completed</Badge></td><td>The instance finished successfully.</td></tr>
            <tr><td><Badge color="red">Failed</Badge></td><td>The instance errored mid-run, or every launch attempt was exhausted.</td></tr>
            <tr><td><Badge color="gray">Cancelled</Badge></td><td>The instance was stopped before completion.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Status can be briefly stale">
        For long-running instances, Workflow Builder can take a few minutes to update. The panel may show
        slightly stale data while Baton polls for the latest status - it catches up on its own.
      </Callout>

      <h3>Seeing every workflow at once</h3>
      <p>
        Arriving via <strong>View Instances</strong> narrows the panel to one workflow, but nothing is hidden
        from you: clear that filter and the same list covers every workflow in your organization, including
        the instances Bulk Upload launched. Bulk Upload also has its own run-by-run and row-by-row drill-in on
        the Bulk Upload page.
      </p>

      <h2>Automatic retries</h2>
      <p>
        Baton's job is two phases - <strong>Verify</strong> then <strong>Route</strong> - and failures are
        handled differently depending on where they happen:
      </p>
      <ul>
        <li><strong>Verification fails</strong> (the signature, token or credentials didn't match): the relay is marked <Badge color="red">failed</Badge>, nothing fires to Workflow Builder, and the reason is recorded.</li>
        <li><strong>The launch is rejected outright</strong> (expired Docusign connection, or input Workflow Builder considers invalid): there is nothing to gain from trying again, so Baton fails fast rather than retrying, and sends a <strong>Workflow Failed</strong> notification.</li>
        <li><strong>The launch fails for a transient reason</strong> (rate limit, timeout, Workflow Builder unavailable): Baton retries automatically up to <strong>6 times</strong> with exponential backoff. If every attempt is exhausted, the instance is marked <Badge color="red">Failed</Badge> and an <strong>Automation Failed</strong> notification fires to every admin in your organization.</li>
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
        The instance stays <Badge color="blue">Running</Badge> for the whole ladder and only flips to{' '}
        <Badge color="red">Failed</Badge> once the last attempt is spent, so a retrying automation never looks
        broken while it is still recovering. The row shows the attempt you're on and the latest upstream error,
        and a retry that eventually succeeds counts as <strong>one</strong> relay - not one per attempt.
      </p>

      <Callout type="note" title="Retries are built in">
        Automatic routing retries are part of Baton's core behavior - every automation gets the same
        schedule, with nothing to configure.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="control-center" title="Control Center">Your fix-it queue for failed and overdue instances - Try Again, Cancel, or postpone in one place.</Card>
        <Card to="notifications" title="Notifications & alerts">Get an Automation Failed alert the moment all retries are exhausted.</Card>
      </Cards>
    </>
  );
}

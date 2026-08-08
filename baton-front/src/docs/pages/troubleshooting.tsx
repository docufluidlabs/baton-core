import { Lead, Callout, TableWrap, KV, KVRow, Badge, Cards, Card, DocLink } from '../ui';

export default function Troubleshooting() {
  return (
    <>
      <h1>Troubleshooting &amp; FAQ</h1>
      <Lead>
        Find your symptom below, check the likely causes, and apply the fix - most problems come down to a
        paused automation, a mismatched secret, or a payload that is missing a field.
      </Lead>

      <h2>Events aren't reaching Baton</h2>
      <p>Something happened in the source platform, but no relay appears in Baton.</p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Symptom</th><th>What to check</th></tr>
          </thead>
          <tbody>
            <tr><td>An event happened in the platform, but nothing arrived in Baton</td><td>Confirm the webhook in the platform is enabled and subscribed to that event type, and that you pasted the correct, current Webhook URL.</td></tr>
            <tr><td>The platform reports a <code>401</code></td><td>Verification was rejected - the signature, token or credentials did not match. See <a href="#verification">Verification is failing</a> below.</td></tr>
            <tr><td>The platform reports a <code>404</code></td><td>The Webhook URL no longer resolves to anything. Re-copy it from the automation - a truncated or hand-edited key is the usual cause.</td></tr>
            <tr><td>The platform reports <code>200</code>, but no relay appears</td><td>Baton accepted the webhook and then filtered it out. Either an automation <DocLink to="conditions">condition</DocLink> did not match, or the automation is paused. Neither case creates a relay.</td></tr>
          </tbody>
        </table>
      </TableWrap>
      <Callout type="tip" title="A paused automation queues, it does not drop">
        Pausing an automation does not throw its webhooks away. They stack up behind a{' '}
        <em>Paused - webhooks in queue</em> banner at the top of the{' '}
        <DocLink to="logs">relay log</DocLink>, where you can <strong>Let through</strong> the legitimate
        ones or <strong>Cancel</strong> them. So a paused automation looks like silence from the outside
        while the history is still waiting for you inside.
      </Callout>
      <Callout type="note" title="The Webhook URL is permanent">
        An automation's Webhook URL does not change for its lifetime, so a URL that worked yesterday is
        still correct today. If events stopped arriving, look first at whether the automation was paused or
        the event subscription in the platform changed.
      </Callout>

      <h2 id="verification">Verification is failing</h2>
      <p>
        Baton received the request but could not prove it was genuine, so it answered <code>401</code> and
        stopped there - nothing is stored and nothing is queued. A rejected webhook therefore{' '}
        <strong>never appears in the relay log</strong>. You read the reason in the sending platform's own
        delivery log, and the <strong>Webhook Failed</strong> notification is what tells you inside Baton.
      </p>
      <KV>
        <KVRow label="The HMAC signature does not match">
          The signing secret in Baton is not the one the platform is signing with. Re-copy the secret from
          the platform and save it again in Connections.
        </KVRow>
        <KVRow label="Basic Auth credentials are rejected">
          The username and password do not match. Re-enter the <em>same</em> values in both Baton and the
          platform.
        </KVRow>
        <KVRow label="The shared token is rejected">
          For token-authenticated platforms such as Airtable, the token in the request header is not the one
          stored in Baton. Re-copy it from the platform's card in Connections.
        </KVRow>
      </KV>
      <p>
        For the full list of rejection reasons - including a missing signature header and a signed timestamp
        that is more than five minutes old - see{' '}
        <DocLink to="verification">Webhook verification methods</DocLink>.
      </p>

      <h2>The workflow didn't launch</h2>
      <p>
        Baton verified the webhook, but the Docusign workflow did not run. Open the automation's{' '}
        <DocLink to="logs">relay log</DocLink> and expand the relay: its two stages,{' '}
        <strong>Webhook verification</strong> and <strong>Workflow Builder Trigger</strong>, show which half
        failed, and a plain-language message on the row explains why.
      </p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>What you see</th><th>What it means</th><th>What to do</th></tr>
          </thead>
          <tbody>
            <tr><td>No relay at all</td><td>The webhook was rejected at verification, or a condition filtered it out. Neither one creates a relay.</td><td>Check the sending platform's delivery log for a <code>401</code>, then review the automation's <DocLink to="conditions">conditions</DocLink>.</td></tr>
            <tr><td><Badge color="red">failed</Badge> on the inputs</td><td>Workflow Builder turned the launch down because a parameter was missing or the wrong shape. Retrying unchanged would fail the same way, so Baton does not retry.</td><td>Use <strong>View Payload</strong> on the relay to see what actually arrived, then compare it with the workflow's parameters on the <DocLink to="workflows">Workflow Checker</DocLink>. Add a <DocLink to="conditions">field mapping</DocLink> so the names line up.</td></tr>
            <tr><td><Badge color="red">failed</Badge> on the connection</td><td>The Docusign token was unusable when Baton tried to launch. This is not retried either.</td><td>Run <strong>Check Connection Status</strong> on the Connections page, and reconnect if it does not recover.</td></tr>
            <tr><td><Badge color="blue">running</Badge> with <code>Retry 2/6</code></td><td>A transient error - a rate limit, a timeout, or Workflow Builder briefly unavailable. Baton is working through the retry ladder.</td><td>Nothing. Let it land, or press <strong>Retry now</strong> to skip the countdown.</td></tr>
            <tr><td><Badge color="red">failed</Badge> after every retry</td><td>The ladder is exhausted and an <strong>Automation Failed</strong> notification has gone to your admins.</td><td>Press <strong>Try Again</strong> in the <DocLink to="control-center">Control Center</DocLink> once the underlying cause is fixed.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h3>When Baton retries, and when it doesn't</h3>
      <p>
        Not every failed launch is worth another attempt, so Baton splits them. A <strong>transient</strong>{' '}
        error - a rate limit, a timeout, or Workflow Builder briefly unavailable - is retried automatically{' '}
        <strong>6 times over roughly 50 minutes</strong> (2s, 4s, 8s, 5min, 15min, 30min). The instance stays{' '}
        <Badge color="blue">Running</Badge> for the whole ladder, so an automation that is still recovering
        never looks broken. If every attempt is spent, an <strong>Automation Failed</strong> notification
        fires and the instance lands in the <DocLink to="control-center">Control Center</DocLink>, where{' '}
        <strong>Try Again</strong> re-launches it with its original inputs.
      </p>
      <p>
        A <strong>rejected</strong> launch is different. When Workflow Builder refuses the inputs as invalid,
        or the Docusign connection cannot be used, repeating the same call would fail identically - so Baton
        fails fast, sends a <strong>Workflow Failed</strong> notification, and waits for you to fix the cause.
        The full schedule is in <DocLink to="logs">Relay logs &amp; instances</DocLink>.
      </p>

      <h3>A workflow is missing from the dropdown</h3>
      <p>
        Only workflows that are <strong>active</strong> in Workflow Builder are listed, so a workflow still in{' '}
        <strong>draft</strong> never syncs. If it is published and still missing, press{' '}
        <strong>Sync from Docusign</strong> on the <DocLink to="workflows">Workflow Checker</DocLink> to pull
        the latest list.
      </p>
      <Callout type="note" title="One workflow, one automation">
        A workflow already targeted by another automation is hidden from the{' '}
        <strong>Target Docusign Workflow</strong> dropdown rather than shown as disabled - so a workflow that
        exists, is active, and has synced can still be absent. Check whether another automation already
        claims it before hunting for a sync problem.
      </Callout>

      <h2>Bulk Upload runs</h2>
      <p>
        A <DocLink to="bulk-upload">Bulk Upload</DocLink> launches the same workflow once per row, so
        everything above applies row by row. These are the problems specific to the wizard and the release
        schedule.
      </p>
      <KV>
        <KVRow label="Baton won't accept the file">
          Only CSV, XLSX and TSV are parsed - Baton answers{' '}
          <em>Save the file as CSV, XLSX or TSV and try again.</em> Re-export from the source and upload again.
        </KVRow>
        <KVRow label="The mapping step lists no parameters">
          The target workflow has no published trigger inputs. Add them in Docusign Workflow Builder, press{' '}
          <strong>Sync from Docusign</strong> on the <DocLink to="workflows">Workflow Checker</DocLink>, then
          reopen the wizard.
        </KVRow>
        <KVRow label="Two columns were left unmapped">
          Auto-matching ignores case and punctuation, so two different headers can reduce to the same name.
          Baton leaves both unset rather than silently guessing which one you meant - pick the column yourself
          on that parameter.
        </KVRow>
        <KVRow label="The run stopped on its own">
          A run halts after <strong>5 consecutive launch failures</strong> by default and sends a{' '}
          <strong>Bulk Upload Run Stopped</strong> notification. The remaining rows are untouched: fix the
          cause, then resume the run.
        </KVRow>
        <KVRow label="Rows are releasing slowly">
          That is the throttle working - <strong>5 rows every 10 minutes</strong> by default, adjustable per
          run. If you also capped unfinished instances, releases pause until earlier ones finish; instances
          already marked <strong>Overdue</strong> stop counting against that cap, so a batch waiting on human
          signatures keeps moving.
        </KVRow>
      </KV>

      <h2>Connection issues</h2>
      <KV>
        <KVRow label="The Docusign connection shows Warning">
          The last health check failed, or a background token refresh could not renew the token. Run{' '}
          <strong>Check Connection Status</strong> on the Connections page; if it stays in Warning, reconnect
          Docusign.
        </KVRow>
        <KVRow label="The Docusign connection shows Error">
          The stored token is unusable. The <strong>Disconnect</strong> button is replaced by{' '}
          <strong>Reconnect</strong> - use it to authorize again.
        </KVRow>
        <KVRow label="Cancel didn't seem to reach Docusign">
          <strong>Cancel</strong> is best-effort against Workflow Builder but is always recorded in Baton. If
          the instance had already finished or failed, Workflow Builder refuses the cancel and Baton still
          marks it Cancelled, so the tab reflects what you asked for. That local state sticks - later polls
          will not flip it back.
        </KVRow>
      </KV>

      <Callout type="note" title="Still stuck?">
        Email <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>. Include the{' '}
        <strong>Relay ID</strong> and the <strong>Workflow Builder Instance ID</strong> - both are copyable
        from the expanded relay in the relay log, and together they let support trace exactly what happened.
      </Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="logs" title="Relay logs & instances">Inspect each relay, view the payload, and read the retry schedule.</Card>
        <Card to="verification" title="Webhook verification methods">Understand and fix verification failures.</Card>
        <Card to="control-center" title="Control Center">Try Again, cancel, or postpone failed instances.</Card>
      </Cards>
    </>
  );
}

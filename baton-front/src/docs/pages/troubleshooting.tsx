import { Lead, Callout, TableWrap, KV, KVRow, Cards, Card, DocLink } from '../ui';

export default function Troubleshooting() {
  return (
    <>
      <h1>Troubleshooting &amp; FAQ</h1>
      <Lead>
        Find your symptom below, check the likely causes, and apply the fix - most problems come down to a
        paused automation, a mismatched secret, or a payload that is missing a field.
      </Lead>

      <h2>Events aren't reaching Baton</h2>
      <p>Something happened in the source platform, but no Action appears in Baton.</p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Symptom</th><th>What to check</th></tr>
          </thead>
          <tbody>
            <tr><td>An event happened in the platform, but nothing arrived in Baton</td><td>Confirm the webhook in the platform is enabled and subscribed to that event type. Confirm you pasted the correct, current Webhook URL. Confirm the automation is <strong>Active</strong> and not paused.</td></tr>
            <tr><td>The platform reports the webhook failed (a non-2xx response)</td><td>The automation may be paused, or the URL has a typo. Re-copy the Webhook URL from the automation and make sure it is Active.</td></tr>
          </tbody>
        </table>
      </TableWrap>
      <Callout type="note" title="The Webhook URL is permanent">
        An automation's Webhook URL does not change for its lifetime, so a URL that worked yesterday is
        still correct today. If events stopped arriving, look first at whether the automation was paused or
        the event subscription in the platform changed.
      </Callout>

      <h2>Verification is failing</h2>
      <p>
        Baton received the request but could not prove it was genuine, so it rejected it. These appear in
        the Action log as a verification failure.
      </p>
      <KV>
        <KVRow label={<>HMAC: <code>verification_failed</code> / 401</>}>
          The signing secret in Baton does not match the platform. Re-copy the secret from the platform and
          save it again in Connections.
        </KVRow>
        <KVRow label={<>Basic Auth: <code>verification_failed</code> / 401</>}>
          The username and password do not match. Re-enter the <em>same</em> values in both Baton and the
          platform.
        </KVRow>
      </KV>
      <p>
        For a full list of rejection reasons - including missing signature header, timestamp too old, and
        no automation for that URL - see <DocLink to="verification">Webhook verification methods</DocLink>.
      </p>

      <h2>The workflow didn't launch</h2>
      <p>
        Baton accepted the webhook, but the Docusign workflow did not run as you expected. The Action status
        tells you why.
      </p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Action status</th><th>What it means</th><th>What to do</th></tr>
          </thead>
          <tbody>
            <tr><td><code>verification_failed</code></td><td>The webhook could not be proven genuine.</td><td>Re-copy the HMAC secret, or re-enter the matching Basic Auth username and password. See <DocLink to="verification">Webhook verification methods</DocLink>.</td></tr>
            <tr><td><code>validation_error</code></td><td>The payload did not contain the field(s) the Docusign workflow expects.</td><td>Open the Action and use <strong>View Payload</strong> to inspect it, then check the workflow's expected parameters on the <DocLink to="workflows">Workflow Checker</DocLink>. Either the source is not sending that field, or you need a field mapping so the names line up.</td></tr>
            <tr><td><code>condition_skip</code></td><td>A rule condition filtered the webhook out on purpose, so the workflow did not run.</td><td>This is expected behavior. If it should have run, review the automation's conditions.</td></tr>
            <tr><td><code>upstream_error</code></td><td>Workflow Builder returned an error when Baton tried to launch the workflow.</td><td>Baton retries automatically. If all retries fail, Retry the run from <DocLink to="control-center">Resolution Center</DocLink>.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h3>How retries work for upstream errors</h3>
      <p>
        When Workflow Builder returns an error on launch, Baton does not give up immediately. It automatically
        retries up to <strong>6 times over about 50 minutes</strong>. If every attempt fails, you receive an
        Automation Failed notification and the failed run appears in{' '}
        <DocLink to="control-center">Resolution Center</DocLink>, where you can Retry it.
      </p>

      <h3>A workflow is missing from the dropdown</h3>
      <p>
        If a workflow does not appear in the Target Docusign Workflow dropdown, it may be a{' '}
        <strong>draft</strong> in Workflow Builder - drafts do not sync - or you need to click{' '}
        <strong>Sync from Docusign</strong> on the <DocLink to="workflows">Workflow Checker</DocLink>.
      </p>

      <h2>Connection issues</h2>
      <KV>
        <KVRow label="The Docusign connection shows Warning or Error">
          Use <strong>Check Connection Status</strong> on the Connections page, and reconnect if needed.
        </KVRow>
        <KVRow label="A failed instance won't cancel">
          Some workflow states - for example a run that has already completed or been cancelled - cannot be
          cancelled. Baton shows Workflow Builder's own message explaining why.
        </KVRow>
      </KV>

      <Callout type="note" title="Still stuck?">
        Email <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>. Include the{' '}
        <strong>Action ID</strong> and the <strong>Workflow Builder Instance ID</strong> from the relevant
        Action - they let support trace exactly what happened.
      </Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="logs" title="Action log">Inspect each Action, view the payload, and read its status.</Card>
        <Card to="verification" title="Webhook verification methods">Understand and fix verification failures.</Card>
        <Card to="control-center" title="Resolution Center">Retry, cancel, or report failed workflow instances.</Card>
      </Cards>
    </>
  );
}

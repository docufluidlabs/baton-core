import { Lead, Callout, Steps, Step, KV, KVRow, Cards, Card, DocLink } from '../ui';

export default function Salesforce() {
  return (
    <>
      <h1>Salesforce setup</h1>
      <Lead>Salesforce has no native outbound webhook, so you build the outbound call yourself - a record-triggered Flow with an Apex callout that posts signed events to your automation's Baton webhook URL.</Lead>

      <h2>Why Salesforce needs extra steps</h2>
      <p>Most source platforms have a webhook settings screen where you paste a URL. Salesforce doesn't. To send events out of a Salesforce org you configure the outbound call yourself: a <strong>Record-Triggered Flow</strong> that invokes a small <strong>Apex</strong> method to POST the record to Baton. The target is the unique webhook URL Baton generates for your automation, which looks like <code>https://your-baton-host/api/webhooks/rule/&lt;webhookKey&gt;</code>. (Airtable is the other hand-built one - there you write a <strong>Run a script</strong> action inside an Airtable Automation.)</p>

      <Callout type="note" title="This is not an OAuth integration">Baton does not log into Salesforce. Salesforce posts to Baton, signed with a shared secret. This also does <em>not</em> replace Workflow Builder's Salesforce Extension App, which reads and writes records after a workflow is triggered - these do different jobs.</Callout>

      <h2>Set up the integration</h2>
      <Steps>
        <Step title="Create a Salesforce automation in Baton"> In <DocLink to="flow-builder">Flow Builder</DocLink>, choose <strong>New Automation</strong>, set <strong>Source = Salesforce</strong>, pick the Docusign workflow it should trigger, and copy the automation's <strong>Webhook URL</strong>.</Step>
        <Step title="Save a webhook secret in Baton"> Generate a strong random string (32+ characters) and click <strong>Save</strong> on the <strong>Webhook Secret</strong> field in the same panel. Salesforce signs every request with this exact value, and <strong>Create</strong> stays disabled until the secret is saved.</Step>
        <Step title="Allow the Baton host in Salesforce"> Add your Baton server's base URL as a <strong>Remote Site Setting</strong> (Setup → Security → Remote Site Settings) so Apex is allowed to call it.</Step>
        <Step title="Build the outbound call"> Create a Record-Triggered Flow on the object you care about that calls an invocable Apex method. The callout POSTs a JSON body - object type, action, and record ID - to the webhook URL, with the <code>X-Salesforce-Signature</code> header set to the base64 HMAC-SHA256 of the raw body, computed with the shared secret (in Apex, <code>Crypto.generateMac('hmacSHA256', body, secret)</code>). Activate the Flow.</Step>
        <Step title="Test it"> Edit a matching record and save. Within a few seconds the event reaches Baton and any matching automation runs. Open <strong>Logs</strong> on the automation card to confirm - see <DocLink to="logs">Relay logs</DocLink>.</Step>
      </Steps>

      <Callout type="warning" title="Sign the exact bytes you send">The signature must be the HMAC-SHA256 of the <em>raw request body</em>, base64-encoded, using the same secret saved in Baton. Any mismatch - different secret, re-serialized JSON, wrong encoding - and Baton returns <code>401 Invalid signature</code>.</Callout>

      <Callout type="warning" title="Outbound Messages can't be used">Salesforce's classic <strong>Outbound Message</strong> sends SOAP XML and cannot set custom HTTP headers, so it can neither carry the <code>X-Salesforce-Signature</code> header nor be parsed as JSON. Baton rejects it. Use a Flow with an Apex callout, which controls both the body and the headers.</Callout>

      <h2>What the payload should contain</h2>
      <p>Baton reads the object type, the action, and the record ID from the payload to derive the event type it labels each relay with. A minimal body looks like <code>{'{"objectType":"opportunity","action":"updated","recordId":"006..."}'}</code>, which Baton normalizes to the event type <code>opportunity.updated</code>. The nested Salesforce shape works too: <code>sobject.type</code> and <code>sobject.Id</code> are read as fallbacks. Extra fields are passed through and available for field mapping.</p>
      <p>The event type is what you see on each relay in the logs, but Flow Builder doesn't ask you to pick one: a new automation matches <em>every</em> event its source sends. Narrow it with <DocLink to="conditions">conditions</DocLink> - for example, fire only when <code>objectType</code> is <code>opportunity</code> and <code>action</code> is <code>updated</code>.</p>

      <h2>What to expect at runtime</h2>
      <KV>
        <KVRow label="One secret for all Salesforce automations">The Webhook Secret is stored on the installed Salesforce platform, not on a single automation. Every Salesforce automation in the org verifies against it, so changing it in one panel changes it everywhere - update your Apex at the same time.</KVRow>
        <KVRow label="One HTTP call per event">Each triggering record change results in a single signed POST from Salesforce to the automation's webhook URL.</KVRow>
        <KVRow label="One webhook URL per automation">The URL is tied to the automation and stays stable for its lifetime. Point a second Flow at a second automation to drive a different Docusign workflow.</KVRow>
        <KVRow label="Sandboxes work too">A sandbox org can post to Baton the same way. Give it its own automation so sandbox events never mix with production ones - both share the same Salesforce webhook secret.</KVRow>
      </KV>

      <Callout type="note" title="Manual setup by design">Baton has no managed Salesforce package to install, so nothing lands in your org except the Flow and Apex class you write. That code stays yours - readable, editable, and versioned with the rest of your Salesforce metadata.</Callout>

      <Callout type="tip" title="Not every launch needs a webhook">To start a workflow for a list of records you already have, skip the Flow and Apex entirely: export the Salesforce report as CSV or XLSX and use <strong>Bulk Upload</strong> in the sidebar. It launches one workflow per row, with no secret to manage.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="flow-builder" title="Flow Builder">Create the Salesforce automation and wire it to the Docusign workflow you want to trigger.</Card>
        <Card to="verification" title="Webhook verification">How Baton verifies HMAC-signed webhooks.</Card>
        <Card to="troubleshooting" title="Troubleshooting">Signature failures, events that never arrive, and other common snags.</Card>
      </Cards>
    </>
  );
}

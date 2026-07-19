import { Lead, Callout, Steps, Step, KV, KVRow, Cards, Card } from '../ui';

export default function Salesforce() {
  return (
    <>
      <h1>Salesforce setup</h1>
      <Lead>Salesforce has no native outbound webhook, so you build the outbound call yourself - a Flow with an Apex callout (or an Outbound Message) that posts signed events to your Baton webhook URL.</Lead>

      <h2>Why Salesforce needs extra steps</h2>
      <p>Every other source platform has a webhook settings screen where you paste a URL. Salesforce doesn't. To send events out of a Salesforce org you configure the outbound call yourself: typically a <strong>Record-Triggered Flow</strong> that invokes a small <strong>Apex</strong> method to POST the record to Baton, or Salesforce's classic <strong>Outbound Message</strong>. Either way, the target is the same - the unique webhook URL Baton generates for your automation.</p>

      <Callout type="note" title="This is not an OAuth integration">Baton does not log into Salesforce. Salesforce posts to Baton, signed with a shared secret. This also does <em>not</em> replace Workflow Builder's Salesforce Extension App, which reads and writes records after a workflow is triggered - these do different jobs.</Callout>

      <h2>Set up the integration</h2>
      <Steps>
        <Step title="Create a Salesforce automation in Baton"> In Flow Builder, create a new automation with <strong>Source = Salesforce</strong> and copy its unique <strong>Webhook URL</strong>.</Step>
        <Step title="Save a webhook secret in Baton"> Generate a strong random string and save it as the automation's <strong>Webhook Secret</strong>. Salesforce will sign every request with this exact value.</Step>
        <Step title="Allow the Baton host in Salesforce"> Add your Baton server's base URL as a <strong>Remote Site Setting</strong> (Setup → Security → Remote Site Settings) so Apex is allowed to call it.</Step>
        <Step title="Build the outbound call"> Create a Record-Triggered Flow that calls an invocable Apex method (or configure an Outbound Message). The callout POSTs a JSON body - object type, action, and record ID - to the webhook URL, with the <code>X-Salesforce-Signature</code> header set to the base64 HMAC-SHA256 of the raw body, computed with the shared secret.</Step>
        <Step title="Test it"> Edit a matching record and save. The event appears in Baton within a few seconds and any matching automation runs.</Step>
      </Steps>

      <Callout type="warning" title="Sign the exact bytes you send">The signature must be the HMAC-SHA256 of the <em>raw request body</em>, base64-encoded, using the same secret saved in Baton. Any mismatch - different secret, re-serialized JSON, wrong encoding - and Baton returns <code>401 Invalid signature</code>.</Callout>

      <h2>What the payload should contain</h2>
      <p>Baton reads the object type, the action, and the record ID from the payload to build the event type it matches automations against. A minimal body looks like <code>{'{"objectType":"opportunity","action":"updated","recordId":"006..."}'}</code>, which Baton normalizes to the event type <code>opportunity.updated</code>. Extra fields are passed through and available for field mapping.</p>

      <h2>What to expect at runtime</h2>
      <KV>
        <KVRow label="One secret per connection">The Webhook Secret you save on the Salesforce connection in Baton is the single secret used to verify every dispatch from your org.</KVRow>
        <KVRow label="One HTTP call per event">Each triggering record change results in a single signed POST from Salesforce to the automation's webhook URL.</KVRow>
        <KVRow label="Sandboxes work too">A sandbox org can post to Baton the same way - set up a separate automation for sandbox testing so test events never mix with production ones.</KVRow>
      </KV>

      <Callout type="note" title="Manual setup by design">Baton does not ship a managed Salesforce package - the Flow + Apex (or Outbound Message) setup on this page is the supported path for connecting a Salesforce org.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="flow-builder" title="Flow Builder">Create the Salesforce automation and wire it to the Docusign workflow you want to trigger.</Card>
        <Card to="verification" title="Webhook verification">How Baton verifies HMAC-signed webhooks.</Card>
      </Cards>
    </>
  );
}

import { Lead, Callout, Steps, Step, KV, KVRow, Cards, Card } from '../ui';

export default function Salesforce() {
  return (
    <>
      <h1>Salesforce package</h1>
      <Lead>Salesforce is the one source platform Baton ships its own managed package for — a far simpler path than Salesforce's native outbound options.</Lead>

      <h2>Why Salesforce has its own package</h2>
      <p>Every other source platform sends events to Baton with a native outbound webhook. Salesforce is the exception. Its native outbound options are awkward: Outbound Messages force a fixed SOAP/XML shape, and Platform Events or Flow callouts require Named Credentials, Remote Site Settings, Apex, and a separate Flow per object.</p>
      <p>The Baton managed package — published as <strong>Baton</strong> on the Salesforce AppExchange — collapses all of that. In a Salesforce <strong>Flow</strong>, you call the <strong>"Send to Baton"</strong> action and pass it the record IDs. The package handles secret storage, HMAC signing, and retries for you.</p>

      <Callout type="note" title="This is not an OAuth integration">Baton does not log into Salesforce. Salesforce posts to Baton, signed. The package also does <em>not</em> replace Maestro's Salesforce Extension App, which reads and writes records after a workflow is triggered — these do different jobs.</Callout>

      <h2>Set up with the bootstrap flow</h2>
      <p>The package uses a modern bootstrap flow so you never handle raw secret material. You paste a one-time token, and the package generates and registers its own signing secret on first use.</p>

      <Steps>
        <Step title="Create a Salesforce automation in Baton"> This is the automation Salesforce events will trigger.</Step>
        <Step title="Get the bootstrap token"> Baton issues a one-time <strong>bootstrap token</strong> embedded in the webhook URL for that automation.</Step>
        <Step title="Paste the URL into Salesforce"> Put that URL into the Baton package's Custom Setting in your Salesforce org.</Step>
        <Step title="Run the Flow once to register"> On the first Flow execution, the package generates its own signing secret, stores it securely in Salesforce, and registers it with Baton automatically.</Step>
        <Step title="You are signed and verified"> From the second event onward, every dispatch is HMAC-signed and verified by Baton.</Step>
      </Steps>

      <Callout type="warning" title="The bootstrap token is single-use and expires in 24 hours">It can only register a secret once, and it stops working 24 hours after it is issued. If it expires before you run the Flow, generate a fresh URL from the automation in Baton.</Callout>

      <h2>What "Send to Baton" does</h2>
      <p>Inside a Salesforce Flow, the <strong>"Send to Baton"</strong> action is all you add. You pass it the record IDs you want to send, and the package takes care of the rest: storing the signing secret, HMAC-signing each dispatch, and retrying if a send fails. There is no Apex, Named Credential, or per-object Flow to maintain — one action covers it.</p>

      <h2>What to expect at runtime</h2>
      <KV>
        <KVRow label="First dispatch is slower">The very first event registers the secret with Baton before it sends, so it takes a little longer. After that there is a single HTTP call per event.</KVRow>
        <KVRow label="One org, one secret">Each Salesforce org maps to one signing secret, generated and held by the package in that org.</KVRow>
        <KVRow label="Sandboxes are supported">Salesforce sandbox orgs are supported and tracked separately, so you never mix sandbox and production events into the same automation.</KVRow>
      </KV>

      <Callout type="tip" title="Keep sandbox and production apart">Because sandbox orgs are tracked separately, set up a sandbox automation in Baton for testing and a separate production automation for live events. Each gets its own secret.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="flow-builder" title="Flow Builder">Create the Salesforce automation and wire it to the Maestro workflow you want to trigger.</Card>
        <Card to="verification" title="Webhook verification">How Baton verifies the HMAC-signed dispatches the package sends.</Card>
      </Cards>
    </>
  );
}

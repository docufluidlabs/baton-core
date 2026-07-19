import { Lead, Callout, TableWrap, Steps, Step, Badge, FlowStrip, FlowNode, Cards, Card } from '../ui';

export default function ConnectDocusign() {
  return (
    <>
      <h1>Connect Docusign</h1>
      <Lead>Connecting Docusign is the very first thing you do in Baton — it is the engine Baton triggers and reads, so nothing else works until this link is in place.</Lead>

      <h2>Why Docusign comes first</h2>
      <p>Baton's whole job is to launch and watch Docusign Maestro workflows. To do that, Baton needs permission to talk to Docusign on your organization's behalf: to read your Maestro workflows, to trigger workflow launches, and to check the status of the runs it starts. That permission is the single Docusign connection your organization holds.</p>
      <p>Until Docusign is connected, Baton has no workflows to point your automations at and no way to launch anything. So the Connections page asks you to connect Docusign before you configure any source platforms.</p>

      <Callout type="note" title="This unlocks the rest of Baton">Once Docusign is connected, Baton can sync your Maestro workflows and the rest of the product opens up: Flow Builder, the Workflow Checker, and Resolution Center all rely on this connection being healthy.</Callout>

      <h2>Connect with one OAuth link</h2>
      <p>Baton uses Docusign's standard OAuth sign-in, so you never paste credentials into Baton — you authorize Baton inside Docusign's own login screen. Here is the full flow:</p>

      <Steps>
        <Step title="Open the Connections page"> Go to <code>/connections</code>. The <strong>Docusign Connection</strong> section is at the top. If no connection exists yet, you will see a setup prompt instead of a connection card. On self-hosted installs where the Docusign OAuth app is not configured yet, this prompt shows the exact Redirect URI to copy into your Docusign app, along with the environment keys to set.</Step>
        <Step title="Click Connect Docusign"> Baton redirects you to the Docusign login screen.</Step>
        <Step title="Sign in and authorize"> Log in with your Docusign credentials and approve the access Baton requests.</Step>
        <Step title="Get redirected back to Baton"> Docusign sends you back to Baton, which securely stores the access tokens (encrypted). You do not see or handle any token material.</Step>
        <Step title="Pick your active account"> If your Docusign user can reach more than one Docusign account, Baton lists every account you can access and asks which one to use. See <a href="#multi-account">Choosing the right account</a> below.</Step>
        <Step title="You are connected"> The Docusign Connection card now shows your Docusign name, a connection badge, and a status indicator. Every Maestro API call Baton makes from now on uses this connection.</Step>
      </Steps>

      <h2 id="multi-account">Choosing the right account when you have several</h2>
      <p>A single Docusign user can have access to multiple Docusign accounts — for example a sandbox and a production account, or accounts for different business units. After you authorize, Baton lists every account your login can reach and asks you to pick the active one.</p>
      <p>The account you choose is the account Baton uses for <em>every</em> Maestro API call: reading workflows, launching them, and checking status. Make sure you select the account whose Maestro workflows you actually want Baton to drive.</p>

      <Callout type="warning" title="Pick the matching environment">If you work with both sandbox and production Docusign accounts, choose the one that matches the environment you are configuring. The workflows Baton can see and trigger come from the account you select here.</Callout>

      <h2>The connection status indicator</h2>
      <p>The Docusign Connection card always shows a health status so you can tell at a glance whether Baton can still reach Docusign. There are three states:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Status</th><th>What it means</th><th>What to do</th></tr></thead>
          <tbody>
            <tr><td><Badge color="green">Healthy</Badge></td><td>Baton's Docusign token works and Maestro calls succeed.</td><td>Nothing — you are good to go.</td></tr>
            <tr><td><Badge color="amber">Warning</Badge></td><td>The connection is working but Baton has noticed something worth attention.</td><td>Run <strong>Check Connection Status</strong> to re-verify.</td></tr>
            <tr><td><Badge color="red">Error</Badge></td><td>Baton cannot reach Docusign with the stored token.</td><td>Run <strong>Check Connection Status</strong>; if it stays in error, reconnect Docusign.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h3>Check Connection Status</h3>
      <p>The <strong>Check Connection Status</strong> button re-checks the OAuth token on demand. When the token still works, Baton reports <code>Connected as &lt;Name&gt;</code> and the indicator turns green. This is the quickest way to confirm a healthy connection or to clear a transient warning.</p>

      <h2>Token refresh is automatic</h2>
      <p>You do not have to reconnect Docusign on a routine basis. Baton refreshes the Docusign access token for you in the background — roughly every five minutes and before the token would expire — so the connection stays alive without any action from you. The <strong>Check Connection Status</strong> button is there for confirmation, not for routine maintenance.</p>

      <h2>Disconnecting</h2>
      <p>The <strong>Disconnect</strong> button (shown in red because it is destructive) removes Baton's access to Docusign. Once disconnected, Baton can no longer read or trigger your Maestro workflows, so any automations that rely on Maestro stop working until you reconnect.</p>

      <Callout type="danger" title="Disconnect stops everything Maestro">Disconnecting removes Baton's ability to read and trigger Maestro. Only disconnect if you intend to stop Baton from driving Docusign, or before reconnecting to a different account.</Callout>

      <h2>Docusign as both a destination and a source</h2>
      <p>Docusign is special. It is Baton's outbound destination — the place Baton triggers Maestro workflows — and it can also be an inbound source. Through Docusign Connect, Docusign can post envelope and recipient events back to Baton just like any other webhook source. One Docusign connection covers both directions.</p>
      <p>The envelope and recipient events Baton can react to include:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Event</th><th>Fires when</th></tr></thead>
          <tbody>
            <tr><td><code>envelope.sent</code></td><td>An envelope is sent to its recipients.</td></tr>
            <tr><td><code>envelope.delivered</code></td><td>An envelope is delivered to a recipient.</td></tr>
            <tr><td><code>envelope.completed</code></td><td>All recipients have completed the envelope.</td></tr>
            <tr><td><code>envelope.declined</code></td><td>A recipient declines the envelope.</td></tr>
            <tr><td><code>envelope.voided</code></td><td>An envelope is voided.</td></tr>
            <tr><td><code>recipient.sent</code></td><td>An envelope is sent to a specific recipient.</td></tr>
            <tr><td><code>recipient.completed</code></td><td>A recipient completes their part of the envelope.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>This is what makes chained workflows possible. A common pattern:</p>

      <FlowStrip>
        <FlowNode k="Maestro" t="Workflow A finishes" d="A workflow Baton launched completes its run." />
        <FlowNode k="Docusign Connect" t="envelope.completed" d="Docusign fires the event back to Baton." />
        <FlowNode k="Baton" t="Automation matches" d="A Baton automation recognizes the event." />
        <FlowNode k="Maestro" t="Workflow B launches" d="Baton triggers the next workflow in the chain." />
      </FlowStrip>

      <Callout type="tip" title="One connection, two directions">You do not set up a separate Docusign source. The same OAuth connection that lets Baton trigger Maestro also lets Docusign Connect events flow back in.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="workflows" title="Sync your Maestro workflows">With Docusign connected, pull in your Maestro workflows and check they are ready to trigger.</Card>
        <Card to="connections" title="Connect source platforms">Add the platforms that will send webhooks into Baton, such as HubSpot and others.</Card>
      </Cards>
    </>
  );
}

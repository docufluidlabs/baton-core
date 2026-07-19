import { Lead, Callout, TableWrap, Steps, Step, Badge, KV, KVRow, Cards, Card, DocLink, Screenshot } from '../ui';
import connectionsShot from '../assets/screenshots/connections.png';

export default function Connections() {
  return (
    <>
      <h1>Connect source platforms</h1>
      <Lead>The Connections page is where you manage your single Docusign link and add the source platforms - like HubSpot - that send webhooks into Baton.</Lead>

      <Screenshot
        src={connectionsShot}
        alt="The Connections page showing the Docusign connection at the top and source platforms below"
        caption="The Connections page - your Docusign connection and its health at the top, with source platforms below."
      />

      <Callout type="tip" title="Looking for exact, per-platform steps?">Each supported platform has its own step-by-step walkthrough - including the events you can trigger on and a troubleshooting checklist. See <DocLink to="setup">Setup guides</DocLink>.</Callout>

      <h2>Two sections on one page</h2>
      <p>The Connections page (<code>/connections</code>) brings together two related but different concerns:</p>

      <KV>
        <KVRow label="Docusign Connection">The one OAuth link Baton holds for your organization. It is what lets Baton read, trigger, and monitor your Docusign workflows.</KVRow>
        <KVRow label="Connected Platforms">The source platforms that send webhooks into Baton. These are not OAuth logins - they are lightweight "shells" that let you build automations.</KVRow>
      </KV>

      <h2>The Docusign Connection summary</h2>
      <p>At the top of the page, the Docusign Connection card shows your Docusign name, a connection badge, and a status indicator (<Badge color="green">Healthy</Badge>, <Badge color="amber">Warning</Badge>, or <Badge color="red">Error</Badge>), plus buttons to <strong>Check Connection Status</strong> and to <strong>Disconnect</strong>. If no connection exists yet, this section shows a setup prompt - and you must connect Docusign before configuring anything else.</p>

      <Callout type="note" title="Connect Docusign first">If you have not linked Docusign yet, start there - the full walkthrough is on <DocLink to="connect-docusign">Connect Docusign</DocLink>. The rest of this page assumes Docusign is connected.</Callout>

      <h2>Connected Platforms: shells, not logins</h2>
      <p>The <strong>Connected Platforms</strong> section lists the source platforms that send webhooks into Baton. It is important to understand that these are <em>not</em> OAuth connections. Baton does not log into HubSpot or Zendesk on your behalf. Each platform is a "shell" that exists so you can build automations against it. The platform itself posts webhooks to Baton; Baton never reaches into the platform.</p>
      <p>Each platform card shows:</p>

      <ul>
        <li>The platform logo and name</li>
        <li>A category badge, for example <Badge color="blue">CRM</Badge></li>
        <li>An "N automation(s)" count of how many automations use it</li>
        <li>A <strong>Create New Automation</strong> button</li>
        <li>A delete (trash) icon - available only when no automations depend on the platform</li>
      </ul>

      <Callout type="warning" title="You cannot delete a platform in use">The trash icon is only enabled when no automations depend on the platform. Remove or repoint the automations first, then delete the platform shell.</Callout>

      <h2>Add a platform</h2>
      <p>The <strong>+ Add Platform</strong> button sits at the top-right of the Connected Platforms section. It opens a searchable catalog of available platforms.</p>

      <h3>Inside the Add Platform modal</h3>
      <p>The modal is a searchable list. Each entry shows:</p>

      <TableWrap>
        <table>
          <thead><tr><th>What you see</th><th>What it tells you</th></tr></thead>
          <tbody>
            <tr><td>Logo, name, and category</td><td>Which platform it is and how it is grouped (CRM, ATS, and so on).</td></tr>
            <tr><td>One-line description</td><td>A short summary of the platform.</td></tr>
            <tr><td>Credential type required</td><td>What the platform needs to verify webhooks, for example "Webhook Secret" or "App Client Secret".</td></tr>
            <tr><td><strong>+ Add</strong> button or <Badge color="green">Added</Badge> badge</td><td>Add the platform, or see that it is already added.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>After you add a platform, you configure its actual webhook using that platform's setup guide. Adding the platform simply creates the shell - the webhook itself is wired up next.</p>

      <h2>Set up a platform's webhook</h2>
      <p>Every catalog platform - HubSpot, Zoho CRM, Zendesk, Greenhouse, monday.com, BambooHR, and the rest - follows the same data-driven walkthrough, available in-app at Connections &rarr; a platform (<code>/setup/&lt;platform&gt;</code>). Baton receives the platform's events through a webhook you set up once. The general flow is the same everywhere; only the platform-specific screens differ.</p>

      <Steps>
        <Step title="Get your Baton webhook URL"> In Flow Builder, choose <strong>New Automation</strong>, set the Source to the platform, fill in a name and the target Docusign workflow, Save, and copy the generated <strong>Webhook URL</strong>.</Step>
        <Step title="Configure the webhook in the platform"> Register that URL in the platform and choose which events should fire it. The exact steps are shown in each platform's guide.</Step>
        <Step title="Set the secret model"> Depending on the platform, this is an HMAC signing secret, a Basic Authentication username and password, or no secret at all. See <a href="#secret-models">Three secret models</a> below.</Step>
        <Step title="Send a test event"> Trigger an event in the platform - for example create or update a record. Within seconds it appears in Baton's event log, and any matching automation runs.</Step>
      </Steps>

      <p>Each platform guide also lists the specific events you can trigger on, along with a troubleshooting table.</p>

      <h2 id="secret-models">Three secret models</h2>
      <p>How Baton confirms a webhook is genuine depends on the platform. Every platform uses exactly one of these models, and the platform's guide tells you which:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Model</th><th>How it works</th><th>Where you set it</th></tr></thead>
          <tbody>
            <tr><td>HMAC signing secret</td><td>The platform signs each webhook with a secret. You copy that secret from the platform into Baton so Baton can verify the signature.</td><td>Copy from platform &rarr; paste into Baton.</td></tr>
            <tr><td>Basic Authentication</td><td>You choose a username and password and enter the <em>same</em> values in both Baton and the platform.</td><td>Enter identical values in both places.</td></tr>
            <tr><td>No secret</td><td>Some platforms do not sign at all. Baton accepts events on the unguessable webhook URL.</td><td>Nothing to set - keep the URL private.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="tip" title="Basic Auth must match exactly">With Basic Authentication, the username and password you set in Baton and in the platform must be identical. A mismatch is the most common cause of a 401.</Callout>

      <h2>Troubleshooting</h2>
      <p>If a test event does not behave as expected, work through these common issues:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Symptom</th><th>Likely cause and fix</th></tr></thead>
          <tbody>
            <tr><td>Platform reports the webhook failed (non-2xx)</td><td>The automation may be paused, or the URL has a typo. Re-copy the URL and make sure the automation is Active.</td></tr>
            <tr><td>An event happened but nothing arrived in Baton</td><td>Make sure the webhook in the platform is enabled and subscribed to that event type.</td></tr>
            <tr><td>Baton returns 401 (Basic Auth)</td><td>Username or password mismatch. Re-enter the same values in both Baton and the platform.</td></tr>
            <tr><td>Baton returns 401 invalid signature</td><td>The secret in Baton does not match the platform's. Re-copy it from the platform.</td></tr>
            <tr><td>Events arrive but the automation does not run</td><td>Confirm the automation is Active and that any trigger conditions match the record.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Related connection types</h2>
      <Cards>
        <Card to="salesforce" title="Salesforce setup">Salesforce has no native outbound webhook - you build the outbound call in your org.</Card>
        <Card to="custom-webhook" title="Custom POST webhooks">Bring in any source that can post JSON but is not in the catalog.</Card>
        <Card to="verification" title="Webhook verification">How Baton checks that an incoming webhook is authentic before it acts on it.</Card>
        <Card to="catalog" title="Platform catalog">Browse the supported source platforms and what each one needs.</Card>
      </Cards>
    </>
  );
}

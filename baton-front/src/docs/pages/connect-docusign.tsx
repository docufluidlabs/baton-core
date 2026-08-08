import { Lead, Callout, TableWrap, Steps, Step, Badge, FlowStrip, FlowNode, Cards, Card } from '../ui';

export default function ConnectDocusign() {
  return (
    <>
      <h1>Connect Docusign</h1>
      <Lead>Connecting Docusign is the very first thing you do in Baton - it is the engine Baton triggers and reads, so nothing else works until this link is in place.</Lead>

      <h2>Why Docusign comes first</h2>
      <p>Baton's whole job is to launch and watch Docusign Workflow Builder workflows. To do that, Baton needs permission to talk to Docusign on your organization's behalf: to read your workflows, to trigger workflow launches, and to check the status of the runs it starts. That permission is the single Docusign connection your organization holds.</p>
      <p>Until Docusign is connected, Baton has no workflows to point your automations at and no way to launch anything. So the Connections page asks you to connect Docusign before you configure any source platforms.</p>

      <Callout type="note" title="This unlocks the rest of Baton">Until the connection exists, <strong>Flow Builder</strong>, <strong>Bulk Upload</strong>, <strong>Workflow Checker</strong> and <strong>Control Center</strong> are greyed out in the sidebar with the tooltip "Connect Docusign to enable", and opening those URLs directly sends you straight back to Connections. Connect Docusign and all four open up.</Callout>

      <h2>Connect with one OAuth link</h2>
      <p>Baton uses Docusign's standard OAuth sign-in, so you never paste credentials into Baton - you authorize Baton inside Docusign's own login screen. Only an owner, admin or superuser can start the flow. Here is what happens:</p>

      <Steps>
        <Step title="Open the Connections page"> Click <strong>Connections</strong> in the sidebar (<code>/connections</code>). The <strong>Docusign Connection</strong> section is at the top. If no connection exists yet, you will see a setup prompt instead of a connection card. On self-hosted installs where the Docusign OAuth app is not configured yet, this prompt shows the exact Redirect URI to copy into your Docusign app, along with the environment keys to set.</Step>
        <Step title="Click Connect Docusign"> Baton redirects you to the Docusign login screen.</Step>
        <Step title="Sign in and authorize"> Log in with your Docusign credentials and approve the access Baton requests.</Step>
        <Step title="Get redirected back to Baton"> Docusign sends you back to Baton, which stores the access and refresh tokens encrypted at rest (AES-256-GCM, using your install's <code>TOKEN_ENCRYPTION_KEY</code>). You never see or handle any token material.</Step>
        <Step title="Check the active account"> Baton keeps the first account Docusign returns. If your login can reach more than one, the connection panel that opens right after the redirect lets you switch. See <a href="#multi-account">Choosing the right account</a> below.</Step>
        <Step title="You are connected"> The Docusign Connection card now shows your Docusign name, a platform badge, and a status indicator. Every Workflow Builder API call Baton makes from now on uses this connection.</Step>
      </Steps>

      <p>Baton requests three Docusign scopes: <code>signature</code> to work with envelopes, <code>aow_manage</code> to read and launch Workflow Builder workflows, and <code>extended</code> so Docusign issues a refresh token and Baton can renew access without sending you back to the login screen.</p>

      <h2>The Apps &amp; Keys page, field by field</h2>
      <p>On a self-hosted install you register Baton as a Docusign OAuth app once, on Docusign's <strong>Apps &amp; Keys</strong> page. If you do not have a Docusign developer account yet, the setup prompt links you to <a href="https://developers.docusign.com" target="_blank" rel="noreferrer">developers.docusign.com</a> to create a free one; it also gives you the exact redirect URI and the two <code>baton/.env</code> keys. The Docusign app-edit page is one long form. Here is every section in the order Docusign renders it, and what to do with each:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Section</th><th>What you do</th></tr></thead>
          <tbody>
            <tr><td>General Info &rarr; App Name</td><td>Anything, e.g. "Baton".</td></tr>
            <tr><td>General Info &rarr; Integration Key</td><td>A read-only GUID with a copy button. Copy it - it becomes <code>DOCUSIGN_INTEGRATION_KEY</code> in <code>baton/.env</code>.</td></tr>
            <tr><td>General Info &rarr; Integration Type</td><td>Pick <strong>Private custom integration</strong>. Docusign notes the type is only required for go-live, but picking it now avoids the warning.</td></tr>
            <tr><td>Authentication &rarr; "Is your application able to securely store a client secret?"</td><td>Choose <strong>Yes</strong>. "Authorization Code Grant" appears - that is the flow Baton uses.</td></tr>
            <tr><td>Authentication &rarr; Require Proof Key for Code Exchange (PKCE)</td><td><strong>Leave unchecked</strong> - see the warning below.</td></tr>
            <tr><td>Authentication &rarr; Secret Keys</td><td>Click <strong>+ Add Secret Key</strong> and copy the value <em>immediately</em> - Docusign shows it once and masks it forever after. It becomes <code>DOCUSIGN_SECRET_KEY</code>.</td></tr>
            <tr><td>Service Integration &rarr; RSA Keypairs</td><td>Ignore entirely. Generate RSA / Upload RSA belong to the JWT grant, which Baton does not use.</td></tr>
            <tr><td>Additional settings &rarr; Redirect URIs</td><td>Click <strong>+ Add URI</strong> and paste the redirect URI from Baton's setup card.</td></tr>
            <tr><td>Additional settings &rarr; Privacy Policy / Terms of Use links</td><td>Leave empty.</td></tr>
            <tr><td>Additional settings &rarr; CORS Configuration</td><td>Ignore entirely - Origin URLs and the Allowed HTTP Methods checkboxes stay untouched.</td></tr>
            <tr><td>Save / Cancel</td><td>Click <strong>Save</strong> at the very bottom. The page is long - nothing, including the redirect URI, is saved until you click Save.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="warning" title="Leave the PKCE checkbox unchecked">Docusign marks "Require Proof Key for Code Exchange (PKCE)" with a "Recommended" badge, but Baton authenticates with the secret key over Authorization Code Grant and does not send a PKCE code challenge. Enabling it makes every connect fail - leave it unchecked.</Callout>

      <Callout type="note" title="Two easy mistakes">The secret key is shown only once - copy it the moment you create it, or you will have to add a new one. And because the page is long, remember to scroll down and click <strong>Save</strong>; the redirect URI is not stored until you do.</Callout>

      <h2>Sandbox or production</h2>
      <p>Which Docusign environment Baton talks to is decided by two environment variables, not by anything you click in the UI. Both default to Docusign's developer sandbox, which is the right place to try Baton out - the setup card tells you when the defaults are in play.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Variable</th><th>Sandbox (default)</th><th>Production</th></tr></thead>
          <tbody>
            <tr><td><code>DOCUSIGN_OAUTH_BASE</code></td><td><code>https://account-d.docusign.com</code></td><td><code>https://account.docusign.com</code></td></tr>
            <tr><td><code>DOCUSIGN_MAESTRO_API_BASE</code></td><td><code>https://api-d.docusign.com</code></td><td><code>https://api.docusign.com</code></td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="warning" title="Register the app in the same environment">A developer-sandbox app and a production app are different registrations with different integration keys. Point these two variables at the environment your Docusign app lives in, restart the API, then connect - otherwise the OAuth redirect lands on a Docusign account that has never heard of your integration key.</Callout>

      <h2 id="multi-account">Choosing the right account when you have several</h2>
      <p>A single Docusign user can have access to multiple Docusign accounts - for example accounts for different business units. Baton stores the first account Docusign returns as the active one, so if your login reaches several you should confirm it picked the right one.</p>
      <p>Right after the OAuth redirect, Baton opens the connection panel for the new connection. When your login can reach more than one account, that panel shows a <strong>Select Account / Tenant</strong> list - click the account you want. Only owners, admins and superusers can change it.</p>
      <p>The active account is the account Baton uses for <em>every</em> Workflow Builder API call: reading workflows, launching them, and checking status. It is also how inbound Docusign Connect events find their way back to your organization, so it is worth getting right before you sync any workflows.</p>

      <Callout type="tip" title="Missed the account picker?">The picker appears on the panel that opens straight after the redirect. If you closed it, reconnect Docusign - the flow reopens the same panel.</Callout>

      <h2>The connection status indicator</h2>
      <p>The Docusign Connection card always shows a health status so you can tell at a glance whether Baton can still reach Docusign:</p>

      <TableWrap>
        <table>
          <thead><tr><th>Status</th><th>What it means</th><th>What to do</th></tr></thead>
          <tbody>
            <tr><td><Badge color="green">Healthy</Badge></td><td>Baton's Docusign token works and Workflow Builder calls succeed.</td><td>Nothing - you are good to go.</td></tr>
            <tr><td><Badge color="amber">Warning</Badge></td><td>The last health check failed, or a background token refresh could not renew the token.</td><td>Run <strong>Check Connection Status</strong>. If it stays in Warning, reconnect Docusign.</td></tr>
            <tr><td><Badge color="red">Error</Badge></td><td>The stored token is unusable.</td><td>The <strong>Disconnect</strong> button is replaced by <strong>Reconnect</strong> - use it to authorize again.</td></tr>
            <tr><td><Badge color="gray">Pending</Badge></td><td>Baton has no health result for this connection yet.</td><td>Run <strong>Check Connection Status</strong> to get one.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>A failed check settles on <Badge color="amber">Warning</Badge> rather than Error, so Warning is the state you will normally see when something is wrong.</p>

      <h3>Check Connection Status</h3>
      <p>The <strong>Check Connection Status</strong> button re-checks the OAuth token on demand. When the token still works, Baton toasts <code>Connected as &lt;Name&gt;</code>, sets the card to Healthy, and fills in the <strong>Connected by</strong> and <strong>Email</strong> rows in the side panel. When it does not, you get the failure reason in an error toast and the card drops to Warning. This is the quickest way to confirm a connection or to clear a stale warning.</p>

      <h2>Token refresh is automatic</h2>
      <p>You do not have to reconnect Docusign on a routine basis. Every five minutes Baton looks for connections whose token expires within the next fifteen minutes and queues a refresh for each one, so the connection stays alive without any action from you. The <strong>Check Connection Status</strong> button is there for confirmation, not for routine maintenance.</p>
      <p>If a refresh fails - most often because the refresh token itself has expired - the card drops to <Badge color="amber">Warning</Badge> and Baton notifies your organization's admins that the connection needs to be reconnected.</p>

      <h2>Disconnecting</h2>
      <p>The <strong>Disconnect</strong> button (shown in red because it is destructive) removes Baton's access to Docusign. It is available to owners, admins and superusers, and it asks you to confirm first. Once disconnected, Baton can no longer read or trigger your Docusign workflows, so any automations that rely on them stop working until you reconnect.</p>

      <Callout type="danger" title="Disconnecting also deletes your synced workflows">Removing the connection deletes every workflow Baton synced through it, along with the API-parameter setup on those workflows. Automations that target them break, and Bulk Upload processors lose their target. After reconnecting you have to sync from Docusign again and re-check the workflows in Workflow Checker. Only disconnect if you intend to stop Baton from driving Docusign, or before reconnecting to a different account.</Callout>

      <h2>Docusign as both a destination and a source</h2>
      <p>Docusign is special. It is Baton's outbound destination - the place Baton triggers Docusign workflows - and it can also be an inbound source. Through Docusign Connect, Docusign can post envelope and recipient events back to Baton just like any other webhook source.</p>
      <p>The envelope and recipient events Baton can react to are:</p>

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
        <FlowNode k="Workflow Builder" t="Workflow A sends" d="A workflow Baton launched reaches its signature step." />
        <FlowNode k="Docusign Connect" t="envelope.completed" d="The last recipient signs and Docusign posts the event to Baton." />
        <FlowNode k="Baton" t="Automation matches" d="A Baton automation recognizes the event." />
        <FlowNode k="Workflow Builder" t="Workflow B launches" d="Baton triggers the next workflow in the chain." />
      </FlowStrip>

      <Callout type="tip" title="One connection, two directions">You never add Docusign as a source platform - it is not in the Add Platform catalog. Your OAuth connection is what identifies the inbound events: Docusign Connect stamps the account id on every payload, and Baton matches it to the connection holding that account.</Callout>

      <h3>Turning the inbound side on</h3>
      <p>The OAuth connection alone does not make events flow back in. Two things have to be true:</p>

      <ul>
        <li>A Docusign Connect configuration in your Docusign account posts to <code>/api/webhooks/docusign</code> on your Baton install, subscribed to the events you care about.</li>
        <li>The same HMAC key is set on that Connect configuration and in your API environment as <code>DOCUSIGN_CONNECT_HMAC_KEY</code>.</li>
      </ul>

      <p>Baton verifies the <code>x-docusign-signature-1</code> header on every delivery and fails closed: with no key configured the endpoint answers 500, and with a mismatched key it answers 401. Outbound launching is unaffected either way - only the inbound half needs the key.</p>

      <Callout type="tip" title="Want results before you wire up any webhooks?">Bulk Upload works the moment Docusign is connected: point it at a CSV, XLSX or TSV file and it launches a workflow for every row. No source platform, no webhook, no signing secret.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="workflows" title="Sync your workflows">With Docusign connected, pull in your Docusign workflows and check they are ready to trigger.</Card>
        <Card to="connections" title="Connect source platforms">Add the platforms that will send webhooks into Baton, such as Salesforce, HubSpot or Smartsheet.</Card>
      </Cards>
    </>
  );
}

import { Lead, Callout, TableWrap, KV, KVRow, Cards, Card, DocLink } from '../ui';

export default function Verification() {
  return (
    <>
      <h1>Webhook verification methods</h1>
      <Lead>Before Baton acts on any inbound webhook, it proves the request really came from the platform it claims to - using one of four methods, which you set up once per platform.</Lead>

      <h2>Why verification matters</h2>
      <p>A webhook URL is just an address on the internet. Without a check, anyone who learned that address could post fake events and trigger your Docusign workflows. To prevent that, every source platform uses exactly one method to prove a webhook genuinely came from it, and <strong>Baton verifies every inbound webhook before doing anything with it</strong>. If the proof is missing or wrong, the webhook is rejected and nothing runs.</p>
      <p>A webhook that passes is accepted fast: Baton answers <code>200</code> before it does any real work, so the platform never waits on it. A webhook that fails is a different story. Baton answers <code>401</code> and stops there - nothing is stored, nothing is queued, and no relay is created. That means <strong>a rejected webhook does not appear in the <DocLink to="logs">relay log</DocLink></strong>; you see it as a failed delivery in the sending platform instead.</p>
      <p>So that a silent rejection does not go unnoticed, the <strong>Webhook Failed</strong> notification alerts your organization's admins when an inbound signature is turned away. It is on by default - see <DocLink to="notifications">Notifications &amp; alerts</DocLink>.</p>

      <h2>The four methods</h2>
      <p>Each platform in the catalog uses one of the methods below. The platform's setup guide tells you which one applies, but it helps to understand what each asks of you.</p>

      <h3>HMAC signature (the default and most secure)</h3>
      <p>This is the strongest option and the one most platforms use. The platform computes a cryptographic <strong>signature</strong> over the webhook body using a <strong>shared secret</strong>, and sends that signature in a header. Baton recomputes the signature on its side and compares the two. If they do not match, the webhook is rejected.</p>
      <p>From your side the task is simple: <strong>copy the platform's signing secret into Baton</strong>. Some platforms have their own HMAC variant - HubSpot, Zendesk, and BambooHR each sign a slightly different string - but the idea is identical everywhere, and Baton handles the difference for you. For HubSpot, the signing secret is the <strong>App Client Secret</strong>; for Smartsheet it is the <strong>Shared Secret</strong> the API returns when you create the webhook.</p>
      <p>HMAC is the method behind Salesforce, HubSpot, Smartsheet, Zendesk, Greenhouse, and BambooHR. Whenever a platform supports it, prefer it.</p>

      <p><strong>Replay protection.</strong> HubSpot and Zendesk sign a timestamp alongside the body. Baton checks it and rejects anything older than <strong>5 minutes</strong>, so a captured request cannot be replayed later. The other platforms have no such window - another reason to keep the secret itself safe.</p>

      <h3>Shared token</h3>
      <p>Some platforms can post JSON but have no way to compute a signature. <strong>Airtable</strong> is the example: its automations run in a scripting sandbox with no cryptography available. For those, you choose a long random <strong>token</strong> and store it in Baton; the platform sends the same value in a header on every request, and Baton compares the two in constant time.</p>
      <p>Airtable's automation script sends the token in the <code>X-Baton-Token</code> header. Generate it with a password manager, keep it long, and never reuse it elsewhere - it is the only thing standing between the URL and an accepted event.</p>

      <h3>Basic Authentication</h3>
      <p>Other platforms cannot sign either, but they do offer standard HTTP authentication. For those you choose a <strong>username and password</strong> and enter the <em>same</em> values in both Baton and the platform. The platform sends those credentials in an Authorization header, and Baton checks both halves on every request.</p>
      <p>The most common mistake here is a mismatch: the values must be identical in both places. Basic Authentication is used by Zoho CRM and Power Automate. It is no weaker or stronger than a shared token - both send a fixed credential on every request, and both rely on HTTPS to keep it private in transit.</p>

      <h3>No signing (URL secrecy only)</h3>
      <p>One platform in the catalog cannot authenticate its webhooks at all: <strong>monday.com</strong>. For it, Baton accepts any request posted to the webhook URL. The protection comes from the URL itself - each automation's URL ends in a 64-character random key, so it is not guessable.</p>
      <p>Because there is no signature, anyone who has the URL can post events that Baton will accept. <strong>Treat the URL like a password.</strong> This is the lowest-trust option - choose a signed or credentialed method whenever the platform supports one.</p>

      <Callout type="warning" title="A webhook URL cannot be re-keyed">An automation's Webhook URL is fixed for its lifetime, so there is no way to rotate the key on a URL you think has leaked. Delete the automation and create a new one - that mints a fresh URL - then repoint the platform at it.</Callout>

      <h2>Methods at a glance</h2>
      <TableWrap>
        <table>
          <thead><tr><th>Method</th><th>What it does</th><th>What you do</th><th>Example platforms</th></tr></thead>
          <tbody>
            <tr><td>HMAC signature</td><td>Platform signs the body with a shared secret; Baton recomputes and compares.</td><td>Copy the platform's signing secret into Baton.</td><td>Salesforce, HubSpot, Smartsheet, Zendesk, Greenhouse, BambooHR</td></tr>
            <tr><td>Shared token</td><td>Platform sends a fixed token in a header; Baton compares it in constant time.</td><td>Generate a long random token and set it in both Baton and the platform.</td><td>Airtable</td></tr>
            <tr><td>Basic Authentication</td><td>Platform sends a username and password in an Authorization header; Baton checks both.</td><td>Set the same username and password in both Baton and the platform.</td><td>Zoho CRM, Power Automate</td></tr>
            <tr><td>No signing (URL secrecy)</td><td>Baton accepts any request to the URL; the URL itself holds a random key.</td><td>Keep the webhook URL private.</td><td>monday.com</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>How your secrets are protected</h2>
      <p>Whatever method a platform uses, Baton stores the secret carefully:</p>
      <KV>
        <KVRow label="Encrypted at rest">Secrets are encrypted with AES-256-GCM.</KVRow>
        <KVRow label="Never shown again">After you save a secret, it is masked as dots and never displayed back to you.</KVRow>
        <KVRow label="Never returned to the browser">The secret value is stripped from every API response, and it is never written to logs.</KVRow>
      </KV>

      <h3>Where you set and rotate a secret</h3>
      <p>Adding a platform in <DocLink to="connections">Connections</DocLink> creates the shell only - it does not ask for a secret. You enter the secret in the <DocLink to="flow-builder">Flow Builder</DocLink> automation editor, in the field under the Webhook URL. It is labelled <strong>Webhook Secret</strong> for HMAC and shared-token platforms, and <strong>Basic Auth Credentials</strong> for the ones that use a username and password.</p>
      <p>Rotating works the same way: open the automation, click <strong>Edit</strong> next to the masked value, type the new secret, and click <strong>Save</strong>. The old secret stops accepting webhooks immediately, so change the value in the platform at the same time to avoid a gap. Setting or rotating a secret requires an <strong>owner</strong>, <strong>admin</strong> or <strong>superuser</strong> role.</p>

      <h2>Why a webhook is rejected</h2>
      <p>A rejected webhook never becomes a relay, so you read the reason in the sending platform's own delivery log - it shows the HTTP status Baton returned. These are the responses you may see:</p>
      <TableWrap>
        <table>
          <thead><tr><th>Status</th><th>Reason</th><th>What happened</th></tr></thead>
          <tbody>
            <tr><td><code>401</code></td><td>Missing signature or token header</td><td>The request did not include the header the platform is supposed to send.</td></tr>
            <tr><td><code>401</code></td><td>Invalid signature</td><td>The signature did not match - almost always a wrong or changed HMAC secret.</td></tr>
            <tr><td><code>401</code></td><td>Invalid token</td><td>The shared token did not match the one stored in Baton.</td></tr>
            <tr><td><code>401</code></td><td>Invalid credentials</td><td>The Basic Auth username or password did not match what you set in Baton.</td></tr>
            <tr><td><code>401</code></td><td>Webhook timestamp too old</td><td>On HubSpot and Zendesk, the signed timestamp was more than 5 minutes old.</td></tr>
            <tr><td><code>403</code></td><td>Automation is not active</td><td>The automation behind the URL is disabled or in an error state, or its platform was removed.</td></tr>
            <tr><td><code>404</code></td><td>Unknown endpoint</td><td>The URL did not match any automation or platform - usually a truncated or outdated URL.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Chasing a rejection?">If verification keeps failing, the cause is almost always a credential that does not match. Re-copy the HMAC secret or token from the platform, or re-enter the same Basic Auth username and password in both places. The <DocLink to="troubleshooting">Troubleshooting &amp; FAQ</DocLink> page walks through each of these.</Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="connections" title="Connections">Add source platforms and see which credential each one needs.</Card>
        <Card to="troubleshooting" title="Troubleshooting &amp; FAQ">Work through verification failures and other common problems.</Card>
        <Card to="catalog" title="Supported platforms">See which verification method each platform uses.</Card>
        <Card to="custom-webhook" title="Custom POST webhooks">Bring in a source that is not in the catalog, guarded by a secret URL and an optional API key.</Card>
      </Cards>
    </>
  );
}

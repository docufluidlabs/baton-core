import { Lead, Callout, TableWrap, KV, KVRow, Cards, Card, DocLink } from '../ui';

export default function Verification() {
  return (
    <>
      <h1>Webhook verification methods</h1>
      <Lead>Before Baton acts on any inbound webhook, it proves the request really came from the platform it claims to - using one of three methods, which you set up once per platform.</Lead>

      <h2>Why verification matters</h2>
      <p>A webhook URL is just an address on the internet. Without a check, anyone who learned that address could post fake events and trigger your Docusign workflows. To prevent that, every source platform uses exactly one method to prove a webhook genuinely came from it, and <strong>Baton verifies every inbound webhook before doing anything with it</strong>. If the proof is missing or wrong, the webhook is rejected and nothing runs.</p>
      <p>Baton always responds quickly to the platform so it does not keep retrying. That means verification problems show up <em>inside Baton</em> - in the Action log - rather than as an error back to the platform.</p>

      <h2>The three methods</h2>
      <p>Each platform in the catalog uses one of the methods below. The platform's setup guide tells you which one applies, but it helps to understand what each asks of you.</p>

      <h3>HMAC signature (the default and most secure)</h3>
      <p>This is the strongest option and the one most platforms use. The platform computes a cryptographic <strong>signature</strong> over the webhook body using a <strong>shared secret</strong>, and sends that signature in a header. Baton recomputes the signature on its side and compares the two. If they do not match, the webhook is rejected.</p>
      <p>From your side the task is simple: <strong>copy the platform's signing secret into Baton</strong>. Some platforms have their own HMAC variants - HubSpot, Slack, and BambooHR each sign a little differently - but the idea is identical everywhere. For HubSpot, the signing secret is the <strong>App Client Secret</strong>.</p>
      <p>HMAC is used by HubSpot and most CRMs. Whenever a platform supports it, prefer it.</p>

      <h3>Basic Authentication</h3>
      <p>Some platforms cannot sign their payloads. For those, you choose a <strong>username and password</strong> and enter the <em>same</em> values in both Baton and the platform. The platform sends those credentials in an Authorization header, and Baton checks them on every request.</p>
      <p>The most common mistake here is a mismatch: the values must be identical in both places. Basic Authentication is used by Zoho CRM and Power Automate.</p>

      <h3>No signing (URL secrecy only)</h3>
      <p>A few platforms physically cannot sign their webhooks at all - for example monday.com. For these, Baton accepts any request posted to the webhook URL. The protection comes from the URL itself: each automation's URL contains a long, random secret, so it is not guessable.</p>
      <p>Because there is no signature, anyone who has the URL can post events that Baton will accept. <strong>Treat the URL like a password.</strong> This is the lowest-trust option - choose a real HMAC scheme whenever the platform supports one.</p>

      <Callout type="warning" title='"No signing" is the lowest-trust option'>With URL secrecy, a leaked webhook URL is enough to forge events. Keep the URL private, never post it where others can see it, and prefer HMAC whenever the platform offers it.</Callout>

      <h2>Methods at a glance</h2>
      <TableWrap>
        <table>
          <thead><tr><th>Method</th><th>What it does</th><th>What you do</th><th>Example platforms</th></tr></thead>
          <tbody>
            <tr><td>HMAC signature</td><td>Platform signs the body with a shared secret; Baton recomputes and compares.</td><td>Copy the platform's signing secret into Baton.</td><td>HubSpot, Salesforce, most CRMs</td></tr>
            <tr><td>Basic Authentication</td><td>Platform sends a username/password header; Baton checks it.</td><td>Set the same username and password in both Baton and the platform.</td><td>Zoho CRM, Power Automate</td></tr>
            <tr><td>No signing (URL secrecy)</td><td>Baton accepts any request to the URL; the URL itself holds a random secret.</td><td>Keep the webhook URL private.</td><td>monday.com</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>How your secrets are protected</h2>
      <p>Whatever method a platform uses, Baton stores the secret carefully:</p>
      <KV>
        <KVRow label="Encrypted at rest">Secrets are encrypted with AES-256-GCM.</KVRow>
        <KVRow label="Never shown again">After you save a secret, it is never displayed back to you.</KVRow>
        <KVRow label="Never returned to the browser">The secret value is not sent back to your browser, and it is never written to logs.</KVRow>
      </KV>

      <h3>Rotating a secret</h3>
      <p>To rotate a secret, update the platform connection in <DocLink to="connections">Connections</DocLink>. The old secret stops accepting webhooks immediately, so update the value in the platform at the same time to avoid a gap.</p>

      <h2>Why a webhook is rejected</h2>
      <p>When verification fails, the reason is recorded in the Action log as a verification failure. These are the reasons you may see:</p>
      <TableWrap>
        <table>
          <thead><tr><th>Reason</th><th>What happened</th></tr></thead>
          <tbody>
            <tr><td>Missing signature header</td><td>The request did not include the expected signature header.</td></tr>
            <tr><td>Signature mismatch</td><td>The signature did not match - usually a wrong or changed secret.</td></tr>
            <tr><td>Basic Auth mismatch</td><td>The username/password did not match what you set in Baton.</td></tr>
            <tr><td>Timestamp too old</td><td>For schemes with replay protection (such as Slack and HubSpot), the request was older than the allowed window of about 5 minutes.</td></tr>
            <tr><td>No automation for that URL</td><td>The URL did not match any active automation.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Chasing a rejection?">If verification keeps failing, the cause is almost always a secret that does not match. Re-copy the HMAC secret from the platform, or re-enter the same Basic Auth username and password in both places. The <DocLink to="troubleshooting">Troubleshooting &amp; FAQ</DocLink> page walks through each rejection reason.</Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="connections" title="Connections">Add source platforms and set or rotate each platform's secret.</Card>
        <Card to="troubleshooting" title="Troubleshooting &amp; FAQ">Work through verification failures and other common problems.</Card>
        <Card to="catalog" title="Supported platforms">See which verification method each platform uses.</Card>
      </Cards>
    </>
  );
}

import { Lead, Callout, TableWrap, KV, KVRow, Badge, Cards, Card, DocLink } from '../ui';

export default function Catalog() {
  return (
    <>
      <h1>Supported platforms</h1>
      <Lead>
        Baton has connectors for a broad set of business platforms, each grouped by category and using
        one verification method to prove its webhooks are genuine.
      </Lead>

      <h2>How the catalog is organized</h2>
      <p>
        Every platform in Baton's catalog has two key facts: a <strong>category</strong> (CRM, Accounting,
        HR, and so on) that tells you how it is grouped, and a <strong>verification method</strong> that
        tells you what Baton needs to trust its webhooks. For a full explanation of the methods, see{' '}
        <DocLink to="verification">Webhook verification methods</DocLink>.
      </p>
      <p>Platforms come in two states:</p>
      <KV>
        <KVRow label={<Badge color="green">Available now</Badge>}>
          Fully verified end-to-end. Add it and start building automations right away.
        </KVRow>
        <KVRow label={<Badge color="blue">Available to set up</Badge>}>
          Present in the Add-Platform list with its verification method shown. You can add it now; if you
          would like help certifying one for your setup, reach out to support.
        </KVRow>
      </KV>

      <h2>Available now</h2>
      <p>These platforms are fully verified end-to-end.</p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Platform</th><th>Category</th><th>Verification</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr><td>HubSpot</td><td>CRM</td><td>HMAC (HubSpot signature using the App Client Secret)</td><td>The reference integration.</td></tr>
            <tr><td>Salesforce</td><td>CRM</td><td>HMAC</td><td>You build the outbound webhook in your org - see the <DocLink to="salesforce">Salesforce</DocLink> page.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Available to set up</h2>
      <p>
        These platforms are present in the Add-Platform list. Each shows its verification method, so you
        know whether you will copy an HMAC secret, set a Basic Authentication username and password, or
        rely on URL secrecy.
      </p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Platform</th><th>Category</th><th>Verification</th></tr>
          </thead>
          <tbody>
            <tr><td>Salesforce</td><td>CRM</td><td>HMAC</td></tr>
            <tr><td>HubSpot</td><td>CRM</td><td>HMAC</td></tr>
            <tr><td>Zoho CRM</td><td>CRM</td><td>Basic Auth</td></tr>
            <tr><td>Zendesk</td><td>Support</td><td>HMAC</td></tr>
            <tr><td>Power Automate</td><td>Automation</td><td>Basic Auth</td></tr>
            <tr><td>Greenhouse</td><td>HR / ATS</td><td>HMAC</td></tr>
            <tr><td>monday.com</td><td>Project management</td><td>No signing (URL secrecy)</td></tr>
            <tr><td>BambooHR</td><td>HR</td><td>HMAC</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Two special cases: Docusign and Slack</h2>
      <p>
        <strong>Docusign</strong> plays two roles. It is the destination Baton triggers - your Docusign
        workflows - and it can also be an inbound <em>source</em>: Docusign Connect can post envelope and
        recipient events to Baton like any other webhook source.
      </p>
      <p>
        <strong>Slack</strong> is not a source platform - it is an <em>outbound</em> notification channel,
        the place Baton sends you alerts. For that side of Slack, see the Notifications guide.
      </p>

      <Callout type="note" title="Don't see your platform?">
        For any source system not in this list, use a <DocLink to="custom-webhook">Custom POST webhook</DocLink>{' '}
        - Baton can receive JSON from anything that can post to a URL. If you need a platform certified or
        added to the catalog, email{' '}
        <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
      </Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="connections" title="Connections">Add a platform from the catalog and set its secret.</Card>
        <Card to="custom-webhook" title="Custom POST webhooks">Bring in any source that can post JSON but is not in the catalog.</Card>
        <Card to="verification" title="Webhook verification methods">Understand the HMAC, Basic Auth, and URL-secrecy methods.</Card>
      </Cards>
    </>
  );
}

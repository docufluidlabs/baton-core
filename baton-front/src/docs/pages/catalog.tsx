import { Lead, Callout, TableWrap, Badge, Cards, Card, DocLink } from '../ui';

export default function Catalog() {
  return (
    <>
      <h1>Supported platforms</h1>
      <Lead>
        Baton's catalog holds ten source platforms. Each one is grouped by category and uses exactly one
        verification method to prove its webhooks are genuine.
      </Lead>

      <h2>How the catalog is organized</h2>
      <p>
        Every platform carries two facts worth knowing before you add it: a <strong>category</strong>{' '}
        (CRM, Support, HR, and so on) that tells you how it is grouped, and a{' '}
        <strong>verification method</strong> that tells you what Baton needs in order to trust its
        webhooks. For a full explanation of the methods, see{' '}
        <DocLink to="verification">Webhook verification methods</DocLink>.
      </p>
      <p>
        You meet the catalog in two places. <strong>Add Platform</strong> on{' '}
        <DocLink to="connections">Connections</DocLink> lists every entry with its category badge - for
        example <Badge color="gray">CRM</Badge> - and the style of credential it asks for. Each platform's{' '}
        <DocLink to="setup">setup guide</DocLink> then gives you the exact steps, the events you can
        trigger on, and a troubleshooting checklist. The platform names below link straight to those
        guides.
      </p>

      <h2>The catalog</h2>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Platform</th><th>Category</th><th>Verification</th><th>What you enter in Baton</th></tr>
          </thead>
          <tbody>
            <tr><td><DocLink to="salesforce">Salesforce</DocLink></td><td>CRM</td><td>HMAC signature</td><td>Webhook Secret Key</td></tr>
            <tr><td><DocLink to="setup/hubspot">HubSpot</DocLink></td><td>CRM</td><td>HMAC signature</td><td>App Client Secret</td></tr>
            <tr><td><DocLink to="setup/zohocrm">Zoho CRM</DocLink></td><td>CRM</td><td>Basic Authentication</td><td>A username and password you choose</td></tr>
            <tr><td><DocLink to="setup/powerautomate">Microsoft Power Automate</DocLink></td><td>Automation</td><td>Basic Authentication</td><td>A username and password you choose</td></tr>
            <tr><td><DocLink to="setup/airtable">Airtable</DocLink></td><td>Database</td><td>Shared token</td><td>A long random Webhook Token, sent in <code>X-Baton-Token</code></td></tr>
            <tr><td><DocLink to="setup/smartsheet">Smartsheet</DocLink></td><td>Productivity</td><td>HMAC signature</td><td>The Shared Secret the Smartsheet API returns</td></tr>
            <tr><td><DocLink to="setup/zendesk">Zendesk</DocLink></td><td>Support</td><td>HMAC signature</td><td>Webhook Signing Secret</td></tr>
            <tr><td><DocLink to="setup/greenhouse">Greenhouse</DocLink></td><td>HR / Recruiting</td><td>HMAC signature</td><td>Secret Key</td></tr>
            <tr><td><DocLink to="setup/mondaycom">monday.com</DocLink></td><td>Project Management</td><td>No signing (URL secrecy)</td><td>Nothing - keep the webhook URL private</td></tr>
            <tr><td><DocLink to="setup/bamboohr">BambooHR</DocLink></td><td>HR</td><td>HMAC signature</td><td>A Webhook Secret Key you choose</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        Every platform above follows the same data-driven walkthrough, with one exception:{' '}
        <strong>Salesforce</strong> has no native outbound webhook, so you build the outbound call in your
        own org. It has its own <DocLink to="salesforce">setup guide</DocLink>.
      </p>

      <p>
        Not every launch needs a source platform at all. <strong>Bulk Upload</strong> in the sidebar takes
        a CSV, XLSX or TSV file as the trigger and launches a workflow for every row - no platform, no
        webhook and no secret.
      </p>

      <h2>Two special cases: Docusign and Slack</h2>
      <p>
        <strong>Docusign</strong> plays two roles, and neither is a catalog entry. It is the destination
        every automation launches into - your Docusign Workflow Builder workflows - and it is the one
        platform that also reports back: Docusign Connect posts envelope and recipient events to{' '}
        <code>/api/webhooks/docusign</code>, verified against the{' '}
        <code>DOCUSIGN_CONNECT_HMAC_KEY</code> set on your API. You never add Docusign under Add Platform;
        the single OAuth link you make on Connections covers both directions. See{' '}
        <DocLink to="connect-docusign">Connect Docusign</DocLink>.
      </p>
      <p>
        <strong>Slack</strong> is not a source platform either - it is an <em>outbound</em> notification
        channel, the place Baton sends you alerts. You configure it on the Notifications page; see{' '}
        <DocLink to="notifications">Notifications &amp; alerts</DocLink>.
      </p>

      <Callout type="note" title="Don't see your platform?">
        For any source system not in this list, use a <DocLink to="custom-webhook">Custom POST webhook</DocLink>{' '}
        - Baton can receive JSON from anything that can post to a URL. If you need a platform certified or
        added to the catalog, email{' '}
        <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
      </Callout>

      <h2>Related pages</h2>
      <Cards>
        <Card to="connections" title="Connections">Add a platform from the catalog and see what each card offers.</Card>
        <Card to="setup" title="Setup guides">Step-by-step webhook setup for every platform in the catalog.</Card>
        <Card to="verification" title="Webhook verification methods">Understand HMAC, shared tokens, Basic Authentication, and URL secrecy.</Card>
        <Card to="custom-webhook" title="Custom POST webhooks">Bring in any source that can post JSON but is not in the catalog.</Card>
      </Cards>
    </>
  );
}

import { Lead, DocLink, KV, KVRow, Callout, TableWrap, Cards, Card } from '../ui';

export default function Concepts() {
  return (
    <>
      <h1>Core concepts</h1>
      <Lead>A short reference of the terms you will meet throughout Baton, grouped by the part they play in getting an event to a Docusign workflow.</Lead>

      <p>You do not need to read this end to end. Skim for the term you need, or read it once to build a mental model before you start in <DocLink to="quick-start">Quick start</DocLink>.</p>

      <h2>The players: systems Baton connects</h2>
      <p>These are the external systems involved in every Baton automation.</p>

      <KV>
        <KVRow label="Connection">An authenticated link between Baton and an external system. Today only <strong>Docusign</strong> requires a connection, set up through OAuth. Source platforms do not need one. Until Docusign is connected, the Flow Builder, Bulk Upload, Workflow Checker, and Control Center entries in the sidebar stay disabled.</KVRow>
        <KVRow label="Source platform">Any external business platform that sends webhooks to Baton - Salesforce, HubSpot, Zoho CRM, Zendesk, Smartsheet, Airtable, BambooHR, and more. A source platform needs no OAuth; it only needs your webhook URL. The <DocLink to="setup">setup guides</DocLink> always list the current catalog.</KVRow>
        <KVRow label="Docusign Workflow Builder">Docusign's workflow orchestration product. Baton triggers Workflow Builder's workflows; it has none of its own.</KVRow>
        <KVRow label="Extension App">A Docusign or partner app that runs as a step <em>inside</em> a Docusign workflow. Baton does not replace these - Workflow Builder uses them after Baton triggers a workflow.</KVRow>
      </KV>

      <h2>What you build inside Baton</h2>
      <p>These are the pieces you configure to get an event - or a spreadsheet row - into a Docusign workflow.</p>

      <h3>Automation</h3>
      <p>A configured pairing of a source platform's webhook URL with a Docusign workflow. Each automation has its own webhook URL. On the Flow Builder, an automation is the middle card between the platform and the workflow.</p>

      <h3>Webhook URL</h3>
      <p>A unique URL Baton generates for a specific automation. You paste it into the source platform's webhook settings. It is permanent for the life of the automation, so you only need to set it in the platform once - the automation editor labels the saved value <strong>Permanent Webhook URL</strong>.</p>

      <h3>Custom POST endpoint</h3>
      <p>A standalone endpoint for a source that is not in the catalog. You give it a name, a target workflow, and the path to the record ID inside your JSON; Baton hands back a URL and launches the workflow on every POST. It is its own object on the Flow Builder canvas, separate from an automation - see <DocLink to="custom-webhook">Custom POST webhooks</DocLink>.</p>

      <h3>Workflow</h3>
      <p>A workflow built in Docusign Workflow Builder. Baton triggers Workflow Builder's workflows and never has any of its own. A workflow's start trigger declares the parameters it expects, which is the contract Baton matches against.</p>

      <h3>Object ID</h3>
      <p>The identifier extracted from a webhook payload and passed to Workflow Builder as a parameter. The field name is not fixed by Baton - it comes from the Docusign workflow's parameter contract. For example, if the workflow expects <code>objectId</code> and the payload contains <code>objectId: 757533273294</code>, Baton matches them and tags the resulting run with that id.</p>

      <h3>Bulk Upload</h3>
      <p>The manual counterpart to an automation. Instead of waiting for a webhook, you upload a CSV, XLSX or TSV file and Baton launches the target workflow once per row. Each upload is a <strong>run</strong>, each line of the file is a <strong>row</strong>, and rows are released on a throttle you set - 5 every 10 minutes by default - so a large file never floods Docusign. It has its own <strong>Bulk Upload</strong> page because the file is the trigger, wherever it was exported from. See <DocLink to="bulk-upload">Bulk Upload</DocLink>.</p>

      <h2>How a webhook is trusted: verification</h2>
      <p>Before Baton launches anything, it confirms the webhook is genuine. Each platform in the catalog uses exactly one of these methods.</p>

      <KV>
        <KVRow label="HMAC">The platform signs the payload with a shared secret and Baton validates the signature. The strongest option, and the one Salesforce, HubSpot, and most CRMs use.</KVRow>
        <KVRow label="Basic Authentication">A username and password header that Baton validates. Used by platforms that cannot sign a payload, such as Zoho CRM and Power Automate.</KVRow>
        <KVRow label="Shared token">A long random token you choose, sent in a header and compared on every request. Used where the platform's scripting environment has no crypto primitives, such as Airtable.</KVRow>
        <KVRow label="No signing">No proof at all - the protection is the secret, unguessable webhook URL. Used by monday.com.</KVRow>
      </KV>

      <Callout type="note" title="Every secret is write-only">Any secret you enter is encrypted at rest and is never shown again after you save it. Where a platform does not sign, the URL <em>is</em> the secret, so treat it like a password. <DocLink to="verification">Verification methods</DocLink> covers each one in full.</Callout>

      <h2>What runs: relays and instances</h2>
      <p>These two terms describe what actually happens when a webhook arrives and a workflow launches.</p>

      <KV>
        <KVRow label="Relay">One webhook that was successfully verified <em>and</em> routed to a Docusign workflow. Baton numbers them per automation - Relay 1, Relay 2, and so on - and each platform card counts them as "N relays this month". Older notes call a relay an <strong>Action</strong>; see <DocLink to="logs">Relay logs</DocLink>.</KVRow>
        <KVRow label="Instance">A single execution (run) of a Docusign workflow. Baton polls Workflow Builder for status and shows each instance as Running, Completed, Failed, or Cancelled.</KVRow>
      </KV>

      <Callout type="note" title="Overdue is a Baton state, not a Docusign one">Give an automation or a Bulk Upload an expected duration in days, and any instance still running past it is flagged <strong>Overdue</strong> in the Control Center, where an <strong>Add days</strong> control postpones it. Docusign has no such state - a signature workflow simply waits on a human.</Callout>

      <h2>Roles: who uses Baton</h2>
      <p>Every member of an organization has one of four roles. Invite people and change roles from <strong>Settings → Members</strong>; an invite can be Admin, Member, or Viewer.</p>

      <KV>
        <KVRow label="Owner">The user who set up the organization during first-run setup. Full control, including member management.</KVRow>
        <KVRow label="Admin">Same day-to-day powers as the owner: manages connections, platforms, automations, secrets, settings, and members.</KVRow>
        <KVRow label="Member">Operates automations - creates and edits them, launches and re-syncs workflows, runs Bulk Uploads, retries failed instances - but cannot manage connections, platforms, organization settings, or members.</KVRow>
        <KVRow label="Viewer">Read-only access to everything: automations, workflows, logs, and instances.</KVRow>
      </KV>

      <h2>The screens you will use</h2>
      <p>Baton's terms map onto a handful of pages, named here exactly as the sidebar names them.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Screen</th><th>What it is for</th></tr></thead>
          <tbody>
            <tr><td>Flow Builder</td><td>The landing page: a visual canvas of platform → automation → workflow, where you add and manage automations.</td></tr>
            <tr><td>Bulk Upload</td><td>Launch a workflow for every row of a CSV, XLSX or TSV file, released on a throttle you set.</td></tr>
            <tr><td>Workflow Checker</td><td>Sync workflows from Docusign Workflow Builder, see which ones have their API parameters set up, and launch any of them for testing.</td></tr>
            <tr><td><DocLink to="control-center">Control Center</DocLink></td><td>Where you clear failed and overdue workflow instances - Try Again, Cancel, or Add days to postpone them.</td></tr>
            <tr><td>Connections</td><td>Where you connect Docusign and add source platforms.</td></tr>
            <tr><td>Notifications</td><td>Alert preferences, Slack routing, and the in-app inbox.</td></tr>
            <tr><td>Settings</td><td>Organization details, members, and the audit log.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Keep going</h2>
      <Cards>
        <Card to="how-it-works" title="How Baton works">See how these concepts fit together across the full webhook-to-workflow lifecycle.</Card>
        <Card to="quick-start" title="Quick start">Put the concepts to use: connect Docusign and build your first automation.</Card>
      </Cards>
    </>
  );
}

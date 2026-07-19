import { Lead, DocLink, KV, KVRow, Callout, TableWrap, Cards, Card } from '../ui';

export default function Concepts() {
  return (
    <>
      <h1>Core concepts</h1>
      <Lead>A short reference of the terms you will meet throughout Baton, grouped by the part they play in getting a webhook to a Docusign Maestro workflow.</Lead>

      <p>You do not need to read this end to end. Skim for the term you need, or read it once to build a mental model before you start in <DocLink to="quick-start">Quick start</DocLink>.</p>

      <h2>The players: systems Baton connects</h2>
      <p>These are the external systems involved in every Baton automation.</p>

      <KV>
        <KVRow label="Connection">An authenticated link between Baton and an external system. Today only <strong>Docusign</strong> requires a connection, set up through OAuth. Source platforms do not need a connection.</KVRow>
        <KVRow label="Source platform">Any external business platform that sends webhooks to Baton — HubSpot, Salesforce, Procore, Xero, BambooHR, and others. A source platform needs no OAuth; it only needs your webhook URL.</KVRow>
        <KVRow label="Docusign Maestro">Docusign's workflow orchestration product. Baton triggers Maestro's workflows; it has none of its own.</KVRow>
        <KVRow label="Extension App">A Docusign or partner app that runs as a step <em>inside</em> a Maestro workflow. Baton does not replace these — Maestro uses them after Baton triggers a workflow.</KVRow>
      </KV>

      <h2>What you build: automations and their parts</h2>
      <p>These are the pieces you configure inside Baton to wire a platform to a workflow.</p>

      <h3>Automation</h3>
      <p>A configured pairing of a source platform's webhook URL with a Maestro workflow. Each automation has its own webhook URL. On the Flow Builder, an automation is the middle card between the platform and the workflow.</p>

      <h3>Endpoint / Webhook URL</h3>
      <p>A unique URL Baton generates for a specific automation. You paste it into the source platform's webhook settings. It is permanent for the life of the automation, so you only need to set it in the platform once.</p>

      <h3>Workflow</h3>
      <p>A Maestro workflow. Baton triggers Maestro's workflows and never has any of its own. A workflow's start trigger declares the parameters it expects, which is the contract Baton matches against.</p>

      <h3>Object ID</h3>
      <p>The identifier extracted from a webhook payload and passed to Maestro as a parameter. The field name is not fixed by Baton — it comes from the Maestro workflow's parameter contract. For example, if the workflow expects <code>objectId</code> and the payload contains <code>objectId: 757533273294</code>, Baton matches them and tags the resulting run with that id.</p>

      <h2>How a webhook is trusted: verification</h2>
      <p>Before Baton launches anything, it confirms the webhook is genuine using one of these methods.</p>

      <KV>
        <KVRow label="HMAC">A verification method where the platform signs the payload with a shared secret and Baton validates the signature. Used by HubSpot and most CRMs.</KVRow>
        <KVRow label="Basic Authentication">The other method: a username and password header that Baton validates. Used by platforms that do not offer HMAC.</KVRow>
      </KV>

      <Callout type="note" title="Some platforms rely on the secret URL alone">A few platforms do not sign their webhooks at all and instead rely on the secret, unguessable webhook URL. Whichever method applies, any secret you enter is stored encrypted and is never shown again after you save it.</Callout>

      <h2>What runs: actions and instances</h2>
      <p>These two terms describe what actually happens when a webhook arrives and a workflow launches.</p>

      <KV>
        <KVRow label="Action">One webhook that was successfully verified <em>and</em> routed to a Maestro workflow. On metered plans, the action is the unit of billing.</KVRow>
        <KVRow label="Instance">A single execution (run) of a Maestro workflow. Baton can monitor instances and shows their status as Running, Completed, Failed, or Cancelled.</KVRow>
      </KV>

      <Callout type="warning" title="&quot;Action&quot; and &quot;Execution&quot; are the same thing">The Notifications page sometimes calls an action an "Execution." Both words refer to the same event: a webhook that was verified and routed to a workflow.</Callout>

      <h2>Roles: who uses Baton</h2>
      <p>Baton has a single role.</p>

      <KV>
        <KVRow label="Admin">The only role. Every signed-in user is an admin of their organization and manages its connections, automations, and notifications. There are no other permission levels to assign.</KVRow>
      </KV>

      <h2>The screens you will use</h2>
      <p>Baton's terms map onto a handful of pages. One naming detail is worth knowing up front.</p>

      <TableWrap>
        <table>
          <thead><tr><th>Screen</th><th>What it is for</th></tr></thead>
          <tbody>
            <tr><td>Flow Builder</td><td>The home page: a visual canvas of platform → automation → workflow, where you add and manage automations.</td></tr>
            <tr><td>Resolution Center</td><td>Where you clear failed Maestro instances — retry, cancel, or report them.</td></tr>
            <tr><td>Workflow Checker</td><td>Lists every synced Maestro workflow and lets you launch any of them for testing.</td></tr>
            <tr><td>Connections</td><td>Where you connect Docusign and add source platforms.</td></tr>
            <tr><td>Notifications</td><td>The inbox of live status updates for your runs.</td></tr>
            <tr><td>Settings</td><td>Organization and account settings.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="&quot;Workflow Checker&quot; vs &quot;Maestro Workflows&quot;">The page is called the Workflow Checker, but its on-screen header reads "Maestro Workflows." They are the same page — it lists your synced workflows so you can test-launch any of them.</Callout>

      <h2>Keep going</h2>
      <Cards>
        <Card to="how-it-works" title="How Baton works">See how these concepts fit together across the full webhook-to-workflow lifecycle.</Card>
        <Card to="quick-start" title="Quick start">Put the concepts to use: connect Docusign and build your first automation.</Card>
      </Cards>
    </>
  );
}

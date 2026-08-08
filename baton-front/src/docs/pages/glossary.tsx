import { Lead, Callout, KV, KVRow, DocLink } from '../ui';

export default function Glossary() {
  return (
    <>
      <h1>Glossary</h1>
      <Lead>Plain-language definitions of the terms you'll meet across Baton, listed alphabetically.</Lead>

      <KV>
        <KVRow label="Action">
          The older name for a <strong>relay</strong>. Same thing - see Relay below.
        </KVRow>
        <KVRow label="Admin">
          One of Baton's four roles (owner, admin, member, viewer). Admins manage connections, platforms,
          automations, secrets, settings, and members. Roles are assigned from Settings → Members, where you
          also invite people with an invite link. See <DocLink to="settings">Settings</DocLink>.
        </KVRow>
        <KVRow label="Automation">
          A configured pairing of a source platform's webhook URL with a Docusign workflow - the middle card
          on the <DocLink to="flow-builder">Flow Builder</DocLink>. Each automation has its own webhook URL.
        </KVRow>
        <KVRow label="Basic Authentication">
          A verification method: a username and password sent in a header, which Baton validates against the
          values you set. See <DocLink to="verification">Webhook verification methods</DocLink>.
        </KVRow>
        <KVRow label="Bulk Upload">
          The manual counterpart to an automation: upload a CSV, XLSX or TSV file and Baton launches the target
          workflow once per row. Each upload is a <strong>run</strong>, each line of the file is a{' '}
          <strong>row</strong>, and rows are released on a throttle you set - 5 every 10 minutes by default.
        </KVRow>
        <KVRow label="Conditions">
          Optional filters that decide whether a verified webhook should trigger the workflow. See{' '}
          <DocLink to="conditions">Conditions &amp; field mapping</DocLink>.
        </KVRow>
        <KVRow label="Connection">
          An authenticated link between Baton and an external system. Only Docusign requires a connection
          (over OAuth); source platforms do not. Until Docusign is connected, the Flow Builder, Bulk Upload,
          Workflow Checker, and Control Center entries in the sidebar stay disabled.
        </KVRow>
        <KVRow label="Control Center">
          The page where you clear failed and overdue workflow instances: <strong>Try Again</strong>,{' '}
          <strong>Cancel</strong>, or <strong>Add days</strong> to postpone one. Older notes call it the
          Resolution Center. See <DocLink to="control-center">Control Center</DocLink>.
        </KVRow>
        <KVRow label="Custom POST endpoint">
          A standalone webhook URL for a source that is not in the catalog: you name it, choose a target
          workflow, and give the path to the record id inside your JSON. See{' '}
          <DocLink to="custom-webhook">Custom POST webhooks</DocLink>.
        </KVRow>
        <KVRow label="Docusign Connect">
          Docusign's outbound event system. It can post envelope and recipient events to Baton like any
          other webhook source - your OAuth connection is what identifies them. See{' '}
          <DocLink to="connect-docusign">Connect Docusign</DocLink>.
        </KVRow>
        <KVRow label="Docusign Workflow Builder">
          Docusign's workflow-orchestration product. Baton triggers its workflows.
        </KVRow>
        <KVRow label="Endpoint / Webhook URL">
          The unique URL Baton generates for each automation, which you paste into the source platform. Baton
          shows it before you save, so you can wire up the platform first, and it is permanent for the
          automation's life - the editor labels the saved value <strong>Permanent Webhook URL</strong>.
        </KVRow>
        <KVRow label="Extension App">
          A Docusign or partner app that runs as a step inside a Docusign workflow. Baton does not replace
          these.
        </KVRow>
        <KVRow label="Field mapping">
          An optional rule that says where each workflow parameter's value comes from: a path in the payload,
          a fixed static value, or a template. Use it when the payload's field names do not match the
          parameter names the workflow expects. See{' '}
          <DocLink to="conditions">Conditions &amp; field mapping</DocLink>.
        </KVRow>
        <KVRow label="Flow Builder">
          Baton's landing page: the visual canvas of platform → automation → workflow, where you add and
          manage automations. See <DocLink to="flow-builder">Flow Builder</DocLink>.
        </KVRow>
        <KVRow label="HMAC">
          A verification method: the platform signs the payload with a shared secret, and Baton validates
          the signature. See <DocLink to="verification">Webhook verification methods</DocLink>.
        </KVRow>
        <KVRow label="Instance">
          One execution (run) of a Docusign workflow. Baton polls Workflow Builder for its status and shows it
          as Running, Completed, Failed, or Cancelled.
        </KVRow>
        <KVRow label="Object ID">
          The identifier pulled from a webhook payload and passed to Workflow Builder. The field name comes
          from the workflow's parameter contract.
        </KVRow>
        <KVRow label="Overdue">
          A Baton state, not a Docusign one: an instance still running past the expected duration, in days,
          set on its automation or Bulk Upload. Overdue instances surface in the Control Center, where{' '}
          <strong>Add days</strong> postpones one. Leave the duration empty and nothing is ever marked overdue.
        </KVRow>
        <KVRow label="Relay">
          One webhook successfully verified <em>and</em> routed to a Docusign workflow - one webhook, one
          automation, one attempt to launch. The relay log numbers them Relay 1, Relay 2, labels the copyable
          id <strong>Relay ID</strong>, and each platform card counts "N relays this month". Older notes call
          a relay an <strong>Action</strong>. See <DocLink to="logs">Relay logs &amp; instances</DocLink>.
        </KVRow>
        <KVRow label="Shared token">
          A verification method: you choose a long random token, store it in both Baton and the platform, and
          Baton compares the two on every request. Used where a platform cannot sign its payloads, such as
          Airtable. See <DocLink to="verification">Webhook verification methods</DocLink>.
        </KVRow>
        <KVRow label="Source platform">
          Any external platform that sends webhooks to Baton - Salesforce, HubSpot, Zoho CRM, Zendesk,
          Smartsheet, Airtable, BambooHR, and more. No OAuth is required; the platform only needs your webhook
          URL. The <DocLink to="setup">setup guides</DocLink> always list the current catalog.
        </KVRow>
        <KVRow label="Start trigger">
          The part of a Docusign workflow that declares the API parameters it needs to launch. Baton reads
          this to know what to look for in a payload, and the{' '}
          <DocLink to="workflows">Workflow Checker</DocLink> sorts workflows by whether it is set up.
        </KVRow>
        <KVRow label="Workflow">
          A workflow built in Docusign Workflow Builder. Baton triggers Workflow Builder's workflows and
          has none of its own.
        </KVRow>
        <KVRow label="Workflow Checker">
          Baton's page for syncing workflows from Docusign Workflow Builder, seeing which ones have their API
          parameters set up, and launching any of them for a test run. See the{' '}
          <DocLink to="workflows">Workflow Checker</DocLink>.
        </KVRow>
      </KV>

      <Callout type="note" title="New to Baton?">
        If a term is still unclear, <DocLink to="concepts">Core concepts</DocLink> groups the same ideas by the
        part they play, and the <DocLink to="how-it-works">How it works</DocLink> overview shows how these
        pieces fit together end to end.
      </Callout>
    </>
  );
}

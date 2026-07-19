import { Lead, Callout, KV, KVRow, DocLink } from '../ui';

export default function Glossary() {
  return (
    <>
      <h1>Glossary</h1>
      <Lead>Plain-language definitions of the terms you'll meet across Baton, listed alphabetically.</Lead>

      <KV>
        <KVRow label="Action">
          One webhook successfully verified <em>and</em> routed to a Docusign workflow. (The Notifications
          page sometimes calls this an "Execution"; they mean the same thing.)
        </KVRow>
        <KVRow label="Admin">
          One of Baton's four roles (owner, admin, member, viewer). Admins manage connections, platforms,
          automations, settings, and members. Roles are assigned from Settings → Members, where you can
          also invite people with an invite link.
        </KVRow>
        <KVRow label="Automation">
          A configured pairing of a source platform's webhook URL with a Docusign workflow - the middle card
          on the <DocLink to="flow-builder">Flow Builder</DocLink>. Each automation has its own webhook URL.
        </KVRow>
        <KVRow label="Basic Authentication">
          A verification method: a username and password sent in a header, which Baton validates against the
          values you set. See <DocLink to="verification">Webhook verification methods</DocLink>.
        </KVRow>
        <KVRow label="Connection">
          An authenticated link between Baton and an external system. Only Docusign requires a connection
          (over OAuth); source platforms do not.
        </KVRow>
        <KVRow label="Resolution Center">
          The page where you clear failed workflow instances - retry, cancel, or report them. See{' '}
          <DocLink to="control-center">Resolution Center</DocLink>.
        </KVRow>
        <KVRow label="Docusign Connect">
          Docusign's outbound event system. It can post envelope and recipient events to Baton like any
          other webhook source.
        </KVRow>
        <KVRow label="Docusign Workflow Builder">
          Docusign's workflow-orchestration product. Baton triggers its workflows.
        </KVRow>
        <KVRow label="Endpoint / Webhook URL">
          The unique URL Baton generates for each automation, which you paste into the source platform. It
          is permanent for the automation's life.
        </KVRow>
        <KVRow label="Extension App">
          A Docusign or partner app that runs as a step inside a Docusign workflow. Baton does not replace
          these.
        </KVRow>
        <KVRow label="Field mapping">
          An optional rule that renames payload fields to the parameter names a Docusign workflow expects.
        </KVRow>
        <KVRow label="Flow Builder">
          Baton's main page: the visual canvas of platform → automation → workflow. See{' '}
          <DocLink to="flow-builder">Flow Builder</DocLink>.
        </KVRow>
        <KVRow label="HMAC">
          A verification method: the platform signs the payload with a shared secret, and Baton validates
          the signature. See <DocLink to="verification">Webhook verification methods</DocLink>.
        </KVRow>
        <KVRow label="Instance">One execution (run) of a Docusign workflow.</KVRow>
        <KVRow label="Object ID">
          The identifier pulled from a webhook payload and passed to Workflow Builder. The field name comes
          from the workflow's parameter contract.
        </KVRow>
        <KVRow label="Preflight">
          The validation Baton runs before saving an automation - checking the secret format, that the
          workflow is reachable, and the parameter shape.
        </KVRow>
        <KVRow label="Rule conditions">
          Optional filters that decide whether a verified webhook should trigger the workflow.
        </KVRow>
        <KVRow label="Source platform">
          Any external platform that sends webhooks to Baton. No OAuth is required. See the{' '}
          <DocLink to="catalog">supported platforms</DocLink>.
        </KVRow>
        <KVRow label="Start trigger">
          The part of a Docusign workflow that declares the API parameters it needs to launch. Baton reads
          this to know what to look for in a payload.
        </KVRow>
        <KVRow label="Workflow">
          A workflow built in Docusign Workflow Builder. Baton triggers Workflow Builder's workflows and
          has none of its own.
        </KVRow>
        <KVRow label="Workflow Checker">
          Baton's page that lists synced Docusign workflows and lets you launch any of them for testing.
          See the <DocLink to="workflows">Workflow Checker</DocLink>.
        </KVRow>
      </KV>

      <Callout type="note" title="New to Baton?">
        If a term is still unclear, the <DocLink to="how-it-works">How it works</DocLink> overview shows how
        these pieces fit together end to end.
      </Callout>
    </>
  );
}

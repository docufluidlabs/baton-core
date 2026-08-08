import { Lead, Callout, Steps, Step, DocLink, FlowStrip, FlowNode, Cards, Card } from '../ui';

export default function QuickStart() {
  return (
    <>
      <h1>Quick start</h1>
      <Lead>Connect Docusign, sync your Workflow Builder workflows, add a source platform, and wire your first live automation - in the order an admin actually does it.</Lead>

      <h2>Before you begin</h2>
      <p>This walkthrough assumes you have everything Baton needs to reach both ends of an automation.</p>

      <Callout type="note" title="What you need">A Docusign account with at least one active Workflow Builder workflow that starts from an HTTP (API) trigger, and admin access to your source platform (such as HubSpot) so you can paste a webhook URL into its settings.</Callout>

      <h2>Step 1 - Sign in and create your organization</h2>
      <p>On a brand-new install, the first person to open Baton gets the <strong>Set up Baton</strong> screen: name the organization and create the first account. That account becomes the <strong>owner</strong>. Everyone after that signs in normally or joins from an invite link, which an owner or admin creates in <DocLink to="settings">Settings → Members</DocLink> with the role admin, member, or viewer. Invite links expire after 72 hours.</p>

      <h2>Step 2 - Connect Docusign</h2>
      <p>Docusign is the one connection Baton requires. Until it is in place, <strong>Flow Builder</strong>, <strong>Bulk Upload</strong>, <strong>Workflow Checker</strong>, and <strong>Control Center</strong> sit greyed out in the sidebar, and opening any of their URLs directly sends you back to Connections.</p>

      <Steps>
        <Step title="Open Connections"> Go to the <DocLink to="connections">Connections</DocLink> page.</Step>
        <Step title="Connect Docusign"> Press <strong>Connect Docusign</strong> on the Docusign Connection card to start the OAuth flow. For a full walkthrough of this step, see <DocLink to="connect-docusign">Connect Docusign</DocLink>.</Step>
        <Step title="Pick the active account"> If your Docusign login reaches more than one account, the connection detail opens after the redirect with a <strong>Select Account / Tenant</strong> list - choose the account you want Baton to use.</Step>
      </Steps>

      <Callout type="tip" title="Confirm the connection before you build on it">Open the Docusign card and press <strong>Check Connection Status</strong>. It reports the account name and the user Baton is acting as, so you know the token works before anything depends on it.</Callout>

      <h2>Step 3 - Sync your workflows</h2>
      <p>With Docusign connected, Baton can pull your workflows from Docusign Workflow Builder.</p>

      <Steps>
        <Step title="Open Workflow Checker"> Go to the <DocLink to="workflows">Workflow Checker</DocLink>.</Step>
        <Step title="Sync"> Click <strong>Sync from Docusign</strong> to pull in or refresh your workflows.</Step>
        <Step title="See which workflows are ready"> Synced workflows land in one of two sections: <strong>API Parameters Ready</strong> and <strong>API Parameters Not Set Up</strong>. The first group publishes trigger inputs Baton can fill from an incoming webhook. For the second group, publish the inputs in Workflow Builder and sync again.</Step>
      </Steps>

      <h2>Step 4 - Test-launch a workflow (recommended)</h2>
      <p>Before wiring a live automation, confirm the workflow itself works by launching it by hand.</p>

      <Steps>
        <Step title="Fill in the parameters"> On the <DocLink to="workflows">Workflow Checker</DocLink>, expand a workflow and enter values for its parameters. Required ones carry a red asterisk.</Step>
        <Step title="Run the test"> Click <strong>Run Test</strong> - it stays disabled until every required parameter has a value. The run appears in that workflow's launch history, so a clean result here proves the workflow is ready before you connect a live source.</Step>
      </Steps>

      <h2>Step 5 - Add your source platform</h2>
      <p>Adding a platform creates the shell that receives and verifies that platform's webhooks. It does not start an OAuth flow - Baton only needs somewhere to accept the events. Platforms that do offer OAuth appear separately, under <strong>OAuth Connections</strong>.</p>

      <Steps>
        <Step title="Add the platform"> On <DocLink to="connections">Connections</DocLink>, press <strong>Add Platform</strong> in the Connected Platforms section. The button appears for the owner, admin, and superuser roles.</Step>
        <Step title="Select your platform"> Search the catalog and press <strong>Add</strong>. HubSpot, Smartsheet, Airtable, and every other source install the same way, and each card then carries a <strong>How to install</strong> button that opens its setup guide.</Step>
      </Steps>

      <Callout type="note" title="You can let Baton do this for you">The New Automation panel lists catalog platforms you have not added yet under <strong>Available</strong> and installs the one you pick, so you can jump straight to Step 6.</Callout>

      <h2>Step 6 - Build your first automation</h2>
      <p>An automation pairs one platform's webhook URL with one target Docusign workflow.</p>

      <Steps>
        <Step title="Add an automation"> Go to <DocLink to="flow-builder">Flow Builder</DocLink> and choose <strong>+ Add Automation</strong>. The blue <strong>+</strong> on a platform card opens the same panel with that platform preselected.</Step>
        <Step title="Choose the Webhook Source"> Pick the platform you added in Step 5.</Step>
        <Step title="Name the automation"> Give it a name you will recognize in the canvas and in alerts.</Step>
        <Step title="Choose the Target Docusign Workflow"> Only workflows that are active in Workflow Builder are listed, and a workflow already used by another automation is hidden - one workflow, one automation. Optionally set an <strong>Expected workflow instance duration</strong> in days; instances that run longer are flagged Overdue in Control Center.</Step>
        <Step title="Map the API parameters"> Under <strong>Workflow Builder API Parameters</strong>, give each workflow input a value: <strong>Path</strong> reads from the webhook payload (for example <code>$.data.project_id</code>), <strong>Static</strong> sends a fixed value, and <strong>Template</strong> interpolates <code>{'{{field}}'}</code>. Leave a row empty to skip it.</Step>
        <Step title="Copy the Webhook URL"> Baton generates the URL as soon as you pick a source and it stays with the automation for its lifetime - copy it; you will paste it into the platform next.</Step>
        <Step title="Save the verification secret"> Enter the HMAC secret or Basic Auth credentials the platform will use to sign its webhooks, then press <strong>Save</strong> next to the field. This is a separate save from the button below it.</Step>
        <Step title="Create it"> Press <strong>Create Automation</strong>. It stays disabled until the name, source, and target workflow are set and the webhook secret has been saved - if the unsaved secret is the only thing left, an inline hint says so.</Step>
      </Steps>

      <Callout type="note" title="Automations match every event from their source">There is no per-event filter in the panel today: any webhook the source posts to this URL is verified and routed to the target workflow. Narrow the trigger on the platform side if you only want certain events sent.</Callout>

      <h2>Step 7 - Paste the Webhook URL into your platform</h2>
      <p>Open your source platform's webhook settings, paste the URL you copied in Step 6, and set the same secret there. Every platform card on <DocLink to="connections">Connections</DocLink> has a <strong>How to install</strong> button that opens that platform's step-by-step instructions in a new tab; the same walkthroughs live here under <DocLink to="setup">Setup guides</DocLink>.</p>

      <h2>Step 8 - Trigger a test event</h2>
      <p>Fire a test event in your source platform to see the whole chain run end to end: Baton verifies the signature, matches the automation, maps the payload, and launches the workflow.</p>

      <h2>What success looks like</h2>
      <p>Within seconds of triggering a test event, you should see all of the following:</p>

      <FlowStrip>
        <FlowNode k="In the platform" t="Test event fires" d="You trigger an event in your source platform." />
        <FlowNode k="In Baton" t="Appears in the relay log" d="The verified, routed webhook shows up under Logs on the automation card." />
        <FlowNode k="In Workflow Builder" t="Instance launches" d="A matching workflow instance starts running." />
        <FlowNode k="In Flow Builder" t="Live counts update" d="Counts tick up on the automation and workflow cards." />
      </FlowStrip>

      <Callout type="tip" title="Watch the run from the canvas">On the <DocLink to="flow-builder">Flow Builder</DocLink> strip, the automation card in the middle counts running, completed, failed, and cancelled relays. Click <strong>View Instances</strong> on the workflow card to the right to open the <strong>Activity Log</strong> pre-filtered to that workflow, and follow the run's status there.</Callout>

      <h2>Where to go next</h2>
      <p>Launching a workflow for every row of a spreadsheet instead of reacting to events? That is <strong>Bulk Upload</strong> (<code>/bulk-upload</code> in the sidebar): it needs no source platform and no webhook - the file is the trigger.</p>
      <Cards>
        <Card to="how-it-works" title="How Baton works">Understand the verify-then-route model and the boundary between Baton and Workflow Builder.</Card>
        <Card to="concepts" title="Core concepts">A quick reference for every term you met in this walkthrough.</Card>
        <Card to="troubleshooting" title="Troubleshooting & FAQ">Test event never arrived, or the launch failed? Start here.</Card>
      </Cards>
    </>
  );
}

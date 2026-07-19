import { Lead, Callout, Steps, Step, DocLink, FlowStrip, FlowNode, Cards, Card } from '../ui';

export default function QuickStart() {
  return (
    <>
      <h1>Quick start</h1>
      <Lead>Connect Docusign, sync your Workflow Builder workflows, add a source platform, and wire your first live automation - in the order an admin actually does it.</Lead>

      <h2>Before you begin</h2>
      <p>This walkthrough assumes you have everything Baton needs to reach both ends of an automation.</p>

      <Callout type="note" title="What you need">A Docusign account with at least one Workflow Builder workflow, and admin access to your source platform (such as HubSpot) so you can paste a webhook URL into its settings.</Callout>

      <h2>Step 1 - Sign in and create your organization</h2>
      <p>Signing in creates or joins an organization. The user who sets it up becomes the <strong>owner</strong> and can invite teammates as admins, members, or viewers with an invite link from <DocLink to="settings">Settings → Members</DocLink>.</p>

      <h2>Step 2 - Connect Docusign</h2>
      <p>Docusign is the one connection Baton requires, and it must be in place before you can use Flow Builder, Workflow Checker, or Resolution Center - those pages redirect you to Connections until Docusign is connected.</p>

      <Steps>
        <Step title="Open Connections"> Go to the <DocLink to="connections">Connections</DocLink> page.</Step>
        <Step title="Connect Docusign"> Start the Docusign OAuth flow. For a full walkthrough of this step, see <DocLink to="connect-docusign">Connect Docusign</DocLink>.</Step>
        <Step title="Pick the active account"> If your Docusign login has access to multiple Docusign accounts, choose the one you want Baton to use.</Step>
      </Steps>

      <Callout type="warning" title="Connect Docusign first">Until Docusign is connected, the Flow Builder, Workflow Checker, and Resolution Center pages will keep redirecting you back to Connections.</Callout>

      <h2>Step 3 - Sync your workflows</h2>
      <p>After Docusign is connected, Baton syncs your workflows from Docusign Workflow Builder.</p>

      <Steps>
        <Step title="Open Workflow Checker"> Go to the <DocLink to="workflows">Workflow Checker</DocLink>.</Step>
        <Step title="Sync if needed"> Click <strong>Sync from Docusign</strong> to pull in or refresh your workflows.</Step>
        <Step title="Review the parameters"> Each synced workflow shows the API parameters its start trigger expects - these are the values Baton will look for in incoming webhooks.</Step>
      </Steps>

      <h2>Step 4 - Test-launch a workflow (recommended)</h2>
      <p>Before wiring a live automation, confirm the workflow itself works by launching it by hand.</p>

      <Steps>
        <Step title="Fill in the parameters"> On the <DocLink to="workflows">Workflow Checker</DocLink>, enter values for a workflow's parameters.</Step>
        <Step title="Run the test"> Click <strong>Run Test</strong>. A successful manual run confirms the workflow is ready before you connect a live source.</Step>
      </Steps>

      <h2>Step 5 - Add your source platform</h2>
      <p>Adding a platform creates a "platform shell" you can build automations against. Source platforms do not require OAuth.</p>

      <Steps>
        <Step title="Add the platform"> Go to <DocLink to="connections">Connections</DocLink> and choose <strong>+ Add Platform</strong>.</Step>
        <Step title="Select your platform"> Pick the source platform you want to wire up, for example HubSpot.</Step>
      </Steps>

      <h2>Step 6 - Build your first automation</h2>
      <p>An automation pairs the platform's webhook URL with a target Docusign workflow.</p>

      <Steps>
        <Step title="Add an automation"> Go to <DocLink to="flow-builder">Flow Builder</DocLink> and choose <strong>+ Add Automation</strong>.</Step>
        <Step title="Choose the source platform"> Select the platform you added in Step 5.</Step>
        <Step title="Copy the Webhook URL"> Baton generates a permanent webhook URL for this automation - copy it; you will paste it into the platform next.</Step>
        <Step title="Enter the verification secret"> Provide the HMAC secret or Basic Auth credentials the platform will use to sign or authenticate its webhooks.</Step>
        <Step title="Restrict to an event type (optional)"> Limit the automation to a specific event if you only want certain webhooks to trigger it.</Step>
        <Step title="Choose the Target Docusign Workflow"> Select which workflow this automation should launch.</Step>
        <Step title="Name it and save"> Give the automation a name. Baton runs a preflight check before enabling Save.</Step>
      </Steps>

      <h2>Step 7 - Paste the Webhook URL into your platform</h2>
      <p>Open your source platform's webhook settings and paste the URL you copied in Step 6. Each platform has its own setup guide inside Baton at <DocLink to="connections">Connections</DocLink> → the platform.</p>

      <h2>Step 8 - Trigger a test event</h2>
      <p>Fire a test event in your source platform to see the whole chain run end to end.</p>

      <h2>What success looks like</h2>
      <p>Within seconds of triggering a test event, you should see all of the following:</p>

      <FlowStrip>
        <FlowNode k="In the platform" t="Test event fires" d="You trigger an event in your source platform." />
        <FlowNode k="In Baton" t="Appears in the Action log" d="The verified, routed webhook shows up in the automation's Action log." />
        <FlowNode k="In Workflow Builder" t="Instance launches" d="A matching workflow instance starts running." />
        <FlowNode k="In Flow Builder" t="Live counts update" d="The automation card updates; use View Instances to watch the run." />
      </FlowStrip>

      <Callout type="tip" title="Watch the run from the card">On the <DocLink to="flow-builder">Flow Builder</DocLink> card, live counts update as the run progresses. Click <strong>View Instances</strong> to open the specific workflow instance and follow its status.</Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="how-it-works" title="How Baton works">Understand the verify-then-route model and the boundary between Baton and Workflow Builder.</Card>
        <Card to="concepts" title="Core concepts">A quick reference for every term you met in this walkthrough.</Card>
      </Cards>
    </>
  );
}

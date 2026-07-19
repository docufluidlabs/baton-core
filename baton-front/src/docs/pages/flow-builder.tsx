import { Lead, Callout, Cards, Card, FlowStrip, FlowNode, Steps, Step, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import flowBuilderShot from '../assets/screenshots/flow-builder.png';

export default function FlowBuilder() {
  return (
    <>
      <h1>Flow Builder</h1>
      <Lead>
        The Flow Builder is your home canvas: a live, three-column diagram of every automation that shows
        each source platform, the automation in the middle, and the Maestro workflow it triggers — all with
        real-time counts.
      </Lead>

      <Screenshot
        src={flowBuilderShot}
        alt="The Baton Flow Builder canvas with source platforms, automations, and Maestro workflows connected in three columns"
        caption="The Flow Builder canvas — each automation shown as source platform → automation → Maestro workflow, with live counts."
      />

      <h2>Why Flow Builder is your home page</h2>
      <p>
        As a Baton admin, your main job is to know that automations are running cleanly. The Flow Builder
        (<code>/flows</code>) opens to exactly that picture: every source, every automation, and every Maestro
        target side by side, with live counts at a glance and every drill-down one click away. Animated dotted
        lines connect the columns so you can see, visually, which direction the data flows.
      </p>

      <h2>Reading the three columns</h2>
      <p>
        Each automation is drawn as a left-to-right strip of three cards. Data flows from the source platform,
        through the automation, into the Maestro workflow.
      </p>

      <FlowStrip>
        <FlowNode k="Left column" t="Source platform" d="Where the webhook comes from — e.g. HubSpot." />
        <FlowNode k="Middle column" t="Automation" d="The rule that links source to target, with live counts and actions." />
        <FlowNode k="Right column" t="Maestro workflow" d="The Docusign Maestro workflow this automation triggers." />
      </FlowStrip>

      <h3>Source platform card (left)</h3>
      <p>The left card represents a source platform. It shows:</p>
      <ul>
        <li>The platform logo and name</li>
        <li>An <strong>"N actions this month"</strong> counter</li>
        <li>A blue <strong>+</strong> icon that opens <strong>Add Automation</strong> pre-filled to that platform</li>
      </ul>

      <h3>Automation card (middle)</h3>
      <p>
        The middle card is the automation itself. It shows the automation name and a status badge —{' '}
        <Badge color="green">active</Badge> or <Badge color="amber">paused</Badge> — plus live counts right on
        the card: completed actions, errors, and in-progress runs. Three actions sit on the card:
      </p>
      <KV>
        <KVRow label="Pause">
          Temporarily stop processing this automation's webhooks. Paused automations do not drop incoming
          webhooks — see the tip below.
        </KVRow>
        <KVRow label="Logs">
          Open the Action Logs panel for this automation. See <DocLink to="logs">Action logs</DocLink>.
        </KVRow>
        <KVRow label="⚙️ Settings">
          Open the Edit Automation panel to change any field — covered under{' '}
          <a href="#create-an-automation">Create an automation</a> below.
        </KVRow>
      </KV>

      <h3>Maestro workflow card (right)</h3>
      <p>
        The right card is the target Maestro workflow. It shows the workflow icon and name, live counts
        (completed / total), and a <strong>View Instances</strong> button. View Instances lists every Maestro
        instance this automation has triggered — each with its status, a progress bar, and a link to open the
        instance directly in Docusign.
      </p>

      <Callout type="tip" title="Pausing queues webhooks — it doesn't drop them">
        When you pause an automation, incoming webhooks are queued rather than discarded. When you resume, the
        queued events process in order, so you won't lose activity during a pause. The full behavior is covered
        in <DocLink to="logs">Action logs</DocLink>.
      </Callout>

      <h2>The status bar, zoom, and saved layout</h2>
      <p>
        A bottom status bar summarizes your whole org at a glance, for example:{' '}
        <em>"3 connections · 5 automations · 4 active · 1 error"</em>. Use it as a quick health check before
        you drill into any single strip.
      </p>
      <p>
        In the bottom-left corner you'll find zoom in / zoom out and fit-to-screen controls for navigating a
        busy canvas. When you drag a node to reposition it, Baton saves that position — so your layout stays
        exactly where you left it the next time you open the page.
      </p>

      <h2 id="create-an-automation">Create an automation</h2>
      <p>
        The <strong>+ Add Automation</strong> button in the top-right opens the create panel as a slide-out.
        (The same panel opens, pre-filled, from the <strong>+</strong> on a platform card or from{' '}
        <strong>Settings</strong> on an existing automation card.) Work through it section by section:
      </p>

      <Steps>
        <Step title="Source platform">
          {' '}Pick the platform that will fire the webhook. The list is filtered to platforms you've already
          added in <DocLink to="connections">Connections</DocLink>.
        </Step>
        <Step title="Copy the permanent webhook URL">
          {' '}Baton gives this automation a copyable, stable URL that lasts for the life of the automation.
          Paste it into the source platform so the platform knows where to post events.
        </Step>
        <Step title="Verification">
          {' '}Confirm the secret and scheme (HMAC or Basic Auth). These are pre-filled from the platform
          template but can be overridden per automation.
        </Step>
        <Step title="Event type">
          {' '}Optionally restrict the automation to a single platform event, e.g. <code>contact.created</code>.
          Leave it empty to match any event.
        </Step>
        <Step title="Target Maestro workflow">
          {' '}Choose the workflow this automation triggers. The dropdown is populated from your synced Maestro
          workflows (sync them on the <DocLink to="workflows">Maestro Workflows</DocLink> page).
        </Step>
        <Step title="Review the parameters preview">
          {' '}A read-only list shows the parameters the target workflow expects, so you know which fields the
          source payload needs to carry.
        </Step>
        <Step title="Automation name">
          {' '}Auto-generated as <code>&lt;Platform&gt; → &lt;Workflow&gt;</code>, but fully editable.
        </Step>
        <Step title="Status">
          {' '}Set the automation <Badge color="green">active</Badge> or <Badge color="amber">paused</Badge> on
          save.
        </Step>
      </Steps>

      <Callout type="note" title="Salesforce automations">
        Salesforce uses the same webhook URL + secret flow as every other platform — the difference is
        that you build the outbound call in your org yourself. See{' '}
        <DocLink to="salesforce">Salesforce setup</DocLink>.
      </Callout>

      <h3>The preflight check before Save</h3>
      <p>
        Before you can save, Baton runs a preflight check. It validates the secret format for the chosen
        scheme, confirms the target workflow is reachable, and checks that the parameter shape matches. A
        failed check blocks <strong>Save</strong> with an inline message explaining what to fix; a passing
        check enables <strong>Create / Save</strong>.
      </p>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="conditions" title="Conditions & field mapping">
          Optional advanced controls to filter which webhooks fire and to rename payload fields.
        </Card>
        <Card to="workflows" title="Maestro Workflows">
          Sync workflows from Docusign and test-launch any workflow without waiting for a webhook.
        </Card>
        <Card to="logs" title="Action logs">
          Inspect every webhook this automation has handled, including pause queuing.
        </Card>
      </Cards>
    </>
  );
}

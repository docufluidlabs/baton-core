import { Lead, Callout, Cards, Card, FlowStrip, FlowNode, Steps, Step, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import flowBuilderShot from '../assets/screenshots/flow-builder.png';

export default function FlowBuilder() {
  return (
    <>
      <h1>Flow Builder</h1>
      <Lead>
        The Flow Builder is your home canvas: a live, three-column diagram of every automation that shows
        each source platform, the automation in the middle, and the Docusign workflow it triggers - all with
        live counts.
      </Lead>

      <Screenshot
        src={flowBuilderShot}
        alt="The Baton Flow Builder canvas with source platforms, automations, and Docusign workflows connected in three columns"
        caption="The Flow Builder canvas - each automation shown as source platform → automation → Docusign workflow, with live counts."
      />

      <h2>Why Flow Builder is your home page</h2>
      <p>
        As a Baton admin, your main job is to know that automations are running cleanly. The Flow Builder
        (<code>/flows</code>) opens to exactly that picture: every source, every automation, and every workflow
        target side by side, with counts that refresh every 15 seconds and every drill-down one click away.
        Arrows connect the columns so you can see, visually, which direction the data flows - and they animate
        only while an automation is <Badge color="green">active</Badge>, so a paused strip reads as flat gray
        from across the room.
      </p>

      <h2>Reading the three columns</h2>
      <p>
        Each automation is drawn as a left-to-right strip of three cards. Data flows from the source platform,
        through the automation, into the Docusign workflow. Every card has a button for its main drill-down,
        and double-clicking the card does the same thing.
      </p>

      <FlowStrip>
        <FlowNode k="Left column" t="Source platform" d="Where the webhook comes from - e.g. HubSpot." />
        <FlowNode k="Middle column" t="Automation" d="The rule that links source to target, with live counts and actions." />
        <FlowNode k="Right column" t="Docusign workflow" d="The Docusign Workflow Builder workflow this automation triggers." />
      </FlowStrip>

      <h3>Source platform card (left)</h3>
      <p>The left card represents a source platform. It shows:</p>
      <ul>
        <li>The platform logo and name</li>
        <li>
          An <strong>"N relays this month"</strong> counter, totalled across that platform's automations (or{' '}
          <strong>"No relays yet"</strong> on a platform that hasn't fired)
        </li>
        <li>A blue <strong>+</strong> icon that opens <strong>New Automation</strong> pre-filled to that platform</li>
      </ul>
      <p>
        Docusign never appears as a source card. It is the OAuth destination, not a webhook source, so Baton
        hides it from the left column.
      </p>

      <h3>Automation card (middle)</h3>
      <p>
        The middle card is the automation itself. It shows the automation name and a status badge -{' '}
        <Badge color="green">active</Badge>, <Badge color="amber">paused</Badge>, <Badge color="red">error</Badge>{' '}
        or <Badge color="gray">disabled</Badge> - above a stacked bar and four counters:{' '}
        <strong>running/queue</strong>, <strong>completed</strong>, <strong>failed</strong> and{' '}
        <strong>cancelled</strong>, with the running total to the right of the bar. Along the bottom edge:
      </p>
      <KV>
        <KVRow label="Pause / Resume">
          One button that follows the status: <strong>Pause</strong> on an active automation,{' '}
          <strong>Resume</strong> on a paused or errored one. Pausing does not drop incoming webhooks - see the
          tip below.
        </KVRow>
        <KVRow label="Logs">
          Open the log of every webhook this automation has handled. See{' '}
          <DocLink to="logs">Relay logs</DocLink>.
        </KVRow>
        <KVRow label="⚙️ Settings">
          Open the Edit Automation panel to change any field - covered under{' '}
          <a href="#create-an-automation">Create an automation</a> below.
        </KVRow>
      </KV>

      <h3>Docusign workflow card (right)</h3>
      <p>
        The right card is the target Docusign workflow. It shows the workflow icon, its name with a status dot,
        and the same stacked bar and four counters as the automation card - here counting workflow instances
        rather than webhooks. <strong>View Instances</strong> opens the <strong>Activity Log</strong>{' '}
        pre-filtered to that workflow, where each instance carries its status, progress, inputs, and a
        deep link into Docusign. The filter shows as a removable chip, so you can clear it to see the whole
        org's activity without leaving the panel.
      </p>

      <Callout type="note" title="The Activity Log is always reachable">
        You don't need a workflow card to open it. The <strong>Activity</strong> icon in the top bar toggles the
        same panel, unfiltered, from any page in Baton.
      </Callout>

      <Callout type="tip" title="Pausing queues webhooks - it doesn't drop them">
        When you pause an automation, incoming webhooks are queued rather than discarded, and the queue appears
        inline in that automation's Logs panel with per-item <strong>Let through</strong> and <strong>Cancel</strong>{' '}
        controls. Resuming releases the whole queue oldest-first, so you won't lose activity during a pause. The
        full behavior is covered in <DocLink to="logs">Relay logs</DocLink>.
      </Callout>

      <h2>Navigating and arranging the canvas</h2>
      <p>
        In the bottom-left corner you'll find zoom in / zoom out and fit-to-screen controls for navigating a
        busy canvas. Baton fits the view once, the first time the canvas loads, and then leaves it alone -
        background refreshes never yank your pan or zoom out from under you.
      </p>
      <p>
        The canvas is a grid, and every card occupies one cell. Drag a card and the cell under it highlights:
        blue if it's free, red if it's taken. Drop it on a free cell and the card snaps into place; drop it on
        a taken one and it springs back. Arrow keys move a selected card the same way. Either way Baton saves
        the new cell, per card, so your layout is exactly where you left it next time - on any device, since
        the layout syncs rather than living in one browser.
      </p>
      <Callout type="note" title="Layout is stored as cells, not pixels">
        Because Baton stores a column and row rather than a pixel position, your arrangement survives a
        different screen size, a longer workflow name, or a teammate rearranging a different corner of the same
        canvas at the same time.
      </Callout>

      <h2 id="create-an-automation">Create an automation</h2>
      <p>
        The <strong>Add Automation</strong> button in the top-right opens the <strong>New Automation</strong>{' '}
        panel as a slide-out. (The same panel opens, pre-filled, from the <strong>+</strong> on a platform card,
        and as <strong>Edit Automation</strong> from <strong>Settings</strong> on an existing automation card.)
        The panel is ordered deliberately: you describe the <em>from → to</em> first, and only then deal with
        the webhook plumbing.
      </p>

      <Steps>
        <Step title="Webhook Source">
          {' '}Pick the platform that will fire the webhook. The dropdown groups everything you can start from:{' '}
          <strong>Connected</strong> and <strong>Installed</strong> platforms you already have,{' '}
          <strong>OAuth Platforms</strong> that still need connecting, and <strong>Available</strong> catalog
          platforms - picking one of those installs it on the spot, so you never have to leave for{' '}
          <DocLink to="connections">Connections</DocLink> first. A link to that platform's setup guide appears
          right below, opening in a new tab so the panel stays put.
        </Step>
        <Step title="Automation Name">
          {' '}Required, and yours to write - there is no generated default. Something like{' '}
          <code>HubSpot deal won → NDA</code> pays for itself the first time you scan a busy canvas.
        </Step>
        <Step title="Target Docusign Workflow">
          {' '}Choose the workflow this automation triggers. The searchable dropdown lists your synced,{' '}
          <em>active</em> Docusign workflows, minus any already claimed by another automation. The refresh icon
          beside it re-syncs from Workflow Builder without leaving the panel. If a workflow's trigger isn't an
          HTTP trigger, Baton says so inline and links you to it in Workflow Builder.
        </Step>
        <Step title="Expected workflow instance duration">
          {' '}Optional, in days. Any instance still running past it is flagged{' '}
          <Badge color="amber">Overdue</Badge> in the{' '}
          <DocLink to="control-center">Control Center</DocLink>. Leave it empty and the automation's
          instances are never marked overdue.
        </Step>
        <Step title="Workflow Builder API Parameters">
          {' '}Lists the parameters the target workflow declares, so you know what the source payload needs to
          carry. Each one can read a payload <strong>Path</strong>, send a fixed <strong>Static</strong> value,
          or interpolate a <strong>Template</strong>; leave one empty to skip it. If the workflow publishes no
          trigger inputs, <strong>Add field</strong> lets you name the targets by hand. See{' '}
          <DocLink to="conditions">Conditions &amp; field mapping</DocLink>.
        </Step>
        <Step title="Webhook URL and secret">
          {' '}Baton generates a stable, copyable URL that lasts for the life of the automation - paste it into
          the source platform. Below it, enter the <strong>Webhook Secret</strong> (or{' '}
          <strong>Basic Auth Credentials</strong>, depending on the platform) and click{' '}
          <strong>Save</strong> on that field. See{' '}
          <DocLink to="verification">Verification methods</DocLink>.
        </Step>
      </Steps>

      <p>
        Finish with <strong>Create Automation</strong>. New automations start{' '}
        <Badge color="green">active</Badge>; you pause and resume them afterwards from the card on the canvas,
        never from this panel. Editing an existing automation swaps the button for{' '}
        <strong>Update Automation</strong> and adds <strong>Delete Automation</strong> at the bottom - the
        source platform becomes read-only, since the webhook URL is bound to it.
      </p>

      <Callout type="note" title="One workflow, one automation">
        A Docusign workflow can be the target of only one automation at a time, so a workflow already in use
        won't appear in the dropdown. If the workflow you want is missing, check whether another automation
        already claims it - or whether it needs syncing on the{' '}
        <DocLink to="workflows">Workflow Checker</DocLink> page.
      </Callout>

      <Callout type="note" title="Every event from the source counts">
        There is no event-type picker. An automation matches <em>any</em> event arriving on its webhook URL,
        which keeps setup to one decision: which platform, which workflow. To narrow it down, either send only
        the events you want from the source platform, or ask about conditions - see{' '}
        <DocLink to="conditions">Conditions &amp; field mapping</DocLink>.
      </Callout>

      <Callout type="note" title="Salesforce automations">
        Salesforce uses the same webhook URL + secret flow as every other platform - the difference is
        that you build the outbound call in your org yourself. See{' '}
        <DocLink to="salesforce">Salesforce setup</DocLink>.
      </Callout>

      <h3>What blocks Create</h3>
      <p>
        The <strong>Create Automation</strong> button stays disabled until the name, the source, and the target
        workflow are all filled in - and, on a new automation, until you've clicked <strong>Save</strong> on the
        webhook secret. That last one is easy to miss, so Baton calls it out with an inline hint above the
        button rather than leaving you with a button that looks broken. Editing an existing automation never
        re-asks for the secret.
      </p>

      <h2>Launching without a webhook: Bulk Upload</h2>
      <p>
        The Flow Builder covers automations - a webhook arrives and a workflow fires. When you want to launch a
        workflow for every row of a spreadsheet instead, use <DocLink to="bulk-upload">Bulk Upload</DocLink>. It is
        a separate page on purpose: every run is started by hand, and the file is the trigger no matter which
        platform it was exported from, so it has no source-platform card to sit behind on this canvas. Instances
        it launches still show up in the Activity Log alongside everything else.
      </p>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="conditions" title="Conditions & field mapping">
          Map payload fields onto workflow parameters, and filter which webhooks count.
        </Card>
        <Card to="bulk-upload" title="Bulk Upload">
          Launch a workflow for every row of a file, with no webhook and no source platform.
        </Card>
        <Card to="workflows" title="Workflow Checker">
          Sync workflows from Docusign and test-launch any workflow without waiting for a webhook.
        </Card>
        <Card to="logs" title="Relay logs">
          Inspect every webhook this automation has handled, including pause queuing.
        </Card>
      </Cards>
    </>
  );
}

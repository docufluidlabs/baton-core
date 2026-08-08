import { Lead, Callout, Cards, Card, Steps, Step, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import workflowsShot from '../assets/screenshots/workflows.png';

export default function Workflows() {
  return (
    <>
      <h1>Workflow Checker</h1>
      <Lead>
        The Workflow Checker is where you pull your workflows in from Docusign Workflow Builder so they can be
        linked to automations - and where you can launch any of them with your own parameter values to test it,
        without waiting for a webhook.
      </Lead>

      <Screenshot
        src={workflowsShot}
        alt="The Workflow Checker page listing synced Docusign workflows, each with its API parameters and a Run Test button"
        caption="The Workflow Checker in grid view - each synced Docusign workflow with its API parameters and a Run Test button."
      />

      <h2>What this page is for</h2>
      <KV>
        <KVRow label="Sync workflows from Docusign">
          Pull your Docusign workflows into Baton, so each one can be picked as the target of an automation or of
          a Bulk Upload run.
        </KVRow>
        <KVRow label="Check the parameter contract">
          See at a glance which workflows publish API parameters Baton can fill, and which ones still need
          trigger inputs added in Workflow Builder.
        </KVRow>
        <KVRow label="Test-launch by hand">
          Fire any workflow with values you type yourself, without waiting for a webhook - useful while setting an
          automation up, or when diagnosing one.
        </KVRow>
      </KV>

      <h2>Page layout</h2>
      <p>
        The header reads <strong>Workflow Checker</strong>, with the subtitle{' '}
        <em>"Sync workflows from Docusign Workflow Builder, create test pairs, and launch."</em> Around it
        you'll find:
      </p>
      <ul>
        <li>A <strong>Sync from Docusign</strong> button in the top-right that re-pulls the workflow list.</li>
        <li>
          A search box that filters on workflow name and description, plus a list / grid toggle. Grid is the
          default, and Baton remembers whichever you pick.
        </li>
        <li>
          Two sections, each with a count: <strong>API Parameters Ready</strong> and{' '}
          <strong>API Parameters Not Set Up</strong>.
        </li>
      </ul>
      <p>
        Only workflows that are <strong>active</strong> in Workflow Builder are listed. Drafts and paused
        workflows are still synced into Baton, but they are filtered out of this page.
      </p>

      <h2>The two sections</h2>
      <KV>
        <KVRow label="API Parameters Ready">
          The workflow's start trigger publishes at least one input Baton can fill. These are the workflows you
          can test here, target from an automation, and map a file onto in a Bulk Upload.
        </KVRow>
        <KVRow label="API Parameters Not Set Up">
          Baton synced the workflow but found no usable trigger inputs, so there is nothing to fill in and
          nothing to map. Add the inputs to the workflow's start step in Docusign Workflow Builder, then sync
          again and it moves up to the other section.
        </KVRow>
      </KV>

      <h2>The workflow card</h2>
      <p>
        In <strong>grid</strong> view each workflow is a card showing the Docusign icon, the workflow name, an{' '}
        <Badge color="green">Active</Badge> status marker, one input per API parameter, and a{' '}
        <strong>Run Test</strong> button. Beside it sit a sync icon that re-reads just that workflow's
        parameters, an edit icon that opens the workflow in Workflow Builder, and an{' '}
        <strong>Instances →</strong> link that flips the card over to its recent runs.
      </p>
      <p>
        In <strong>list</strong> view the cards start collapsed - click a row to expand it. An expanded card adds
        a toolbar (<strong>Sync</strong>, <strong>Instances</strong> and <strong>Edit Workflow</strong>, the last
        two opening Docusign in a new tab) and a <strong>Completion History</strong> list of the most recent runs
        below the inputs.
      </p>
      <p>
        Wherever a run is listed you can <strong>Cancel</strong> it while it is still running, press{' '}
        <strong>Try Again</strong> on one that failed or was cancelled to relaunch it with the same values, and
        open <strong>Params</strong> to see exactly what was sent.
      </p>

      <Callout type="note" title="Run Test stays greyed out until the required parameters are filled">
        Parameters marked with a red asterisk are required. The button only becomes clickable once every one of
        them has a value. Optional fields you leave blank are simply omitted from the launch.
      </Callout>

      <h2>Where the parameters come from</h2>
      <p>
        The inputs on each card come straight from the Docusign workflow's start-trigger definition - the same
        parameter contract Baton matches against in live automations (see{' '}
        <DocLink to="conditions">Conditions & field mapping</DocLink>), and the same list a Bulk Upload maps its
        file columns onto. What you fill in here is exactly what a live webhook would need to supply.
      </p>
      <p>
        Docusign's own system fields are hidden, so a card can show fewer inputs than the workflow does in
        Workflow Builder. <code>startDate</code>, <code>workflowBuilder</code>, <code>workflowPreparer</code> and{' '}
        <code>workflowSigner</code>, along with any Participants-typed field, are supplied by Docusign rather
        than by you.
      </p>

      <h2>Test a workflow manually</h2>
      <Steps>
        <Step title="Sync if needed">
          {' '}If the workflow isn't listed yet, press <strong>Sync from Docusign</strong> to pull the latest
          list. Syncing requires a connected Docusign - see{' '}
          <DocLink to="connect-docusign">Connect Docusign</DocLink>.
        </Step>
        <Step title="Find the workflow">
          {' '}Use the search box or the list / grid toggle to locate the card you want. In list view, click the
          row to expand it.
        </Step>
        <Step title="Fill in the parameters">
          {' '}Type a value into each input - one per API parameter the start trigger declares. Every required
          field needs a value before the launch button unlocks.
        </Step>
        <Step title="Run the test">
          {' '}Press <strong>Run Test</strong> to fire the workflow immediately with those values.
        </Step>
        <Step title="Check the result">
          {' '}In grid view the card flips itself to the instance list. In list view the run appears in{' '}
          <strong>Completion History</strong> below the inputs. Either way you can follow{' '}
          <strong>Detail</strong> or <strong>Open</strong> through to Docusign - see{' '}
          <DocLink to="logs">Relay logs & instances</DocLink>.
        </Step>
      </Steps>

      <Callout type="warning" title="Test launches run the real workflow">
        Launching a workflow manually starts a real instance in Docusign, identical to one an automation would
        start - every step runs for real, including any that sends documents to recipients. Baton names each
        manual run <code>Test -</code> followed by the values you entered, so it is easy to pick out afterwards.
      </Callout>

      <h2>Keeping the list current</h2>
      <p>Three things refresh this page's data, and they do different jobs:</p>
      <KV>
        <KVRow label="Sync from Docusign (top-right)">
          Re-pulls the whole list. Workflows Baton has never seen arrive complete with their parameter
          definitions; workflows it already knows about have their name and status updated, but{' '}
          <strong>not</strong> their parameters.
        </KVRow>
        <KVRow label="Sync on a single card">
          Re-reads that one workflow's start trigger and updates its parameter list. This is the one to use after
          you add, rename or remove a trigger input in Workflow Builder.
        </KVRow>
        <KVRow label="Automatic background refresh">
          Opening the page also asks Workflow Builder which workflows have changed since Baton last saw them and
          refreshes those parameters on its own, at most once every five minutes per organization.
        </KVRow>
      </KV>

      <Callout type="warning" title="A full sync mirrors Workflow Builder, deletions included">
        <strong>Sync from Docusign</strong> also removes Baton's copy of any workflow that no longer exists in
        Workflow Builder. An automation still pointing at a deleted workflow will fail at launch and land in the{' '}
        <DocLink to="control-center">Control Center</DocLink>, so repoint it in the{' '}
        <DocLink to="flow-builder">Flow Builder</DocLink> first.
      </Callout>

      <Callout type="note" title="Who can do what">
        A full <strong>Sync from Docusign</strong> is limited to owners, admins and superusers. Members can run
        tests and sync an individual card. Viewers can read the page but not launch anything.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="connect-docusign" title="Connect Docusign">
          Syncing workflows requires a connected Docusign account.
        </Card>
        <Card to="flow-builder" title="Flow Builder">
          Link a synced workflow to an automation as its target workflow.
        </Card>
        <Card to="logs" title="Relay logs & instances">
          Follow a test run through its steps, and read what happened when one fails.
        </Card>
      </Cards>
    </>
  );
}

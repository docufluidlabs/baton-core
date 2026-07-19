import { Lead, Callout, Cards, Card, Steps, Step, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import workflowsShot from '../assets/screenshots/workflows.png';

export default function Workflows() {
  return (
    <>
      <h1>Workflow Checker</h1>
      <Lead>
        The Workflow Checker is where you pull your workflows in from Docusign Workflow Builder so they can be
        linked to automations - and where you can launch any workflow with custom parameter values to test it,
        without waiting for a webhook.
      </Lead>

      <Screenshot
        src={workflowsShot}
        alt="The Workflow Checker page listing synced Docusign workflows, each with its API parameters and a Run Test button"
        caption="The Workflow Checker - every synced Docusign workflow with its API parameters and a Run Test button."
      />

      <h2>What this page is for</h2>
      <p>The Workflow Checker does two jobs:</p>
      <KV>
        <KVRow label="Sync workflows from Docusign">
          Pull every Docusign workflow your org has, so each one becomes available to link to an automation.
        </KVRow>
        <KVRow label="Manual launch / test">
          Fire any workflow with custom parameter values directly from Baton, without waiting for a webhook -
          useful when setting up, or when diagnosing an automation.
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
        <li>A search bar and a grid / list toggle.</li>
        <li>
          A section labeled <strong>"API Parameters Ready"</strong> with a count of synced workflows that have a
          usable parameter contract.
        </li>
      </ul>

      <h2>The workflow card</h2>
      <p>Each synced workflow appears as a card showing:</p>
      <ul>
        <li>The workflow icon and name, with an <Badge color="green">Active</Badge> badge.</li>
        <li>
          One fillable input <strong>per API parameter</strong> the workflow's start trigger declares - for
          example <code>object_id</code>, <code>email</code>, <code>companyId</code>, or{' '}
          <code>Vendor name</code>.
        </li>
        <li>A <strong>Run Test</strong> button that fires the workflow with whatever values you typed.</li>
        <li>Refresh and edit icons.</li>
        <li>An <strong>Instances →</strong> link to that workflow's run history.</li>
      </ul>

      <h2>Where the parameters come from</h2>
      <p>
        The inputs on each card come straight from the Docusign workflow's start-trigger definition - the same
        parameter contract Baton matches against in live automations (see{' '}
        <DocLink to="conditions">Conditions & field mapping</DocLink>). What you fill in here is exactly what a
        live webhook would need to supply.
      </p>
      <p>A couple of consequences worth knowing:</p>
      <ul>
        <li>
          <strong>Draft workflows don't appear.</strong> Only workflows that are live in Workflow Builder show up here.
        </li>
        <li>
          <strong>Re-syncing is safe.</strong> Pressing <strong>Sync from Docusign</strong> won't break
          existing automations - it just refreshes the list and the parameter definitions.
        </li>
      </ul>

      <h2>Test a workflow manually</h2>
      <Steps>
        <Step title="Sync if needed">
          {' '}If the workflow isn't listed yet, press <strong>Sync from Docusign</strong> to pull the latest
          list. Syncing requires a connected Docusign - see{' '}
          <DocLink to="connect-docusign">Connect Docusign</DocLink>.
        </Step>
        <Step title="Find the workflow">
          {' '}Use the search bar or the grid / list toggle to locate the workflow card you want to test.
        </Step>
        <Step title="Fill in the parameters">
          {' '}Type a value into each input on the card - one per API parameter the start trigger declares.
        </Step>
        <Step title="Run the test">
          {' '}Press the <strong>Run Test</strong> button to fire the workflow immediately with those values.
        </Step>
        <Step title="Check the result">
          {' '}Follow the <strong>Instances →</strong> link to watch the run you just kicked off in its history.
        </Step>
      </Steps>

      <Callout type="warning" title="Test launches run the real workflow">
        Launching a workflow manually fires a real workflow instance in Docusign - the same as a live
        automation would.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="connect-docusign" title="Connect Docusign">
          Syncing workflows requires a connected Docusign account.
        </Card>
        <Card to="flow-builder" title="Flow Builder">
          Link a synced workflow to an automation as its target workflow.
        </Card>
      </Cards>
    </>
  );
}

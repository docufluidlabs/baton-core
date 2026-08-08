import { Lead, Callout, Cards, Card, FlowStrip, FlowNode, Steps, Step, Badge, KV, KVRow, TableWrap, DocLink } from '../ui';

export default function BulkUpload() {
  return (
    <>
      <h1>Bulk Upload</h1>
      <Lead>
        Bulk Upload is the manual counterpart to an automation: upload a CSV, XLSX or TSV file and Baton
        launches your Docusign workflow once per row, released on a throttle you set and tracked row by row.
        No source platform, no webhook, no signing secret - the file is the trigger, wherever it came from.
      </Lead>

      <h2>What this page is for</h2>
      <KV>
        <KVRow label="Launch a workflow for a list you already have">
          A quarterly renewal list, a report exported from your CRM, a spreadsheet a colleague emailed you.
          Every row becomes one workflow instance in Docusign Workflow Builder.
        </KVRow>
        <KVRow label="Work at a pace Docusign and your recipients can absorb">
          Rows leave in small batches on a timer instead of all at once, and you can pause, resume or cancel
          a run at any point.
        </KVRow>
        <KVRow label="Keep the paper trail">
          Each row records the exact payload it sent, the instance it created, and how that instance ended -
          so a question about one line of the file has an answer.
        </KVRow>
      </KV>

      <h2>When to use it instead of an automation</h2>
      <p>
        The <DocLink to="flow-builder">Flow Builder</DocLink> covers the reactive case: a webhook arrives and a
        workflow fires, forever, without you. Bulk Upload covers the case where <em>you</em> already have the
        list. That difference is why it has its own page in the sidebar rather than a bubble on the canvas -
        every run is started by hand, and there is no source platform to sit behind.
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th></th><th>Automation (Flow Builder)</th><th>Bulk Upload</th></tr>
          </thead>
          <tbody>
            <tr><td>What starts it</td><td>An inbound webhook</td><td>You, by uploading a file</td></tr>
            <tr><td>Setup needed</td><td>Source platform, webhook URL, secret</td><td>A connected Docusign account and a synced workflow</td></tr>
            <tr><td>Runs</td><td>Continuously, one launch per matching event</td><td>Once per upload, one launch per row</td></tr>
            <tr><td>Where the values come from</td><td>The webhook payload, via <DocLink to="conditions">field mapping</DocLink></td><td>The file's columns, mapped in the wizard</td></tr>
            <tr><td>Pacing</td><td>As fast as events arrive</td><td>A release throttle you set per run</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="One workflow can serve several Bulk Uploads">
        The one-workflow-one-automation rule applies to automations only. A workflow can be the target of
        multiple Bulk Uploads, and of an automation at the same time - so an existing automation never blocks
        you from pointing a Bulk Upload at the same workflow.
      </Callout>

      <h2>What you need first</h2>
      <Steps>
        <Step title="A connected Docusign account">
          {' '}Bulk Upload is greyed out in the sidebar until Docusign is connected. See{' '}
          <DocLink to="connect-docusign">Connect Docusign</DocLink>.
        </Step>
        <Step title="A synced, active workflow">
          {' '}Only workflows that are active in Workflow Builder can be picked as a target. Sync them from the{' '}
          <DocLink to="workflows">Workflow Checker</DocLink>.
        </Step>
        <Step title="Trigger inputs published on that workflow">
          {' '}The mapping step lists the workflow's API parameters. A workflow with none has nothing to map a
          column onto - add the inputs to its start step in Workflow Builder, sync, and reopen the wizard.
        </Step>
        <Step title="A file with a header row">
          {' '}CSV, XLSX or TSV, up to 10 MB. The first row must be the column headers.
        </Step>
      </Steps>
      <p>
        Notice what is <em>not</em> on that list: a source platform, a webhook URL, a secret. Bulk Upload works
        the moment Docusign is connected, which makes it the fastest way to see Baton launch something real.
      </p>

      <h2>How a Bulk Upload is put together</h2>
      <FlowStrip>
        <FlowNode k="You create" t="A Bulk Upload" d="A named, reusable setup: which workflow to launch, and the default pacing." />
        <FlowNode k="You upload" t="A run" d="One file, one run. Each upload creates its own run with its own release clock." />
        <FlowNode k="Baton launches" t="Rows" d="One row, one workflow instance, released in throttled batches." />
      </FlowStrip>
      <p>
        A <strong>Bulk Upload</strong> is the reusable part - you create it once and keep uploading to it. A{' '}
        <strong>run</strong> is one file's journey through that setup, numbered per Bulk Upload (Run 1, Run 2,
        and so on). A <strong>row</strong> is one line of the file, and one workflow instance.
      </p>

      <h2>Create a Bulk Upload</h2>
      <p>
        <strong>New Bulk Upload</strong> in the top-right opens a slide-out panel. The same panel opens as{' '}
        <strong>Edit Bulk Upload</strong> from the gear icon on an existing card.
      </p>

      <Steps>
        <Step title="Name">
          {' '}Required. Something you will recognize on the card and in a notification - the run summaries are
          titled with it.
        </Step>
        <Step title="Target Workflow">
          {' '}The Docusign workflow every row will launch. The searchable dropdown lists your synced,{' '}
          <em>active</em> workflows; the refresh icon beside it re-syncs without leaving the panel (the
          selected workflow alone if you have picked one, the whole list otherwise).
        </Step>
        <Step title="Throttling">
          {' '}Release <strong>N</strong> rows every <strong>M</strong> minutes. Defaults to 5 rows every 10
          minutes. This is the default for new runs; the wizard lets you override it per run.
        </Step>
        <Step title="Stop after consecutive failures">
          {' '}Defaults to 5. A run halts itself when this many rows fail back to back, so one bad file cannot
          keep launching workflows into a broken setup.
        </Step>
        <Step title="Unfinished instances cap">
          {' '}Optional and <strong>off by default</strong>. Caps how many of this Bulk Upload's instances may
          be unfinished at once, across all of its runs. Read the section below before switching it on.
        </Step>
        <Step title="Mark as Overdue">
          {' '}Optional, in days. An instance still running past it is flagged <Badge color="amber">Overdue</Badge>{' '}
          in the <DocLink to="control-center">Control Center</DocLink> - and stops counting toward the cap.
          Leave it empty and this Bulk Upload's instances are never marked overdue.
        </Step>
      </Steps>

      <p>
        <strong>Create Bulk Upload</strong> stays disabled until the name and the target workflow are both
        filled in. Editing an existing one swaps the button for <strong>Update Bulk Upload</strong> and adds{' '}
        <strong>Delete Bulk Upload</strong>, which refuses while any run is still active - cancel the run in{' '}
        <strong>Runs &amp; rows</strong> first.
      </p>

      <h2>The upload wizard</h2>
      <p>
        <strong>Upload file</strong> on a card opens a four-step modal: <strong>File</strong>,{' '}
        <strong>Mapping</strong>, <strong>Rows</strong>, <strong>Review</strong>. Nothing launches until you
        press <strong>Start run</strong> on the last step, and <strong>Back</strong> is available the whole way.
      </p>

      <h3>Step 1 - File</h3>
      <p>
        Drop a file on the target or click to browse. Baton parses it on the spot and reports what it found:
        the row count, the column count, and how many blank rows it skipped. Below that sits a preview of the
        first three rows, so you can confirm the columns landed where you expect. <strong>Replace</strong>{' '}
        swaps the file without leaving the step.
      </p>
      <KV>
        <KVRow label="Accepted formats">
          <code>.csv</code>, <code>.xlsx</code> and <code>.tsv</code>, up to 10 MB. Anything else is refused
          with <em>"Save the file as CSV, XLSX or TSV and try again."</em>
        </KVRow>
        <KVRow label="Headers">
          The first row is read as headers. Columns with a blank header are dropped. Two columns with the{' '}
          <em>identical</em> header are rejected - rename one and upload again.
        </KVRow>
        <KVRow label="Multi-sheet workbooks">
          An XLSX with more than one sheet gets a <strong>Sheet</strong> picker; switching sheets re-parses the
          file against that sheet.
        </KVRow>
        <KVRow label="Blank rows">
          A row whose every cell is empty is skipped while the file is parsed, and reported in the count so
          the numbers still add up.
        </KVRow>
      </KV>

      <Callout type="note" title="How cell values are read">
        CSV and TSV cells are kept as the literal text in the file, which protects long numeric IDs and leading
        zeros. XLSX cells use the value as displayed in the sheet rather than the underlying number. All values
        are trimmed. If Excel has already mangled a long ID into scientific notation, the review step flags it -
        see <a href="#step-4-review">Step 4 - Review</a>.
      </Callout>

      <h3>Step 2 - Mapping</h3>
      <p>
        One row per API parameter the target workflow publishes, each with a dropdown offering every column in
        your file, plus <strong>Fixed value…</strong> for a constant sent on every row and{' '}
        <strong>- not set -</strong> to leave the parameter out entirely. Beneath the list, a live{' '}
        <strong>payload preview</strong> shows exactly what row 1 would send, and any columns you have not used
        are listed so nothing goes unnoticed.
      </p>
      <p>
        Baton preselects the obvious matches for you. Header matching ignores case and punctuation, so{' '}
        <code>Signer Email</code> lines up with <code>signer_email</code> on its own.
      </p>

      <Callout type="note" title="Ambiguous headers are deliberately left unset">
        When two different headers reduce to the same name - a real case being a sheet with both{' '}
        <code>Contact$</code> and <code>Contact%</code> - Baton picks neither. Both are valid columns, and
        auto-selecting one would be a silent guess about which you meant. Choose it yourself on that parameter.
      </Callout>

      <p>
        At least one parameter has to be mapped before you can move on: with nothing mapped, every row would
        launch with an empty payload. If the workflow publishes no trigger inputs at all, the step says so and
        points you back to Workflow Builder.
      </p>

      <h3>Step 3 - Rows</h3>
      <KV>
        <KVRow label="Rows to process">
          <strong>All N rows</strong>, or a <strong>range</strong> from one row number to another. The count of
          selected rows updates as you type. Rows outside the range are kept with the run but marked{' '}
          <strong>Excluded</strong>.
        </KVRow>
        <KVRow label="Throttling · this run">
          Prefilled from the Bulk Upload's settings and editable here: rows per release, minutes between
          releases, and the consecutive-failure limit. Changes apply to <em>this run only</em>.
        </KVRow>
        <KVRow label="Mark as Overdue after">
          The overdue threshold for the instances this run launches, in days. Prefilled from the Bulk Upload,
          blank means off.
        </KVRow>
      </KV>

      <h3 id="step-4-review">Step 4 - Review</h3>
      <p>
        Entering the last step runs a preflight: Baton re-reads the workflow's trigger requirements from
        Workflow Builder, pins that schema to the run so a mid-run change in Docusign cannot alter what your
        rows send, and validates every selected row against it. You get two counters -{' '}
        <strong>rows ready</strong> and <strong>rows with problems</strong> - and, when there are problems, a
        breakdown that names each one with the row numbers it affects. What it checks:
      </p>
      <KV>
        <KVRow label="Required parameters are mapped">
          A required parameter left unmapped blocks the run outright. Baton names the parameters and sends you
          back to Mapping.
        </KVRow>
        <KVRow label="Required values are present">
          A mapped required parameter that is empty on a given row makes that row a problem row.
        </KVRow>
        <KVRow label="Email parameters look like emails">
          Any parameter whose name contains <code>email</code> is checked against a basic address shape.
        </KVRow>
        <KVRow label="Long numbers survived the spreadsheet">
          A value in scientific notation - the classic Excel corruption of a long ID - is flagged as{' '}
          <em>"value looks like a corrupted long number"</em>.
        </KVRow>
      </KV>

      <p>The summary block then tells you what pressing the button will do:</p>
      <ul>
        <li>How many workflow instances will launch, and at what rate</li>
        <li>An estimated duration - the time until the <em>last</em> batch is released, not until every workflow finishes</li>
        <li>
          When there are problem rows, a choice: <strong>Skip rows with problems</strong> (recommended - they
          are recorded as <strong>Skipped</strong> and never launched) or <strong>Process all rows as-is</strong>{' '}
          (they will probably fail, and those failures count toward the stop limit)
        </li>
      </ul>

      <Callout type="warning" title="Start run launches real workflows">
        Every launched row starts a genuine instance in Docusign, exactly as an automation would - including
        any step that sends documents to recipients. There is no dry run. On a file you have not used before,
        select a range of the first few rows, confirm the result, then upload the file again for the rest.
      </Callout>

      <h2>How rows are released</h2>
      <p>
        A run starts <em>running</em> the moment you press <strong>Start run</strong>. From then on a
        dispatcher checks every 30 seconds for runs whose next release is due, and releases up to the run's
        release count each time. The card counts down to the next release so you always know where you are.
      </p>
      <p>Each row moves through a short lifecycle, visible per row in the runs drill-in:</p>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Status</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Excluded</strong></td><td>Outside the row range you selected. Kept with the run, never launched.</td></tr>
            <tr><td><strong>Skipped</strong></td><td>Had a validation problem and you chose to skip problem rows.</td></tr>
            <tr><td><strong>Queued</strong></td><td>Waiting its turn in the throttle.</td></tr>
            <tr><td><strong>Launching</strong></td><td>Handed to the launcher; the instance is being created.</td></tr>
            <tr><td><strong>Launched / Running</strong></td><td>The workflow instance exists and is in progress in Docusign.</td></tr>
            <tr><td><strong>Completed</strong> / <strong>Failed</strong></td><td>The instance reached a terminal state.</td></tr>
            <tr><td><strong>Cancelled</strong></td><td>You cancelled the row, or the run it belonged to.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Several files at once</h2>
      <p>
        Uploading while a run is already going is allowed and expected: each file starts its own run
        immediately, and runs execute <strong>concurrently</strong>, each on its own release clock. Five sheets
        uploaded together all make progress rather than queueing behind one another.
      </p>
      <p>
        The card reflects that directly. Every active run gets its own strip with its own file name, run
        number, progress bar, counters and Pause / Resume button. With more than one in flight the card says
        how many files are processing at the same time and offers <strong>Pause all</strong> /{' '}
        <strong>Resume all</strong>; beyond two strips the rest collapse behind a <strong>Show all</strong>{' '}
        expander.
      </p>

      <Callout type="tip" title="Throttles multiply">
        The throttle is per run, not per Bulk Upload. Three concurrent runs at 5 rows every 10 minutes launch
        up to 15 rows every 10 minutes between them. If a total ceiling is what you actually want, that is what
        the unfinished-instance cap is for.
      </Callout>

      <h2>The unfinished-instance cap and the Overdue release valve</h2>
      <p>
        <strong>Unfinished instances cap</strong> limits how many of a Bulk Upload's instances may be
        unfinished at any moment, counted across <em>all</em> of its runs. When the limit is reached, the
        dispatcher releases nothing that tick and tries again on the next one. It is a shared budget: the
        available slots are handed to the oldest run first, so an older file finishes before a newer one starts
        competing with it.
      </p>

      <Callout type="warning" title="The cap is off by default, on purpose">
        A signature workflow only completes when a human signs. Left to itself, a cap would fill up with
        instances waiting on people and stall the whole batch indefinitely. Do not switch the cap on without
        also setting <strong>Mark as Overdue</strong>.
      </Callout>

      <p>
        <strong>Overdue is the release valve.</strong> Once an instance passes its overdue threshold it stops
        counting toward the cap, freeing its slot so the next row can launch - while the instance itself stays
        visible in the <DocLink to="control-center">Control Center</DocLink> for you to chase. The two
        settings are designed to be used together: the cap keeps the number of live signature requests
        sensible, and Overdue makes sure a slow signer never freezes the queue.
      </p>
      <KV>
        <KVRow label="Where the threshold comes from">
          <strong>Mark as Overdue after</strong> on the Bulk Upload, or the per-run override in the wizard. The
          value is stamped onto each instance at launch. No threshold means the instance is never overdue - and
          so never releases its cap slot.
        </KVRow>
        <KVRow label="Postponing puts the slot back">
          <strong>Add days</strong> in the Control Center pushes an overdue instance's deadline out. Because
          it is no longer overdue, it counts toward the cap again: you told Baton you are still waiting on it.
        </KVRow>
        <KVRow label="Rows in flight count too">
          A row that has been handed to the launcher but has not produced an instance yet occupies a slot, so
          the cap can never be overshot by a burst of releases.
        </KVRow>
      </KV>

      <h2>Following a run</h2>
      <p>
        <strong>Runs &amp; rows</strong> on the card opens a two-level drawer. The first level lists every run
        of that Bulk Upload, newest first.
      </p>
      <ul>
        <li>Run number, status badge, file name, and who uploaded it</li>
        <li>A counts line: queued, running, completed, failed, cancelled, skipped</li>
        <li>The throttle the run is using, and the reason it stopped if it auto-stopped</li>
        <li>Buttons: <strong>Rows</strong>, <strong>Pause</strong> / <strong>Resume</strong>, <strong>Cancel all</strong> (CSV export is marked as coming soon)</li>
      </ul>
      <p>
        <strong>Rows</strong> drills into that run's rows. There is a search box that matches a row's name, its
        number, or any value in it, and a chip per status that filters the list. Excluded rows are hidden by
        default so the rows that matter are not buried; click the Excluded chip to see them.
      </p>
      <p>Expanding a row shows the whole story of that one line:</p>
      <KV>
        <KVRow label="Payload / File row">
          Two tabs: the exact parameters sent to the workflow, and the raw file row behind them. When the wrong
          value went out, this is where you find out whether the file or the mapping was at fault.
        </KVRow>
        <KVRow label="Stages">
          <strong>Row validation</strong> (with the problems listed, if any) and <strong>Workflow Trigger</strong>,
          plus the current step of a running instance and an amber note while Baton is auto-retrying a failed
          launch.
        </KVRow>
        <KVRow label="Instance ID">
          Copyable, with <strong>Open in Docusign</strong> for the instance itself and{' '}
          <strong>Activity Log</strong> for its Baton-side history.
        </KVRow>
        <KVRow label="Cancel row">
          Cancels a single row. A queued row is simply dropped; a launched row's instance is cancelled in
          Docusign too. A row mid-launch cannot be cancelled - wait a moment and try again.
        </KVRow>
      </KV>
      <p>
        Rows are named <code>seq · first mapped value · row N</code>, and that same name becomes the instance
        name in Docusign - so a batch is readable from the Docusign side as well.
      </p>

      <h2>Pause, stop, resume, cancel</h2>
      <KV>
        <KVRow label="Pause">
          Halts releases for a running run. Rows already launched carry on; queued rows simply wait. Available
          per run in the drawer, or on the card strip.
        </KVRow>
        <KVRow label="Auto-stop">
          After the configured number of consecutive launch failures, the run stops itself, records why, and
          sends a <strong>Bulk Upload Run Stopped</strong> notification. Nothing is lost - the remaining rows
          stay queued.
        </KVRow>
        <KVRow label="Resume">
          Restarts a paused <em>or</em> stopped run, clears the auto-stop reason and resets the failure streak,
          so a resumed run does not immediately stop again. Fix the cause first.
        </KVRow>
        <KVRow label="Cancel all">
          Asks for a scope. <strong>Queue only</strong> cancels the rows that have not launched and leaves
          running instances alone; <strong>Queue and launched</strong> also cancels the workflow instances that
          are still running. Neither can be undone.
        </KVRow>
      </KV>
      <p>
        <strong>Pause all</strong> and <strong>Resume all</strong> on the card act on <em>every</em> matching
        active run of that Bulk Upload at once. Use a run's own strip, or the drawer, when you want to act on a
        single file.
      </p>

      <h2>Where failures land</h2>
      <p>
        A row that fails to launch keeps its error message inline, so the runs drawer is usually enough to
        diagnose a bad payload. Baton also retries a failed launch automatically, up to six attempts on a
        widening schedule, and the row shows the attempt count while that is happening.
      </p>
      <p>
        Everything the run actually launched behaves like any other workflow instance. Failures surface in the{' '}
        <DocLink to="control-center">Control Center</DocLink> alongside automation and test failures, tagged with the run and row that produced them -{' '}
        <strong>Run 3 · row 42</strong> - so you can retry or cancel them there without losing the lineage.
        The same instances appear in the <DocLink to="logs">Activity Log</DocLink>.
      </p>
      <Callout type="note" title="A launch that never reports back">
        If a launch goes silent - a worker died mid-flight, say - Baton fails that row after 90 minutes rather
        than leaving it stuck, so the run can close and the queue can move on. Those sweeps count toward the
        consecutive-failure limit, which is what makes a run stop when launches are vanishing wholesale.
      </Callout>

      <h2>Notifications</h2>
      <p>
        Two events are wired to Bulk Upload, both configurable in{' '}
        <DocLink to="notifications">Notifications &amp; alerts</DocLink>:
      </p>
      <KV>
        <KVRow label="Bulk Upload Run Finished">
          One summary per finished run, with the per-row counts. Normally{' '}
          <Badge color="green">Success</Badge>; a run that had failures is raised to{' '}
          <Badge color="amber">Warning</Badge> and reaches email and Slack as well.
        </KVRow>
        <KVRow label="Bulk Upload Run Stopped">
          <Badge color="red">Error</Badge>. A run auto-stopped on consecutive failures and rows are waiting on
          you. The loudest Bulk Upload event by design.
        </KVRow>
      </KV>
      <p>Both go to whoever started the run, falling back to the organization's owners and admins.</p>

      <h2>Limits and defaults</h2>
      <TableWrap>
        <table>
          <thead>
            <tr><th>Setting</th><th>Default</th><th>Allowed range</th></tr>
          </thead>
          <tbody>
            <tr><td>File formats</td><td colSpan={2}>CSV, XLSX, TSV</td></tr>
            <tr><td>File size</td><td colSpan={2}>10 MB per upload</td></tr>
            <tr><td>Rows per file</td><td colSpan={2}>No fixed limit - the 10 MB file size is the practical ceiling</td></tr>
            <tr><td>Rows per release</td><td>5</td><td>1 to 100</td></tr>
            <tr><td>Minutes between releases</td><td>10</td><td>1 to 1440 (24 hours)</td></tr>
            <tr><td>Stop after consecutive failures</td><td>5</td><td>1 to 100</td></tr>
            <tr><td>Unfinished instances cap</td><td>Off</td><td>1 to 10000</td></tr>
            <tr><td>Mark as Overdue after</td><td>Off</td><td>1 to 365 days</td></tr>
            <tr><td>Name</td><td>-</td><td>1 to 200 characters</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <Callout type="note" title="Who can do what">
        Owners, admins, superusers and members can create a Bulk Upload, upload files, start runs, and pause,
        resume or cancel them. Viewers can read the runs and rows but cannot launch anything.
      </Callout>

      <h2>Practical tips</h2>
      <KV>
        <KVRow label="Test with a range before committing the file">
          Upload the real file, but select rows 1 to 3 on the Rows step. Check the instances that come out,
          then upload the same file again for the rest.
        </KVRow>
        <KVRow label="Name your columns like the workflow's parameters">
          Auto-matching does the rest, and a file that maps itself is a file anyone on your team can re-upload.
        </KVRow>
        <KVRow label="Use a fixed value for the things that never change">
          A campaign name, a template variant, a sender - map it once as a fixed value rather than pasting a
          column of identical cells into the sheet.
        </KVRow>
        <KVRow label="Pick a throttle from the far end">
          Decide how many live signature requests you want at once, not how fast the file empties. A slower
          release with a healthy cap almost always beats a fast one you have to pause.
        </KVRow>
        <KVRow label="Re-export rather than repair">
          If the review step flags corrupted long numbers, fix it at the source - export as CSV, or format the
          column as text - instead of editing cells back by hand.
        </KVRow>
      </KV>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="workflows" title="Workflow Checker">
          Sync the workflow you want to launch and confirm it publishes the API parameters you need to map.
        </Card>
        <Card to="control-center" title="Control Center">
          Retry, postpone or cancel the instances a run launched, including everything marked Overdue.
        </Card>
        <Card to="troubleshooting" title="Troubleshooting &amp; FAQ">
          Rejected files, empty mapping steps, runs that stopped on their own, and rows that release slowly.
        </Card>
      </Cards>
    </>
  );
}

import { Lead, Callout, TableWrap, KV, KVRow, Cards, Card, Screenshot } from '../ui';
import { FilterTabsDemo, InProgressOriginDemo, PlatformAutomationDemo, ChipStatesDemo } from '../FilterDemo';
import { StatusLegend, InstanceCardShowcase } from '../CardDemo';
import controlCenterShot from '../assets/screenshots/control-center.png';

export default function ControlCenter() {
  return (
    <>
      <h1>Control Center</h1>
      <Lead>
        The Control Center is your fix-it queue: a single narrow page that surfaces every broken workflow
        instance and gives you the buttons to clear it - land here, fix everything, and leave with zeros.
      </Lead>

      <Callout type="note" title="Previously called the Resolution Center">
        Material from before v1.0.0 may call this page the <strong>Resolution Center</strong>. It is the
        same page: the sidebar entry, the page heading, and the URL all read <strong>Control Center</strong>.
      </Callout>

      <Screenshot
        src={controlCenterShot}
        alt="The Control Center page showing failed and running workflow instances grouped into tabs with Try Again and Cancel actions"
        caption="The Control Center - failed, overdue, and in-progress instances in tabs, each card with its own actions."
      />

      <h2>What the Control Center is for</h2>
      <p>
        The Control Center (<code>/control-center</code>) is the operational counterpart to the Flow Builder.
        Where the Flow Builder shows the wiring - every source, automation, and workflow - the Control Center
        shows what's <em>broken</em> and lets you act on it. Its header carries the working tagline:{' '}
        <em>"Fix everything → leave with zeros."</em> The page is intentionally narrow and focused: you come
        here when something has failed, you clear the list, and you leave.
      </p>
      <p>
        It covers every workflow instance your organization has launched, however it started - by an automation
        in the Flow Builder, by a Bulk Upload row, or by hand from the Workflow Checker. Whatever fails, fails
        here.
      </p>

      <h2>Where to find it</h2>
      <p>
        The sidebar entry is a <strong>shield</strong> icon labelled <strong>Control Center</strong>, sitting on
        its own below the main nav. It carries a small red badge counting your failed instances plus any
        automations currently in an error state; the badge caps its label at <code>9+</code> and disappears
        entirely at zero - so a shield with no badge means there is nothing to fix. Like the rest of the main
        nav, the entry stays greyed out until you have connected Docusign.
      </p>
      <p>At the top-right of the page, a header pill tells you the same thing in words:</p>
      <KV>
        <KVRow label="All clear">Green, with a shield tick, when nothing has failed.</KVRow>
        <KVRow label="N issue(s)">Red, where N is the number of <strong>failed</strong> instances.</KVRow>
      </KV>
      <p>
        Both the pill and the sidebar badge track failures only. Overdue and In Progress instances still need
        your attention but never turn the header red, so check those tabs even when the page says{' '}
        <strong>All clear</strong>.
      </p>

      <h2>The status tabs</h2>
      <p>
        Issues are organized into six tabs, each with its own live count badge. <strong>All</strong> is the
        default landing tab - it pools every actionable instance (Failed, Overdue, and In Progress) into one
        list so you can work top to bottom without tab-hopping.
      </p>

      <FilterTabsDemo />

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it holds</th><th>What you do here</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>All</strong></td><td>Every actionable instance - Failed, Overdue, and In Progress, deduped and newest first.</td><td>The default queue - work everything from a single place.</td></tr>
            <tr><td><strong>Failed</strong></td><td>Workflow instances in a failed state.</td><td>The primary fix-me queue - retry or cancel each one.</td></tr>
            <tr><td><strong>Overdue</strong></td><td>Every running instance past its Overdue threshold, whether or not you have touched it.</td><td>Give them more time with <strong>Add days</strong>, or cancel.</td></tr>
            <tr><td><strong>In Progress</strong></td><td>Running instances you or Baton have acted on - retried or postponed - that are not currently overdue.</td><td>Wait for them to land; cancel if needed.</td></tr>
            <tr><td><strong>Resolved</strong></td><td>Acted-on instances that went on to complete.</td><td>Kept as a confirmation log - nothing to fix.</td></tr>
            <tr><td><strong>Cancelled</strong></td><td>Acted-on instances that ended cancelled, usually because you cancelled them here.</td><td>A record, plus a last chance to re-run one.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        The count badge takes its tab's colour while there's something to act on, and fades to a grey zero when
        the tab is empty. Each tab also has its own empty state - for example, "No failed instances" - so an
        empty Failed tab confirms you're at zero.
      </p>

      <Callout type="note" title='"Overdue" needs a threshold'>
        An instance can only go overdue if it has a deadline to measure against. Automation-launched instances
        read <strong>Expected workflow instance duration</strong> from the automation in the Flow Builder;
        Bulk Upload instances carry their own copy, snapshotted from the run's{' '}
        <strong>Mark as Overdue after</strong> setting at launch. Set neither and nothing is ever flagged
        overdue.
      </Callout>

      <h2>How the filters work</h2>
      <p>
        Below the tabs sit up to three rows of filter chips that narrow what the active tab shows. They stack:
        the status tab is the coarse filter, and each chip row drills in further. Every chip is a button you
        toggle - the live controls below behave exactly like the ones in the app.
      </p>

      <h3>The In Progress origin sub-filter</h3>
      <p>
        Switch to the <strong>In Progress</strong> tab and an extra chip row appears. Instances land here from
        two different places, and this row lets you separate them: <strong>After Overdue</strong> is anything
        you postponed with Add days, and <strong>After Failed</strong> is everything else - instances you sent
        back with Try Again, plus any Baton is auto-retrying on its own. Each origin carries a coloured dot so
        the active filter is unmistakable.
      </p>

      <InProgressOriginDemo />

      <h3>Platform, then automation</h3>
      <p>
        The <strong>Platform</strong> row carries one chip per source platform across the instances Baton has
        loaded, plus an <strong>All</strong> chip that clears it. The row is the same on every tab, so a chip
        can be there even when the tab you are on has nothing from that platform. Pick a platform and a second{' '}
        <strong>Automation</strong> row cascades open - slightly dimmed, starting with{' '}
        <strong>All automations</strong> - so you can narrow to a single automation. Selecting a new platform
        always resets the automation choice, and both filters combine with the active tab.
      </p>

      <PlatformAutomationDemo />

      <h3>Reading the chip states</h3>
      <p>
        Across all three rows, a chip is only ever in one of a few states. Once you can read them, every filter
        row tells you its status at a glance:
      </p>

      <ChipStatesDemo />

      <p>
        Chip selections carry across tabs: narrow to one platform on Failed, switch to In Progress, and the
        same platform is still applied. If a tab looks emptier than its count badge suggests, a chip from an
        earlier tab is usually why - hit <strong>All</strong> to clear it.
      </p>

      <h2>Reading a per-instance card</h2>
      <p>Every issue is drawn as a card. From top to bottom, each card shows:</p>
      <ul>
        <li>The automation name (with a violet ⚡ icon) and the matched object</li>
        <li>A status badge in the status colour, plus a coloured left rail</li>
        <li>
          What launched it - <strong>Relay N</strong> for an automation, or{' '}
          <strong>Run N · row N</strong> when the instance came from a Bulk Upload
        </li>
        <li>The started time - or, for instances with a deadline, a "days passed / expected" count</li>
        <li>Who started it, and the source platform icon and name</li>
        <li>A progress bar with the current or final step, or the step it failed at</li>
        <li>The error message on a failure, or an amber auto-retry note while Baton is re-running it</li>
        <li>Free-form tags you can add for triage, shared across your org</li>
      </ul>
      <p>
        Cards launched with input parameters also carry a <strong>View Params</strong> button that expands the
        exact values the workflow received, with a one-click copy - the fastest way to see whether a failure
        was really a bad payload.
      </p>

      <p>
        The card's left rail and status badge are colour-coded, so you can read a list's health by colour alone:
      </p>

      <StatusLegend />

      <p>
        <strong>Overdue</strong> isn't a separate status - it's a <em>running</em> instance that has passed its
        expected duration, so its left rail stays blue and only the day count changes colour. It turns amber
        the moment the instance hits its expected duration, and red once it reaches half as long again. An
        instance sits in the Overdue tab from the amber point onward, so an amber count there is normal.
      </p>

      <p>Here are the three states you'll act on most, with the anatomy above laid out on each:</p>

      <InstanceCardShowcase />

      <KV>
        <KVRow label="Failed (red rail)">Shows the error and the step it failed at. Actions: Try Again, Cancel.</KVRow>
        <KVRow label="Overdue (running, amber or red day count)">Past its expected duration. Give it more time with Add days, or Cancel.</KVRow>
        <KVRow label="In Progress (auto-retrying)">Running after a retry; the amber note shows the auto-retry attempt and countdown, with Retry now to skip the wait.</KVRow>
      </KV>

      <h2>Actions, by tab</h2>
      <p>
        The buttons on a card follow the instance's status, so which ones you get depends on the tab you're
        looking at. Every card also offers <strong>View Params</strong> when it has input parameters, and the{' '}
        <strong>Docusign</strong> menu when its workflow has been synced.
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>Available actions</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>All</strong></td><td>Whatever each card carries in its own tab, including <strong>Add days</strong> on the overdue ones</td></tr>
            <tr><td><strong>Failed</strong></td><td>Try Again · Cancel</td></tr>
            <tr><td><strong>Overdue</strong></td><td>Add days · Cancel (plus Retry now if it is auto-retrying)</td></tr>
            <tr><td><strong>In Progress</strong></td><td>Cancel (plus Retry now if it is auto-retrying)</td></tr>
            <tr><td><strong>Resolved</strong></td><td>Read-only</td></tr>
            <tr><td><strong>Cancelled</strong></td><td>Try Again</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        <strong>Add days</strong> is the one action tied to a tab rather than a status: it appears on the
        Overdue tab, and on <strong>All</strong> for the cards that are actually overdue. You won't see it
        under In Progress, because an instance sitting there has already been given its extra time.
      </p>

      <h3>Try Again</h3>
      <p>
        <strong>Try Again</strong> re-launches the workflow from the beginning with the instance's original
        input parameters. It reuses the same instance record rather than creating a new one, so the lineage on
        the card - the Relay or Bulk Upload run that started it - stays attached and the history stays in one
        place. Baton also clears the old error, resets the auto-retry counter to <code>0/6</code>, and
        abandons any auto-retry that was still pending, so you never get two attempts racing each other. The
        instance flips to running and moves to <strong>In Progress</strong>; watch it there until it lands in{' '}
        <strong>Resolved</strong>.
      </p>
      <p>
        A completed instance can't be re-run - there is nothing to fix - which is why the Resolved tab is
        read-only. Cancelled ones can, so Try Again is still there if you cancelled something by mistake.
      </p>

      <h3>Retry now</h3>
      <p>
        While Baton is auto-retrying a running instance, the card shows an amber{' '}
        <strong>Auto-retry n/6</strong> note with a countdown to the next attempt.{' '}
        <strong>Retry now</strong> skips that wait and starts the attempt immediately - the same action as Try
        Again, just reached from a card that is already running.
      </p>

      <h3>Cancel</h3>
      <p>
        <strong>Cancel</strong> asks Workflow Builder to abort the instance, then marks it cancelled in Baton
        and moves it to the <strong>Cancelled</strong> tab. If Workflow Builder refuses - typically because the
        run already reached a terminal state - Baton records the cancellation locally anyway, so the tab
        reflects your intent either way. That local state also sticks: later polls won't quietly flip the
        instance back to whatever Workflow Builder still reports.
      </p>

      <h3>Add days</h3>
      <p>
        <strong>Add days</strong> takes a number between 1 and 365 (7 by default) and pushes the Overdue
        deadline out by that many days <em>from now</em>, not from when the instance started. The instance
        leaves Overdue for <strong>In Progress</strong>, where the <strong>After Overdue</strong> chip picks it
        up, and only resurfaces as overdue if it is still running when the new deadline passes.
      </p>

      <h2>The Docusign menu</h2>
      <p>
        Each card ends with a <strong>Docusign</strong> dropdown offering two ways into the source:{' '}
        <strong>Detail</strong> opens the instance's monitor view inside Docusign Workflow Builder, and{' '}
        <strong>Open</strong> opens the instance itself. Both open in a new tab. The menu only appears once the
        card's workflow has been synced from Docusign, since that sync is what gives Baton the link to follow.
      </p>

      <Callout type="tip" title="Leave with zeros">
        Treat this page as a checklist, not a dashboard you watch. Start on the Failed tab and work each card
        top to bottom - Try Again on the ones that should re-run, Cancel the ones that shouldn't. Then sweep
        Overdue, giving more time or cancelling, and check In Progress until those clear into Resolved. When
        the shield badge disappears, the header reads <strong>All clear</strong>, and Overdue is at zero,
        you're done. That's "leave with zeros."
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="logs" title="Relay logs & instances">See the full Verify → Route lifecycle behind each instance and the automatic retry schedule.</Card>
        <Card to="notifications" title="Notifications & alerts">Get alerted the moment an automation exhausts its retries - before you even open this page.</Card>
      </Cards>
    </>
  );
}

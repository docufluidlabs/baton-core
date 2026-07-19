import { Lead, Callout, TableWrap, KV, KVRow, Cards, Card, Screenshot } from '../ui';
import { FilterTabsDemo, InProgressOriginDemo, PlatformAutomationDemo, ChipStatesDemo } from '../FilterDemo';
import { StatusLegend, InstanceCardShowcase } from '../CardDemo';
import controlCenterShot from '../assets/screenshots/control-center.png';

export default function ControlCenter() {
  return (
    <>
      <h1>Resolution Center</h1>
      <Lead>
        The Resolution Center is your fix-it queue: a single narrow page that surfaces every broken Maestro
        instance and gives you the buttons to clear it — land here, fix everything, and leave with zeros.
      </Lead>

      <Screenshot
        src={controlCenterShot}
        alt="The Resolution Center page showing failed and running Maestro instances grouped into tabs with Retry and Cancel actions"
        caption="The Resolution Center — failed, in-progress, and resolved instances in tabs, each card with Retry / Cancel."
      />

      <h2>What the Resolution Center is for</h2>
      <p>
        The Resolution Center (<code>/control-center</code>) is the operational counterpart to the Flow Builder.
        Where the Flow Builder shows the wiring — every source, automation, and workflow — the Resolution Center
        shows what's <em>broken</em> and lets you act on it. Its header carries the working tagline:{' '}
        <em>"Fix everything → leave with zeros."</em> The page is intentionally narrow and focused: you come
        here when something has failed, you clear the list, and you leave.
      </p>

      <h2>Where to find it</h2>
      <p>
        The sidebar entry is a red <strong>shield</strong> icon with a badge that counts unresolved issues.
        When there are zero failed or errored items, the badge disappears entirely — so a shield with no badge
        means there is nothing to fix.
      </p>
      <p>At the top-right of the page, a header indicator tells you the same thing in words:</p>
      <KV>
        <KVRow label="All clear">Shown in green when there are zero issues to act on.</KVRow>
        <KVRow label="N issue(s)">Shown in red when items need your action, where N is the count.</KVRow>
      </KV>

      <h2>The status tabs</h2>
      <p>
        Issues are organized into six tabs, each with its own live count badge. <strong>All</strong> is the
        default landing tab — it pools every actionable instance (Failed, Overdue, and In Progress) into one
        list so you can work top to bottom without tab-hopping.
      </p>

      <FilterTabsDemo />

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it holds</th><th>What you do here</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>All</strong></td><td>Every actionable instance — Failed, Overdue, and In Progress, deduped into one list.</td><td>The default queue — work everything from a single place.</td></tr>
            <tr><td><strong>Failed</strong></td><td>Maestro instances in a failed state.</td><td>The primary fix-me queue — retry or cancel each one.</td></tr>
            <tr><td><strong>Overdue</strong></td><td>Running instances that have passed their expected duration.</td><td>Give them more time with <strong>Add days</strong>, or cancel.</td></tr>
            <tr><td><strong>In Progress</strong></td><td>Instances running after a retry or a postpone was kicked off.</td><td>Wait for them to land; cancel if needed.</td></tr>
            <tr><td><strong>Resolved</strong></td><td>Instances that were retried and reached completed.</td><td>Kept as a confirmation log — nothing to fix.</td></tr>
            <tr><td><strong>Cancelled</strong></td><td>Instances explicitly cancelled, by you or by Docusign.</td><td>A record only — nothing to fix.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        The count badge takes its tab's colour while there's something to act on, and fades to a grey zero when
        the tab is empty. Each tab also has its own empty state — for example, "No failed instances" — so an
        empty Failed tab confirms you're at zero.
      </p>

      <Callout type="note" title='"Overdue" needs an expected duration'>
        The Overdue tab only fills once an automation has an <strong>Expected workflow instance duration</strong>{' '}
        set in the Flow Builder. Without it, Baton has no deadline to measure against, so nothing is ever
        flagged overdue.
      </Callout>

      <h2>How the filters work</h2>
      <p>
        Below the tabs sit up to three rows of filter chips that narrow what the active tab shows. They stack:
        the status tab is the coarse filter, and each chip row drills in further. Every chip is a button you
        toggle — the live controls below behave exactly like the ones in the app.
      </p>

      <h3>The In Progress origin sub-filter</h3>
      <p>
        Switch to the <strong>In Progress</strong> tab and an extra chip row appears. Instances land here from
        two different places, and this row lets you separate them: <strong>After Failed</strong> (you hit Try
        Again on a failure) versus <strong>After Overdue</strong> (you postponed an overdue instance with Add
        days). Each origin carries a coloured dot so the active filter is unmistakable.
      </p>

      <InProgressOriginDemo />

      <h3>Platform, then automation</h3>
      <p>
        The <strong>Platform</strong> row carries one chip per source platform present in the list, plus an{' '}
        <strong>All</strong> chip that clears it. Pick a platform and a second <strong>Automation</strong> row
        cascades open — slightly dimmed — so you can narrow to a single automation. Selecting a new platform
        always resets the automation choice, and the two filters combine with the active tab.
      </p>

      <PlatformAutomationDemo />

      <h3>Reading the chip states</h3>
      <p>
        Across all three rows, a chip is only ever in one of a few states. Once you can read them, every filter
        row tells you its status at a glance:
      </p>

      <ChipStatesDemo />

      <p>
        Filter selections are independent per tab — narrowing Failed doesn't change what you see under In
        Progress — so you can keep a different lens on each queue.
      </p>

      <h2>Reading a per-instance card</h2>
      <p>Every issue is drawn as a card. From top to bottom, each card shows:</p>
      <ul>
        <li>The automation name (with a violet ⚡ icon) and the matched object</li>
        <li>A status badge in the status colour, plus a coloured left rail</li>
        <li>The started time — or, for instances with a deadline, a "days passed" count</li>
        <li>The source platform icon and name</li>
        <li>A progress bar with the current or final step</li>
        <li>Free-form tags you can add for triage, shared across your org</li>
      </ul>

      <p>
        The card's left rail and status badge are colour-coded, so you can read a list's health by colour alone:
      </p>

      <StatusLegend />

      <p>
        <strong>Overdue</strong> isn't a separate status — it's a <em>running</em> instance that has passed its
        expected duration, so its left rail stays blue while the "days passed" count turns red.
      </p>

      <p>Here are the three states you'll act on most, rendered exactly as they appear in the app:</p>

      <InstanceCardShowcase />

      <KV>
        <KVRow label="Failed (red rail)">Shows the error and the step it failed at. Actions: Try Again, Cancel, Support, Open in Docusign.</KVRow>
        <KVRow label="Overdue (running, red day count)">Past its expected duration. Give it more time with Add days, or Cancel.</KVRow>
        <KVRow label="In Progress (auto-retrying)">Running after a retry; the amber note shows the auto-retry attempt and countdown.</KVRow>
      </KV>

      <h2>Actions, by tab</h2>
      <p>
        The buttons on a card depend on which tab it's in. Failed instances get the full set; the other tabs
        are progressively read-only.
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>Available actions</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Failed</strong></td><td>Retry · Cancel · Report Issue · Open in Docusign</td></tr>
            <tr><td><strong>Overdue</strong></td><td>Add days · Cancel · Open in Docusign</td></tr>
            <tr><td><strong>In Progress</strong></td><td>Cancel · Open in Docusign</td></tr>
            <tr><td><strong>Resolved</strong></td><td>Open in Docusign</td></tr>
            <tr><td><strong>Cancelled</strong></td><td>Open in Docusign</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h3>Retry</h3>
      <p>
        <strong>Retry</strong> restarts the instance from the beginning. The original Action lineage stays
        attached — retries are tracked against the same Action rather than creating new ones — and the instance
        moves to the <strong>In Progress</strong> tab. Watch it there until it lands in <strong>Resolved</strong>.
      </p>

      <h3>Cancel</h3>
      <p>
        <strong>Cancel</strong> asks Maestro to abort the instance and moves it to the{' '}
        <strong>Cancelled</strong> tab. Some Maestro states can't be cancelled — for example, an instance that
        has already completed or already been cancelled. If Maestro refuses, Baton surfaces Maestro's own error
        so you know why.
      </p>

      <h3>Report Issue</h3>
      <p>
        <strong>Report Issue</strong> sends a support ticket to the Baton team. The ticket carries the instance
        ID, the automation context, and the description you type. Reported IDs are remembered, so the "Reported"
        badge persists when you come back.
      </p>

      <h2>Open in Docusign</h2>
      <p>
        <strong>Open in Docusign</strong> is available on every tab. It deep-links straight to the instance
        inside Docusign Maestro when you need to inspect the run at the source.
      </p>

      <Callout type="tip" title="Leave with zeros">
        Treat the Resolution Center as a checklist, not a dashboard you watch. Start on the Failed tab, work each
        card top to bottom — Retry the ones that should re-run, Cancel the ones that shouldn't — then check In
        Progress until those clear into Resolved. When the shield badge disappears and the header reads{' '}
        <strong>All clear</strong>, you're done. That's "leave with zeros."
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="logs" title="Action logs & instances">See the full Verify → Route lifecycle behind each instance and the automatic retry schedule.</Card>
        <Card to="notifications" title="Notifications & alerts">Get alerted the moment an automation exhausts its retries — before you even open the Resolution Center.</Card>
      </Cards>
    </>
  );
}

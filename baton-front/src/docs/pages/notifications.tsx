import { Lead, Callout, TableWrap, KV, KVRow, Badge, Steps, Step, Cards, Card, Screenshot } from '../ui';
import notificationsShot from '../assets/screenshots/notifications.png';

export default function Notifications() {
  return (
    <>
      <h1>Notifications & alerts</h1>
      <Lead>
        Baton tells you the moment something needs attention - through the in-app bell, through Slack, and by
        email - and the Notifications page is where you choose what fires, where it lands, and read the full
        feed.
      </Lead>

      <Screenshot
        src={notificationsShot}
        alt="The Notifications page with preferences, Slack routing, and the in-app inbox feed"
        caption="The Notifications page - per-event preferences, Slack routing, and the in-app inbox feed."
      />

      <h2>The Notifications page</h2>
      <p>
        The Notifications page (<code>/notifications</code>) has three tabs, left to right:{' '}
        <strong>Slack</strong>, <strong>Preferences</strong>, and <strong>Inbox</strong>.{' '}
        <strong>Preferences</strong> is the one that opens first.
      </p>

      <Callout type="note" title="Three channels - only two of them live on this page">
        An event can reach you three ways: <strong>In-App</strong> (the bell and the Inbox),{' '}
        <strong>Slack</strong>, and <strong>email</strong>. Preferences currently exposes the In-App column
        only, Slack has its own tab, and email follows Baton's built-in per-event defaults - the loud events
        (a failed workflow, an exhausted automation, a stopped Bulk Upload run, a degraded connection, a
        rejected webhook) email; the routine ones do not. Email is sent only when your server has{' '}
        <code>RESEND_API_KEY</code> set.
        Without it, the email step is skipped silently and in-app and Slack are unaffected.
      </Callout>

      <Callout type="note" title="Self-hosting? Register your Slack app first">
        On a self-hosted Baton, <strong>Add to Slack</strong> works once your administrator has registered a
        Slack app for your workspace and set the <code>SLACK_*</code> environment variables - a one-time,
        ~10-minute step. The walkthrough (with a copy-paste app manifest) is in{' '}
        <code>docs/slack-notifications.md</code> in the Baton repository.
      </Callout>

      <h3>Preferences</h3>
      <p>
        The <strong>Preferences</strong> tab is a per-event matrix with a single channel column,{' '}
        <strong>In-App</strong>. Toggle a row to decide whether that event reaches the bell and the Inbox, or
        click the column header to flip every row at once. Edits are staged until you press{' '}
        <strong>Save Preferences</strong>; <strong>Discard</strong> throws them away. Slack delivery is not
        set here - it lives under <strong>Slack → Channel Routing</strong>.
      </p>
      <p>
        Preferences are stored per organization rather than per person, so one save changes what your whole
        team receives.
      </p>

      <h3>Slack</h3>
      <p>The <strong>Slack</strong> tab holds your Slack integration config:</p>
      <ul>
        <li>The workspace card - <strong>Add to Slack</strong> while nothing is installed, <strong>Disconnect</strong> once the bot is in. Everything below it appears only after the bot is connected.</li>
        <li>A master <strong>enable / pause</strong> toggle for the whole integration. Paused means Baton sends nothing to Slack, whatever the routing says.</li>
        <li><strong>Channel Routing</strong> - a <strong>Default</strong> row plus one row per event. Each event row picks a channel, falls back to the default, or is set to <strong>Don't send</strong> to suppress that event entirely. Setting the Default row to Don't send silences everything you have not routed explicitly.</li>
        <li><strong>Save Settings</strong> and <strong>Send Test Message</strong>. The test posts to your default channel.</li>
      </ul>
      <p>
        Each row is a searchable picker listing the channels the bot can see, with private channels marked and
        member counts alongside. If Baton cannot list your channels, the row falls back to a plain text field
        where you type the channel name yourself.
      </p>

      <Callout type="note" title="Slack changes need an admin">
        Connecting, disconnecting, routing, and testing Slack are restricted to the <strong>owner</strong>,{' '}
        <strong>admin</strong>, and <strong>superuser</strong> roles. Everyone else can still read the Inbox
        and the bell.
      </Callout>

      <h3>Inbox</h3>
      <p>The <strong>Inbox</strong> tab is the in-app feed of every notification. Filter it two ways:</p>
      <KV>
        <KVRow label="Severity">All · Error · Warning · Success · Info</KVRow>
        <KVRow label="Category">Chips built from the events actually in your feed - <code>workflow_failed</code>, <code>batch_run_completed</code>, <code>webhook_failed</code>, and so on. The row appears only when there is something to filter by.</KVRow>
      </KV>
      <p>
        Each entry shows a severity icon, the title and message, a relative timestamp, a category tag, and -
        when the event points somewhere - a "View details →" link. Per-item controls sit on the right: mark
        read (✓) and dismiss (×). Dismissing removes the entry from the feed for good. Entries are grouped by
        age - Today, Yesterday, This Week, Earlier. Whenever something is unread, an unread count appears
        above the list on the left and a <strong>Mark all read</strong> button on the right.
      </p>

      <h2>The notification bell</h2>
      <p>
        The bell in the global header opens a popover holding the 20 most recent entries with the same
        mark-read and dismiss controls, minus the filters, date groups, and category tags. Its badge is the
        Inbox unread count - both refresh together after any action - except that it stops counting at{' '}
        <strong>9+</strong>. Rolled-up failures carry a <strong>×N</strong> counter on the title.
      </p>

      <h2>The seven event types</h2>
      <p>
        Seven events appear in both the Preferences matrix and Slack routing, each with a severity that fixes
        its icon and color:
      </p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Event</th><th>Severity</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>Workflow Failed</td><td><Badge color="red">Error</Badge></td><td>A workflow instance crashed or errored out. Repeat failures of the same automation within the same hour roll up into a single counted entry instead of stacking.</td></tr>
            <tr><td>Workflow Completed</td><td><Badge color="green">Success</Badge></td><td>A workflow instance finished successfully. Usually best left off - routine completions are the relay log's job.</td></tr>
            <tr><td>Bulk Upload Run Finished</td><td><Badge color="green">Success</Badge></td><td>One summary per finished Bulk Upload run, with the per-row counts. A run that had failures is raised to Warning and emails as well.</td></tr>
            <tr><td>Bulk Upload Run Stopped</td><td><Badge color="red">Error</Badge></td><td>A run auto-stopped after too many consecutive launch failures. Remaining rows are on hold until you resume it.</td></tr>
            <tr><td>Automation Failed</td><td><Badge color="red">Error</Badge></td><td>Every retry attempt is exhausted - the instance needs manual action.</td></tr>
            <tr><td>Connection Degraded</td><td><Badge color="red">Error</Badge></td><td>A platform connection is down and blocking API requests.</td></tr>
            <tr><td>Webhook Failed</td><td><Badge color="amber">Warning</Badge></td><td>An incoming webhook's HMAC signature was rejected.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <p>
        A few categories sit outside the matrix - a connection being removed, or an automation rule
        auto-pausing. They still reach the bell and the default Slack channel; they just follow Baton's
        severity defaults instead of a per-event toggle.
      </p>

      <h2>Who gets alerted</h2>
      <KV>
        <KVRow label="Workflow events">The person who launched the instance. Instances launched by an automation have no human owner, so they go to the organization's owners and admins.</KVRow>
        <KVRow label="Bulk Upload runs">Whoever started the run, falling back to owners and admins.</KVRow>
        <KVRow label="Webhook Failed">Owners and admins - a rejected signature is a configuration problem, not an end-user one.</KVRow>
      </KV>
      <p>
        Slack routing is per organization, not per person, so a channel gets one message per event even when
        several people are notified in-app.
      </p>

      <h2>Connecting and routing Slack</h2>
      <p>Sending events to Slack takes two parts: connect your workspace, then map events to channels.</p>

      <Steps>
        <Step title="Connect your workspace">On the Slack tab, click <strong>Add to Slack</strong> and authorize the bot in your Slack workspace. You come back to Baton with the workspace name on the card.</Step>
        <Step title="Enable the integration">Switch the master toggle on so Baton can post messages.</Step>
        <Step title="Set a default channel">Under Channel Routing, pick the channel that receives anything you don't route elsewhere.</Step>
        <Step title="Add per-event overrides">Route critical alerts - such as <strong>Automation Failed</strong> and <strong>Bulk Upload Run Stopped</strong> - to a high-signal channel, send routine events elsewhere, and set anything you never want to see to <strong>Don't send</strong>.</Step>
        <Step title="Save and test">Click <strong>Save Settings</strong>, then use <strong>Send Test Message</strong> to confirm Baton has the right permissions and the message lands where you expect.</Step>
      </Steps>

      <p>
        A Slack message leads with the severity emoji and the event name, then a two-field block -{' '}
        <strong>Workflow</strong> and <strong>Instance</strong> - and a context line carrying your
        organization and the timestamp. Failures add the failed step, the retry count, and the error text in a
        code block. Buttons: <strong>View in Baton</strong>, plus <strong>Open in Workflow Builder ↗</strong>{' '}
        when Baton has the deep link. Events without a dedicated layout, the Bulk Upload ones included, post as
        a title, the summary line, and a <strong>View Details ↗</strong> button.
      </p>

      <Callout type="note" title="Slack messages are scrubbed before they leave Baton">
        Only an allowlist of operational fields - workflow and instance names, the failing step, retry counts,
        platform and rule names - is ever sent, so raw trigger payloads never reach a channel. Email addresses
        and phone-like numbers in the remaining text are masked.
      </Callout>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="control-center" title="Control Center">When an Automation Failed alert fires, this is where you go to retry or cancel the broken instance.</Card>
        <Card to="logs" title="Relay logs & instances">The full run history behind every alert, including the routine successes that deliberately never notify.</Card>
        <Card to="settings" title="Settings">Organization details, members, and the audit log - roles decide who receives the owner-and-admin alerts.</Card>
      </Cards>
    </>
  );
}

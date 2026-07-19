import { Lead, Callout, TableWrap, KV, KVRow, Badge, Steps, Step, Cards, Card, Screenshot } from '../ui';
import notificationsShot from '../assets/screenshots/notifications.png';

export default function Notifications() {
  return (
    <>
      <h1>Notifications & alerts</h1>
      <Lead>
        Baton tells you the moment something needs attention — through the in-app bell and through Slack — and
        the Notifications page is where you choose what fires, where it lands, and review the full feed.
      </Lead>

      <Screenshot
        src={notificationsShot}
        alt="The Notifications page with preferences, Slack routing, and the in-app inbox feed"
        caption="The Notifications page — per-event preferences, Slack routing, and the in-app inbox feed."
      />

      <h2>The Notifications page</h2>
      <p>
        The Notifications page (<code>/notifications</code>) has three tabs: <strong>Preferences</strong>,{' '}
        <strong>Slack</strong>, and <strong>Inbox</strong>.
      </p>

      <Callout type="note" title="Two delivery channels — email is not one of them">
        These events are delivered through exactly two channels: <strong>In-App</strong> (the bell) and{' '}
        <strong>Slack</strong>. Email is not a delivery channel for notification events, so configure alerts
        through the bell and Slack.
      </Callout>

      <h3>Preferences</h3>
      <p>
        The <strong>Preferences</strong> tab is a per-event toggle matrix. For each event type you choose
        whether it's delivered <strong>In-App</strong> (the bell), through <strong>Slack</strong>, or both.
        Turn off the events you don't want to hear about and keep the critical ones on every channel.
      </p>

      <h3>Slack</h3>
      <p>The <strong>Slack</strong> tab holds your Slack integration config:</p>
      <ul>
        <li>A master <strong>enable / pause</strong> toggle for the whole integration</li>
        <li><strong>Channel Routing</strong> — choose which Slack channel receives each event type. A default channel handles anything unrouted, and per-event overrides are optional.</li>
        <li><strong>Save Settings</strong> and <strong>Send Test Message</strong> buttons</li>
      </ul>

      <h3>Inbox</h3>
      <p>The <strong>Inbox</strong> tab is the in-app feed of every notification. Filter it two ways:</p>
      <KV>
        <KVRow label="Severity">All · Error · Warning · Success · Info</KVRow>
        <KVRow label="Category">Auto-populated from event tags such as <code>connection_created</code> or <code>workflow_synced</code>.</KVRow>
      </KV>
      <p>
        Each entry shows a severity icon, a title, a timestamp, a "View details →" link, and a category tag,
        plus per-item dismiss (×) and mark-read (✓) controls. Entries are time-grouped — Today, Yesterday, This
        Week, and so on. The top-right of the Inbox shows the unread count and a <strong>Mark all read</strong>{' '}
        button.
      </p>

      <h2>The notification bell</h2>
      <p>
        The bell in the global header opens a popover that mirrors the Inbox — the same entries and the same
        dismiss and mark-read controls. The bell's badge matches the Inbox unread count, so the two always
        agree.
      </p>

      <h2>The six event types</h2>
      <p>Baton fires six event types, each with a fixed severity:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Event</th><th>Severity</th><th>Meaning</th></tr>
          </thead>
          <tbody>
            <tr><td>Workflow Failed</td><td><Badge color="red">Error</Badge></td><td>A workflow instance crashes or errors out.</td></tr>
            <tr><td>Workflow Completed</td><td><Badge color="green">Success</Badge></td><td>A workflow instance finishes successfully.</td></tr>
            <tr><td>Workflow Launched</td><td><Badge color="blue">Info</Badge></td><td>A new workflow instance starts running.</td></tr>
            <tr><td>Automation Failed</td><td><Badge color="red">Error</Badge></td><td>All retry attempts exhausted — needs manual action.</td></tr>
            <tr><td>Connection Degraded</td><td><Badge color="red">Error</Badge></td><td>A platform connection is down — blocks API requests.</td></tr>
            <tr><td>Webhook Failed</td><td><Badge color="amber">Warning</Badge></td><td>An incoming webhook signature was rejected.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>Connecting and routing Slack</h2>
      <p>Sending events to Slack takes two parts: connect your workspace, then map events to channels.</p>

      <Steps>
        <Step title="Connect your workspace">On the Slack tab, click <strong>Connect Slack</strong> to start the install and authorize flow for your Slack workspace.</Step>
        <Step title="Enable the integration">Switch the master enable toggle on so Baton can post messages.</Step>
        <Step title="Set a default channel">Under Channel Routing, pick the default channel that receives anything you don't route elsewhere.</Step>
        <Step title="Add per-event overrides">Route critical alerts — such as <strong>Automation Failed</strong> and <strong>Connection Degraded</strong> — to a high-signal channel, while routine events go elsewhere.</Step>
        <Step title="Save and test">Click <strong>Save Settings</strong>, then use <strong>Send Test Message</strong> to confirm Baton has the right permissions and the message lands where you expect.</Step>
      </Steps>

      <p>
        A typical Slack message includes a severity icon and the event title, your org and the automation name,
        the Maestro Instance ID with a "View in Baton" link, and — for failures — a short error excerpt.
      </p>

      <h2>Where to go next</h2>
      <Cards>
        <Card to="control-center" title="Resolution Center">When an Automation Failed alert fires, this is where you go to retry or cancel the broken instance.</Card>
        <Card to="settings" title="Settings">Manage your org and the connections that drive Connection Degraded alerts.</Card>
      </Cards>
    </>
  );
}

import { Lead, Callout, TableWrap, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import settingsShot from '../assets/screenshots/settings.png';

export default function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <Lead>The Settings page is where you manage your organization's details, members, and notifications — organized into three tabs.</Lead>

      <Screenshot
        src={settingsShot}
        alt="The Settings page General tab with organization name, timezone, and notification email fields"
        caption="The Settings page — organization details, members, and audit log across three tabs."
      />

      <p>Open <strong>Settings</strong> from the main navigation. You'll find three tabs across the top:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it does</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>General</strong></td><td>Organization name, timezone, notification email, and your Slack webhook.</td></tr>
            <tr><td><strong>Members</strong></td><td>Manage admins on your organization. <Badge color="gray">Coming soon</Badge></td></tr>
            <tr><td><strong>Audit Log</strong></td><td>A record of meaningful actions in your organization. <Badge color="gray">Coming soon</Badge></td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>General</h2>
      <p>The General tab holds your organization-level configuration. After editing any field, click <strong>Save Changes</strong> to apply it.</p>

      <KV>
        <KVRow label="Organization Name">The display name for your organization.</KVRow>
        <KVRow label="Timezone">The timezone used across Baton. Defaults to UTC; pick yours from the dropdown so timestamps read correctly.</KVRow>
        <KVRow label="Notification Email">A single email address for admin notices.</KVRow>
        <KVRow label="Slack Webhook URL">The Incoming Webhook URL from your Slack workspace, used to deliver event notifications to a channel.</KVRow>
      </KV>

      <h3>Notification Email vs. event notifications</h3>
      <p>These are two different things, and it's worth keeping them straight:</p>
      <ul>
        <li><strong>Notification Email</strong> receives <em>account-level</em> messages — admin alerts.</li>
        <li><strong>Event notifications</strong> — the alerts about what your automations are doing (for example, a workflow failure) — are delivered through Slack and In-App instead. See <DocLink to="notifications">Notifications</DocLink> for the full list.</li>
      </ul>

      <h3>Connecting Slack</h3>
      <p>To receive event notifications in a Slack channel, paste the URL from your Slack workspace's <strong>Incoming Webhooks</strong> integration into the <strong>Slack Webhook URL</strong> field, then click <strong>Save Changes</strong>.</p>

      <Callout type="tip" title="Where to get the URL">Create an Incoming Webhook in your Slack workspace's integrations, choose the channel that should receive alerts, and copy the generated URL into Baton.</Callout>

      <h2>Members</h2>
      <Callout type="note" title="Coming soon">The Members tab is in the interface but not yet active — it currently shows "No members found." Today each organization has a single admin. An invite flow for adding more admins is planned.</Callout>

      <h2>Audit Log</h2>
      <Callout type="note" title="Coming soon">The Audit Log — "Recent actions performed in your organization" — is in the interface but not yet capturing entries. When available it will record meaningful org actions such as connections added, automations created, secrets rotated, members invited, and role changes.</Callout>
    </>
  );
}

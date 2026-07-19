import { Lead, Callout, TableWrap, Badge, KV, KVRow, DocLink, Screenshot } from '../ui';
import settingsShot from '../assets/screenshots/settings.png';

export default function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <Lead>The Settings page is where you manage your organization's details, notifications, plan, and billing — organized into four tabs.</Lead>

      <Screenshot
        src={settingsShot}
        alt="The Settings page General tab with organization name, timezone, and notification email fields"
        caption="The Settings page — organization details, members, billing, and audit log across four tabs."
      />

      <p>Open <strong>Settings</strong> from the main navigation. You'll find four tabs across the top:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it does</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>General</strong></td><td>Organization name, timezone, notification email, and your Slack webhook.</td></tr>
            <tr><td><strong>Members</strong></td><td>Manage admins on your organization. <Badge color="gray">Coming soon</Badge></td></tr>
            <tr><td><strong>Billing</strong></td><td>Your current plan, usage this cycle, and available plans.</td></tr>
            <tr><td><strong>Audit Log</strong></td><td>A record of meaningful actions in your organization. <Badge color="gray">Coming soon</Badge></td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>General</h2>
      <p>The General tab holds your organization-level configuration. After editing any field, click <strong>Save Changes</strong> to apply it.</p>

      <KV>
        <KVRow label="Organization Name">The display name for your organization.</KVRow>
        <KVRow label="Timezone">The timezone used across Baton. Defaults to UTC; pick yours from the dropdown so timestamps read correctly.</KVRow>
        <KVRow label="Notification Email">A single email address for billing and admin notices.</KVRow>
        <KVRow label="Slack Webhook URL">The Incoming Webhook URL from your Slack workspace, used to deliver event notifications to a channel.</KVRow>
      </KV>

      <h3>Notification Email vs. event notifications</h3>
      <p>These are two different things, and it's worth keeping them straight:</p>
      <ul>
        <li><strong>Notification Email</strong> receives <em>account-level</em> messages — billing notices and admin alerts.</li>
        <li><strong>Event notifications</strong> — the alerts about what your automations are doing (for example, an action limit approaching) — are delivered through Slack and In-App instead. See <DocLink to="notifications">Notifications</DocLink> for the full list.</li>
      </ul>

      <h3>Connecting Slack</h3>
      <p>To receive event notifications in a Slack channel, paste the URL from your Slack workspace's <strong>Incoming Webhooks</strong> integration into the <strong>Slack Webhook URL</strong> field, then click <strong>Save Changes</strong>.</p>

      <Callout type="tip" title="Where to get the URL">Create an Incoming Webhook in your Slack workspace's integrations, choose the channel that should receive alerts, and copy the generated URL into Baton.</Callout>

      <h2>Members</h2>
      <Callout type="note" title="Coming soon">The Members tab is in the interface but not yet active — it currently shows "No members found." Today each organization has a single admin. An invite flow for adding more admins is planned, and how many seats you'll have is set by your plan.</Callout>

      <h2>Billing</h2>
      <p>The Billing tab gives you an at-a-glance view of your plan and how much you've used this cycle. It has three sections:</p>

      <KV>
        <KVRow label="Current Plan">A card showing your active plan with an <Badge color="green">Active</Badge> badge.</KVRow>
        <KVRow label="Usage">Two progress bars — <strong>Total Actions</strong> (actions used this billing cycle against your plan's monthly allowance) and <strong>Admins added</strong> (seats used against your allowance).</KVRow>
        <KVRow label="Available Plans">Comparison cards for upgrading or switching. Your current plan is highlighted; the others show actions like "Contact Us" or "Get Started."</KVRow>
      </KV>

      <Callout type="note" title="More on plans and actions">For the full plan comparison, what counts as an action, overage pricing, and how to upgrade through Stripe, see <DocLink to="billing">Plans &amp; billing</DocLink>.</Callout>

      <h2>Audit Log</h2>
      <Callout type="note" title="Coming soon">The Audit Log — "Recent actions performed in your organization" — is in the interface but not yet capturing entries. When available it will record meaningful org actions such as connections added, automations created, secrets rotated, members invited, and role changes.</Callout>
    </>
  );
}

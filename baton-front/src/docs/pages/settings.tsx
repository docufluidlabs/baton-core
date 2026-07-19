import { Lead, Callout, TableWrap, KV, KVRow, DocLink, Screenshot } from '../ui';
import settingsShot from '../assets/screenshots/settings.png';

export default function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <Lead>The Settings page is where you manage your organization's details, members, and audit history - organized into three tabs.</Lead>

      <Screenshot
        src={settingsShot}
        alt="The Settings page General tab with organization name, timezone, and notification email fields"
        caption="The Settings page - organization details, members, and audit log across three tabs."
      />

      <p>Open <strong>Settings</strong> from the main navigation. You'll find three tabs across the top:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it does</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>General</strong></td><td>Organization name, timezone, and notification email.</td></tr>
            <tr><td><strong>Members</strong></td><td>Invite teammates, change roles, and remove members.</td></tr>
            <tr><td><strong>Audit Log</strong></td><td>A record of meaningful actions in your organization.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>General</h2>
      <p>The General tab holds your organization-level configuration. After editing any field, click <strong>Save Changes</strong> to apply it.</p>

      <KV>
        <KVRow label="Organization Name">The display name for your organization.</KVRow>
        <KVRow label="Timezone">The timezone used across Baton. Defaults to UTC; pick yours from the dropdown so timestamps read correctly.</KVRow>
        <KVRow label="Notification Email">A single email address for admin notices.</KVRow>
      </KV>

      <Callout type="tip" title="Looking for Slack?">Slack channel routing for event notifications lives on the <DocLink to="notifications">Notifications</DocLink> page, under its Slack tab - not here.</Callout>

      <h2>Members</h2>
      <p>The Members tab lists everyone with access to your organization, with their role and when they joined. Owners and admins can invite, change roles, and remove; members and viewers see the list read-only.</p>

      <h3>Roles</h3>
      <p>Each person has one of four roles - <strong>owner</strong> (the first-run setup user), <strong>admin</strong>, <strong>member</strong>, or <strong>viewer</strong>. See <DocLink to="concepts">Core concepts</DocLink> for what each role can do.</p>

      <h3>Inviting someone</h3>
      <p>Click <strong>Invite member</strong>, enter their email, and pick a role (admin, member, or viewer). Baton generates an <strong>invite link</strong> - copy it and share it with them. Opening the link lets them set a password and join your organization. Until they accept, they appear in the list with an <strong>Invited</strong> badge.</p>

      <Callout type="warning" title="Invite links expire in 72 hours">Each invite link stops working 72 hours after it is created. If it expires before your teammate accepts, remove the pending member and send a new invite.</Callout>

      <h3>Changing roles and removing members</h3>
      <ul>
        <li><strong>Change a role</strong> - pick a new role from the dropdown next to the member. It applies immediately.</li>
        <li><strong>Remove a member</strong> - click the trash icon and confirm. They lose access immediately.</li>
        <li><strong>Revoke a pending invite</strong> - removing an invited (not yet accepted) member invalidates their invite link.</li>
      </ul>
      <p>You cannot change your own role or remove yourself.</p>

      <h2>Audit Log</h2>
      <p>The Audit Log - "Recent actions performed in your organization" - records meaningful org actions such as connections added, automations created, secrets rotated, members invited, and role changes, each with who-did-what and a timestamp.</p>
    </>
  );
}

import { Lead, Callout, TableWrap, KV, KVRow, Steps, Step, DocLink, Screenshot } from '../ui';
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

      <p>Open <strong>Settings</strong> from the bottom of the sidebar (<code>/settings</code>). Three tabs run across the top:</p>

      <TableWrap>
        <table>
          <thead>
            <tr><th>Tab</th><th>What it does</th><th>Who can use it</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>General</strong></td><td>Organization name, timezone, and notification email.</td><td>Anyone can view. Only owners and admins can save.</td></tr>
            <tr><td><strong>Members</strong></td><td>Invite teammates, change roles, and remove members.</td><td>Anyone can view the list. Only owners and admins can invite, change roles, or remove.</td></tr>
            <tr><td><strong>Audit Log</strong></td><td>A record of meaningful actions in your organization.</td><td>Owners and admins only.</td></tr>
          </tbody>
        </table>
      </TableWrap>

      <h2>General</h2>
      <p>The General tab holds your organization-level details. Edit a field, then click <strong>Save Changes</strong> - a "Settings saved" toast confirms it. Only owners and admins can save; the save is rejected for members and viewers.</p>

      <KV>
        <KVRow label="Organization Name">The display name for your organization. Set during first-run setup and editable here.</KVRow>
        <KVRow label="Timezone">Stored on the organization record. The dropdown offers UTC, the four US zones, London, and Kyiv. Dates and times in the app are rendered in your browser's local timezone, so changing this does not reformat what you see.</KVRow>
        <KVRow label="Notification Email">A contact address saved on the organization. Alerts are not delivered to it - see below.</KVRow>
      </KV>

      <Callout type="note" title="Alerts are not configured here">
        Nothing is sent to the Notification Email address - it is a contact detail on the organization
        record, not a delivery target. When Baton emails an alert it goes to the individual recipient's own
        sign-in address. Choose which events fire and where they land on the{' '}
        <DocLink to="notifications">Notifications</DocLink> page, under its Preferences and Slack tabs.
      </Callout>

      <h2>Members</h2>
      <p>The Members tab lists everyone in your organization - name, email, role, and how long ago they were added - with a member count in the header and a <strong>(you)</strong> marker on your own row. Owners and admins can invite, change roles, and remove; members and viewers see the list read-only.</p>

      <h3>Roles</h3>
      <p>Each person has one of four roles - <strong>owner</strong> (the first-run setup user), <strong>admin</strong>, <strong>member</strong>, or <strong>viewer</strong>. See <DocLink to="concepts">Core concepts</DocLink> for what each role can do.</p>

      <h3>Inviting someone</h3>
      <Steps>
        <Step title="Open the invite dialog">Click <strong>Invite member</strong> in the Members header.</Step>
        <Step title="Enter an email and pick a role">The role choices here are <strong>admin</strong>, <strong>member</strong>, and <strong>viewer</strong>. Owner is not offered, but you can promote someone once they have joined. An address that already belongs to a member or to a pending invite is rejected.</Step>
        <Step title="Create and share the link">Click <strong>Create invite link</strong>. Baton generates the link and shows it with a copy button - it does not email the invite, so send the link to your teammate yourself.</Step>
        <Step title="They finish signing up">Opening the link asks them for a name and a password of at least 8 characters, then joins them to your organization.</Step>
      </Steps>

      <p>Until they accept, they appear in the list with an <strong>Invited</strong> badge - hover it to see the exact expiry.</p>

      <Callout type="warning" title="Invite links expire in 72 hours">Each invite link stops working 72 hours after it is created. If it expires before your teammate accepts, remove the pending member and send a new invite - re-inviting the same address is rejected while the pending row is still there.</Callout>

      <h3>Changing roles and removing members</h3>
      <ul>
        <li><strong>Change a role</strong> - pick a new role from the dropdown next to the member. It applies immediately. Unlike the invite dialog, this dropdown includes <strong>owner</strong>, so ownership is handed over here.</li>
        <li><strong>Remove a member</strong> - click the trash icon and confirm. They lose access immediately. Baton refuses to remove the last remaining owner.</li>
        <li><strong>Revoke a pending invite</strong> - the same trash icon on an invited member opens a <strong>Revoke invite</strong> confirmation, and their link stops working.</li>
      </ul>
      <p>You cannot change your own role or remove yourself.</p>

      <h2>Audit Log</h2>
      <p>The Audit Log - "Recent actions performed in your organization" - is the 50 most recent org actions, newest first. Each line names the action and the kind of resource it touched, with a relative timestamp; hover the timestamp for the exact date and time. There is no search or filtering - it is a plain reverse-chronological feed, and only owners and admins can open it.</p>

      <p>These are the actions Baton records:</p>

      <KV>
        <KVRow label="Connections">Created, deleted, tested, refreshed, and webhook secret rotations.</KVRow>
        <KVRow label="Platforms">Installed, removed, and secret updates.</KVRow>
        <KVRow label="Automations">Created, updated, deleted, paused, and resumed.</KVRow>
        <KVRow label="Workflows">Created, updated, synced, launched, and deleted.</KVRow>
        <KVRow label="Bulk Upload">File uploads, run starts, and run cancellations.</KVRow>
        <KVRow label="Custom webhooks">Endpoints created, updated, and deleted.</KVRow>
      </KV>

      <Callout type="note" title="Member changes are not in the Audit Log">
        Invites, role changes, member removals, and edits to the General tab go to the server logs rather than
        to this feed. If you need a record of who changed what in Settings, read it from your Baton API logs.
      </Callout>
    </>
  );
}

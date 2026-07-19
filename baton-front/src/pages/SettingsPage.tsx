/**
 * Settings Page — Baton
 * Organization settings, members, audit log
 */
import { useState, useEffect } from 'react';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Settings,
  Shield,
  Users,
  Save,
  Loader2,
  Check,
  UserPlus,
  Trash2,
  Copy,
} from 'lucide-react';
import clsx from 'clsx';
import { timeAgo, formatDateFull } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';

type Tab = 'general' | 'members' | 'audit';


export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'audit', label: 'Audit Log', icon: Shield },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto max-w-full">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              tab === id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'general' && <GeneralSettings />}
      {tab === 'members' && <MembersSettings />}
      {tab === 'audit' && <AuditLog />}
    </div>
  );
}

// ─── General Settings ────────────────────────────────────────

interface OrgSettings { name: string; timezone: string; notificationEmail: string; }

function GeneralSettings() {
  const { data, isLoading } = useSWR<{ organization: OrgSettings }>('/settings/org', fetcher);
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OrgSettings>({ name: '', timezone: 'UTC', notificationEmail: '' });

  useEffect(() => {
    if (data?.organization) {
      const org = data.organization;
      setForm({
        name: org.name || '',
        timezone: org.timezone || 'UTC',
        notificationEmail: org.notificationEmail || '',
      });
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch('/settings/org', form);
      toast.success('Settings saved');
      mutate('/settings/org');
    } catch {
      // error shown by global handler
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-5">
      <Field label="Organization Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <Field
        label="Timezone"
        value={form.timezone}
        onChange={(v) => setForm({ ...form, timezone: v })}
        type="select"
        options={['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Kyiv']}
      />
      <Field
        label="Notification Email"
        value={form.notificationEmail}
        onChange={(v) => setForm({ ...form, notificationEmail: v })}
        placeholder="alerts@yourcompany.com"
      />
      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

// ─── Members ─────────────────────────────────────────────────

interface Member {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  role: string;
  status: 'active' | 'invited';
  inviteExpiresAt?: string;
  createdAt: string;
  lastActiveAt?: string;
}

const ROLE_OPTIONS = ['owner', 'admin', 'member', 'viewer'] as const;
const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;

function MembersSettings() {
  const { user: currentUser } = useAuth();
  const { data, isLoading } = useSWR<{ members: Member[]; total: number }>('/settings/members', fetcher);
  const { mutate } = useSWRConfig();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);

  const members = data?.members ?? [];
  const count = data?.total ?? members.length;
  const canManage = ['owner', 'admin', 'superuser'].includes(currentUser?.role ?? '');

  async function changeRole(member: Member, role: string) {
    setRoleSavingId(member.id);
    try {
      await api.patch(`/settings/members/${member.id}/role`, { role });
      toast.success('Role updated');
      mutate('/settings/members');
    } catch {
      // error shown by global handler
    } finally {
      setRoleSavingId(null);
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`/settings/members/${removeTarget.id}`);
      toast.success(removeTarget.status === 'invited' ? 'Invite revoked' : 'Member removed');
      setRemoveTarget(null);
      mutate('/settings/members');
    } catch {
      // error shown by global handler
    } finally {
      setRemoving(false);
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-4xl">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Members</h3>
          <p className="text-xs text-gray-500 mt-0.5">People with access to this organization.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full whitespace-nowrap">
            {count} member{count !== 1 ? 's' : ''}
          </span>
          {canManage && (
            <button
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-xs font-semibold rounded-lg hover:bg-brand-700 whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Invite member
            </button>
          )}
        </div>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-gray-500 px-6 py-8 text-center">No members found.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {members.map((m) => {
            const displayName =
              m.fullName || [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
            const initials =
              [m.firstName?.[0], m.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
              m.email[0]?.toUpperCase() ||
              '?';
            const isSelf = m.id === currentUser?.id;
            return (
              <div key={m.id} className="flex items-center gap-4 px-6 py-3.5">
                <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {displayName}
                    {isSelf && <span className="text-xs text-gray-400 font-normal ml-1.5">(you)</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                {m.status === 'invited' && (
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 bg-amber-50 text-amber-700 border border-amber-200"
                    title={m.inviteExpiresAt ? `Invite expires ${formatDateFull(m.inviteExpiresAt)}` : undefined}
                  >
                    Invited
                  </span>
                )}
                {canManage && !isSelf ? (
                  <select
                    value={m.role}
                    disabled={roleSavingId === m.id}
                    onChange={(e) => changeRole(m, e.target.value)}
                    className="text-xs font-medium px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 shrink-0 capitalize"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={clsx(
                      'text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 capitalize',
                      m.role === 'owner' || m.role === 'admin'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-gray-100 text-gray-600',
                    )}
                  >
                    {m.role}
                  </span>
                )}
                <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">
                  {timeAgo(m.createdAt)}
                </span>
                {canManage && !isSelf && (
                  <button
                    onClick={() => setRemoveTarget(m)}
                    aria-label={`Remove ${displayName}`}
                    title="Remove member"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          mutate('/settings/members');
        }}
      />

      {/* Remove confirmation */}
      <Modal
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title={removeTarget?.status === 'invited' ? 'Revoke invite' : 'Remove member'}
      >
        <p className="text-sm text-gray-600">
          {removeTarget?.status === 'invited'
            ? `Revoke the pending invite for ${removeTarget?.email}? The invite link will stop working.`
            : `Remove ${removeTarget?.fullName || removeTarget?.email} from this organization? They will lose access immediately.`}
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => setRemoveTarget(null)}
            className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={removeMember}
            disabled={removing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {removing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {removeTarget?.status === 'invited' ? 'Revoke invite' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function InviteMemberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('member');
  const [sending, setSending] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail('');
    setRole('member');
    setInviteUrl(null);
    setCopied(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const res = await api.post<{ inviteUrl: string }>('/settings/members/invites', { email, role });
      setInviteUrl(res.inviteUrl);
    } catch {
      // error shown by global handler (e.g. duplicate email 409)
    } finally {
      setSending(false);
    }
  }

  async function copyUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Invite link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy manually');
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Invite member">
      {inviteUrl ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this link with <strong className="text-gray-900">{email}</strong> — opening
            it lets them set a password and join your organization.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-gray-50 text-gray-700 outline-none"
            />
            <button
              onClick={copyUrl}
              aria-label="Copy invite link"
              title="Copy invite link"
              className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 shrink-0"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            This link expires in 72 hours. To re-invite after that, remove the
            pending member and send a new invite.
          </p>
          <button
            onClick={handleClose}
            className="w-full text-sm font-semibold py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={sendInvite} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700 mb-1.5">
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-brand-500 capitalize"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {sending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create invite link
          </button>
        </form>
      )}
    </Modal>
  );
}

// ─── Audit Log ───────────────────────────────────────────────

interface AuditEntry { id: string; action: string; entityType: string; userId?: string; createdAt: string; metadata?: Record<string, unknown>; }

function AuditLog() {
  const { data, isLoading } = useSWR<{ auditLog: AuditEntry[] }>('/settings/audit', fetcher);

  const entries = data?.auditLog || [];

  if (isLoading) return <SettingsSkeleton />;

  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-4xl">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Audit Log</h3>
        <p className="text-xs text-gray-500 mt-0.5">Recent actions performed in your organization.</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 px-6 py-8 text-center">No audit entries yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-4 px-6 py-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">
                  <span className="font-medium">{entry.action}</span>{' '}
                  <span className="text-gray-500">on {entry.entityType}</span>
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap" title={formatDateFull(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'select';
  options?: string[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {type === 'select' && options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-brand-500"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-500"
        />
      )}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl animate-pulse">
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-10 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}


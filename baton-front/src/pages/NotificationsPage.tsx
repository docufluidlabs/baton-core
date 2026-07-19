/**
 * Notifications Page — Baton
 *
 * Two tabs:
 *  1. Inbox     — in-app notification list with mark-read / dismiss
 *  2. Slack     — per-org Slack Bot channel routing configuration
 *
 * User actions that flow to Slack automatically (via the backend notification
 * pipeline) based on severity:
 *   error   → in-app + email + Slack
 *   warning → in-app + email
 *   success → in-app only  (unless Slack routing configured for it)
 *   info    → in-app only
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher, api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'sonner';
import {
  Bell, Check, CheckCheck, X, AlertTriangle, XCircle,
  Info, CheckCircle, Settings, Loader2, Hash, Send,
  ToggleLeft, ToggleRight, AlertCircle, Link2Off,
  ChevronDown, Search, Lock,
} from 'lucide-react';
import clsx from 'clsx';
import { timeAgo } from '@/lib/utils';
import type { Notification } from '@/hooks/useApi';
import {
  useSlackConfig,
  useSlackChannels,
  updateSlackConfig,
  testSlackNotification,
  installSlackApp,
  disconnectSlack,
  type SlackChannelRouting,
  type SlackChannel,
  useNotificationPreferences,
  updateNotificationPreferences,
  DEFAULT_EVENT_PREFS,
  type EventChannelPrefs,
  type NotifChannel,
} from '@/hooks/useApi';

// ─── Page ────────────────────────────────────────────────────

type Tab = 'inbox' | 'preferences' | 'slack';

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('preferences');

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure how and when you receive alerts.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <TabButton active={tab === 'slack'} onClick={() => setTab('slack')}>
          <SlackIcon /> Slack
        </TabButton>
        <TabButton active={tab === 'preferences'} onClick={() => setTab('preferences')}>
          <Settings className="w-4 h-4" /> Preferences
        </TabButton>
        <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>
          <Bell className="w-4 h-4" /> Inbox
        </TabButton>
      </div>

      {tab === 'inbox' && <InboxTab />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'slack' && <SlackTab />}
    </div>
  );
}

// ─── Tab button ──────────────────────────────────────────────

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

// ─── Inbox tab ───────────────────────────────────────────────

const SEVERITY_FILTERS = [
  { value: '',        label: 'All' },
  { value: 'error',   label: 'Error',   color: 'bg-red-50 text-red-700 border-red-300',     dot: 'bg-red-500' },
  { value: 'warning', label: 'Warning', color: 'bg-yellow-50 text-yellow-700 border-yellow-300', dot: 'bg-yellow-500' },
  { value: 'success', label: 'Success', color: 'bg-green-50 text-green-700 border-green-300', dot: 'bg-green-500' },
  { value: 'info',    label: 'Info',    color: 'bg-blue-50 text-blue-700 border-blue-300',   dot: 'bg-blue-500' },
];

function getDateGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= weekAgo) return 'This Week';
  return 'Earlier';
}

function InboxTab() {
  const { data, isLoading } = useSWR<{ notifications: Notification[]; unreadCount: number }>(
    '/notifications',
    fetcher,
    { refreshInterval: 15_000 },
  );
  const { mutate: globalMutate } = useSWRConfig();

  /** Revalidate all /notifications* keys so the header badge stays in sync */
  function revalidateAll() {
    globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/notifications'));
  }

  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const notifications = (data?.notifications || []).filter((n) => !n.dismissedAt);
  const unreadCount = data?.unreadCount || 0;

  // Available categories from data
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const n of notifications) if (n.category) set.add(n.category);
    return Array.from(set).sort();
  }, [notifications]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = notifications;
    if (severityFilter) list = list.filter((n) => n.severity === severityFilter);
    if (categoryFilter) list = list.filter((n) => n.category === categoryFilter);
    return list;
  }, [notifications, severityFilter, categoryFilter]);

  // Group by date
  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of filtered) {
      const group = getDateGroup(n.createdAt);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(n);
    }
    return map;
  }, [filtered]);

  const hasActiveFilter = severityFilter || categoryFilter;

  async function markRead(id: string) {
    try { await api.patch(`/notifications/${id}/read`); revalidateAll(); }
    catch { toast.error('Failed to mark as read'); }
  }

  async function dismiss(id: string) {
    try { await api.patch(`/notifications/${id}/dismiss`); revalidateAll(); }
    catch { toast.error('Failed to dismiss notification'); }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      toast.success('All marked as read');
      revalidateAll();
    } catch { toast.error('Failed to mark all as read'); }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <Badge variant="red">{unreadCount} unread</Badge>}
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button variant="secondary" size="sm" icon={<CheckCheck className="w-4 h-4" />} onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Severity</span>
        <div className="flex items-center gap-2 flex-wrap">
          {SEVERITY_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSeverityFilter(severityFilter === s.value ? null : (s.value || null))}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                severityFilter === (s.value || null)
                  ? s.value
                    ? (s.color || 'bg-gray-100 text-gray-700 border-gray-300')
                    : 'bg-brand-50 text-brand-700 border-brand-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
              )}
            >
              {s.dot && <span className={clsx('w-1.5 h-1.5 rounded-full', s.dot)} />}
              {s.label}
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Category</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCategoryFilter(null)}
                className={clsx(
                  'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  !categoryFilter
                    ? 'bg-brand-50 text-brand-700 border-brand-200'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                  className={clsx(
                    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                    categoryFilter === c
                      ? 'bg-gray-100 text-gray-700 border-gray-300'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
              {hasActiveFilter && (
                <button
                  onClick={() => { setSeverityFilter(null); setCategoryFilter(null); }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Bell className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {hasActiveFilter ? 'No notifications match filters' : 'No notifications'}
          </p>
        </Card>
      ) : (
        <div className="space-y-1">
          {Array.from(groups.entries()).map(([label, items]) => (
            <div key={label}>
              <div className="sticky top-0 z-10 bg-gray-50/80 backdrop-blur-sm px-1 py-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
              </div>
              <div className="space-y-2">
                {items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onRead={() => markRead(n.id)}
                    onDismiss={() => dismiss(n.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification: n, onRead, onDismiss,
}: { notification: Notification; onRead: () => void; onDismiss: () => void }) {
  return (
    <div className={clsx(
      'bg-white rounded-xl border p-4 flex items-start gap-3 transition-colors',
      n.readAt ? 'border-gray-200' : 'border-brand-200 bg-brand-50/30',
    )}>
      <SeverityIcon severity={n.severity} />
      <div className="flex-1 min-w-0">
        <p className={clsx('text-sm', n.readAt ? 'text-gray-700' : 'font-medium text-gray-900')}>
          {n.title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-gray-400">{timeAgo(n.createdAt)}</span>
          {n.actionUrl && (
            <a href={n.actionUrl} className="text-[10px] text-brand-600 hover:underline">
              View details →
            </a>
          )}
          {n.category && (
            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
              {n.category}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        {!n.readAt && (
          <button onClick={onRead} className="p-1.5 rounded-lg hover:bg-gray-100" title="Mark read">
            <Check className="w-4 h-4 text-gray-400" />
          </button>
        )}
        <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-gray-100" title="Dismiss">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
    </div>
  );
}

// ─── Preferences tab (event × channel matrix) ───────────────

const EVENT_META: Array<{ key: string; label: string; emoji: string; desc: string }> = [
  { key: 'workflow_failed',     label: 'Workflow Failed',            emoji: '🔴', desc: 'A workflow instance crashes or errors out' },
  { key: 'workflow_completed',  label: 'Workflow Completed',         emoji: '🟢', desc: 'A workflow instance finishes successfully' },
  { key: 'workflow_launched',   label: 'Workflow Launched',          emoji: '🔵', desc: 'A new workflow instance starts running' },
  { key: 'automation_failed',   label: 'Automation Failed',          emoji: '🔴', desc: 'All retry attempts exhausted - needs manual action' },
  { key: 'connection_degraded', label: 'Connection Degraded',        emoji: '🔴', desc: 'Platform connection down - blocks all API requests' },
  { key: 'webhook_failed',     label: 'Webhook Failed',             emoji: '🟡', desc: 'Incoming webhook HMAC signature rejected' },
];

const CHANNELS: Array<{ key: NotifChannel; label: string; icon: React.ReactNode }> = [
  { key: 'inApp',  label: 'In-App', icon: <Bell className="w-4 h-4" /> },
  // { key: 'email',  label: 'Email',  icon: <Send className="w-4 h-4" /> },
];

function PreferencesTab() {
  const { data, isLoading, mutate } = useNotificationPreferences();
  const [local, setLocal] = useState<Record<string, EventChannelPrefs> | null>(null);
  const [saving, setSaving] = useState(false);

  const serverEvents = data?.preferences?.events || DEFAULT_EVENT_PREFS;
  const events = local ?? serverEvents;

  const isDirty = local !== null && JSON.stringify(local) !== JSON.stringify(serverEvents);

  function toggle(eventKey: string, channel: NotifChannel) {
    setLocal((prev) => {
      const base = prev ?? { ...serverEvents };
      const current = base[eventKey] ?? DEFAULT_EVENT_PREFS[eventKey] ?? { inApp: true, email: false };
      return {
        ...base,
        [eventKey]: { ...current, [channel]: !current[channel] },
      };
    });
  }

  function toggleAllChannel(channel: NotifChannel) {
    const allOn = EVENT_META.every(({ key }) => (events[key] ?? DEFAULT_EVENT_PREFS[key])?.[channel]);
    setLocal(() => {
      const base = { ...events };
      for (const { key } of EVENT_META) {
        const current = base[key] ?? DEFAULT_EVENT_PREFS[key] ?? { inApp: true, email: false };
        base[key] = { ...current, [channel]: !allOn };
      }
      return base;
    });
  }

  async function handleSave() {
    if (!local) return;
    setSaving(true);
    try {
      await updateNotificationPreferences({ events: local });
      toast.success('Notification preferences saved');
      setLocal(null);
      mutate();
    } catch {
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLocal(null);
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Event Preferences</h3>
          <p className="text-xs text-gray-500 mt-1">
            Choose which channels receive each type of notification. Slack delivery
            is configured separately under <strong>Slack → Channel Routing</strong>.
          </p>
        </div>

        {/* Matrix header */}
        <div className="grid grid-cols-[1fr_100px] gap-0 border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
            Event
          </div>
          {CHANNELS.map(({ key, label, icon }) => {
            const allOn = EVENT_META.every(({ key: ek }) => (events[ek] ?? DEFAULT_EVENT_PREFS[ek])?.[key]);
            return (
              <button
                key={key}
                onClick={() => toggleAllChannel(key)}
                className="bg-gray-50 px-2 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-l border-gray-200 flex items-center justify-center gap-1.5 hover:bg-gray-100 transition-colors"
                title={`Toggle all ${label}`}
              >
                {icon}
                <span className={clsx(allOn && 'text-brand-600')}>{label}</span>
              </button>
            );
          })}

          {/* Event rows */}
          {EVENT_META.map(({ key: eventKey, label, emoji, desc }, idx) => {
            const prefs = events[eventKey] ?? DEFAULT_EVENT_PREFS[eventKey] ?? { inApp: true, email: false };
            const isLast = idx === EVENT_META.length - 1;
            return (
              <div key={eventKey} className="contents">
                <div className={clsx('px-4 py-3 flex items-start gap-2', !isLast && 'border-b border-gray-100')}>
                  <span className="text-sm">{emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
                {CHANNELS.map(({ key: chKey }) => (
                  <div
                    key={chKey}
                    className={clsx(
                      'flex items-center justify-center border-l border-gray-200',
                      !isLast && 'border-b border-gray-100',
                    )}
                  >
                    <button
                      onClick={() => toggle(eventKey, chKey)}
                      className="p-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      {prefs[chKey]
                        ? <ToggleRight className="w-7 h-5 text-brand-500" />
                        : <ToggleLeft  className="w-7 h-5 text-gray-300" />}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={!isDirty || saving}
        >
          Save Preferences
        </Button>
        {isDirty && (
          <>
            <Button variant="secondary" onClick={handleReset}>
              Discard
            </Button>
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Unsaved changes
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Add to Slack button (official Slack brand guidelines) ───

function AddToSlackButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-60"
      style={{ backgroundColor: '#4A154B' }}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <SlackIcon size={18} color="#fff" />
      )}
      Add to Slack
    </button>
  );
}

// ─── Slack tab ───────────────────────────────────────────────

const EVENT_TYPES: Array<{ key: keyof SlackChannelRouting; label: string; severity: string; emoji: string }> = [
  { key: 'workflow_failed',          label: 'Workflow Failed',              severity: 'error',   emoji: '🔴' },
  { key: 'workflow_completed',       label: 'Workflow Completed',           severity: 'success', emoji: '🟢' },
  { key: 'workflow_launched',        label: 'Workflow Launched',            severity: 'info',    emoji: '🔵' },
  { key: 'automation_failed',        label: 'Automation Failed',            severity: 'error',   emoji: '🔴' },
  { key: 'connection_degraded',      label: 'Connection Degraded',          severity: 'error',   emoji: '🔴' },
  { key: 'webhook_failed',          label: 'Webhook Failed',               severity: 'warning', emoji: '🟡' },
];

function SlackTab() {
  const { data, isLoading, mutate } = useSlackConfig();
  const isConnected_early = data?.connected ?? false;
  const { data: channelsData, isLoading: channelsLoading } = useSlackChannels(isConnected_early);
  const slackChannels: SlackChannel[] = channelsData?.channels ?? [];
  const channelProps = { channels: slackChannels, loading: channelsLoading };
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [routing, setRouting] = useState<SlackChannelRouting | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Show toast on return from Slack OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack_connected')) {
      toast.success('Slack workspace connected!');
      window.history.replaceState({}, '', window.location.pathname);
      mutate();
    } else if (params.get('slack_error')) {
      toast.error(`Slack connection failed: ${params.get('slack_error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const serverEnabled = data?.config.enabled ?? false;
  const serverRouting: SlackChannelRouting = data?.config.channelRouting ?? { default: '' };
  const isConnected   = data?.connected ?? false;
  const teamName      = data?.teamName;
  const tokenOk       = isConnected;

  const localEnabled = enabled ?? serverEnabled;
  const localRouting = routing ?? serverRouting;

  const isDirty =
    (enabled !== null && enabled !== serverEnabled) ||
    (routing !== null && JSON.stringify(routing) !== JSON.stringify(serverRouting));

  function setChannel(key: keyof SlackChannelRouting, value: string | null | undefined) {
    setRouting((prev) => {
      const base: SlackChannelRouting = { ...(prev ?? serverRouting) };
      // For non-default rows, `undefined` means "use default" — strip the field.
      if (value === undefined && key !== 'default') {
        delete (base as any)[key];
      } else {
        // For default, undefined collapses to empty string (legacy default-empty shape).
        (base as any)[key] = key === 'default' && value === undefined ? '' : value;
      }
      return base;
    });
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      await installSlackApp(); // navigates away — no finally needed
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start Slack connection');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectSlack();
      toast.success('Slack workspace disconnected');
      mutate();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateSlackConfig({ enabled: localEnabled, channelRouting: localRouting });
      toast.success('Slack settings saved');
      setEnabled(null);
      setRouting(null);
      mutate();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testSlackNotification();
      toast.success(res.message || 'Test message sent!');
    } catch (err: any) {
      toast.error(err?.message || 'Test failed - check bot token and channel');
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-5">

      {/* Workspace connection card */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              isConnected ? 'bg-green-50' : 'bg-gray-100',
            )}>
              <SlackIcon size={20} color={isConnected ? '#16a34a' : '#9ca3af'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {isConnected ? `Connected to ${teamName ?? 'Slack'}` : 'Connect your Slack workspace'}
              </p>
              <p className="text-xs text-gray-500">
                {isConnected
                  ? 'Baton bot is installed and can send notifications'
                  : 'Install the Baton bot in your company Slack workspace'}
              </p>
            </div>
          </div>

          {isConnected ? (
            <Button
              variant="secondary"
              onClick={handleDisconnect}
              loading={disconnecting}
              icon={<Link2Off className="w-4 h-4" />}
            >
              Disconnect
            </Button>
          ) : (
            <AddToSlackButton onClick={handleConnect} loading={connecting} />
          )}
        </div>

        {!isConnected && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Click <strong>Add to Slack</strong> above to install the bot in your workspace and enable notifications.</span>
          </div>
        )}
      </Card>

      {/* Enable toggle + channel routing — only shown once a token is available */}
      {tokenOk && (
        <>
          {/* Enable toggle */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Slack Notifications</p>
                <p className="text-xs text-gray-500">
                  {localEnabled ? 'Sending alerts to Slack' : 'Alerts are paused'}
                </p>
              </div>
              <button onClick={() => setEnabled(!localEnabled)}>
                {localEnabled
                  ? <ToggleRight className="w-10 h-6 text-green-500" />
                  : <ToggleLeft  className="w-10 h-6 text-gray-300" />}
              </button>
            </div>
          </Card>

          {/* Channel routing */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Channel Routing</h3>
            <p className="text-xs text-gray-500 mb-4">
              Pick a channel for each event, fall back to the default, or choose
              <strong> Don&apos;t send </strong> to suppress that event entirely.
            </p>

            <div className="space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <div className="w-40 shrink-0">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Default</span>
                  <p className="text-[10px] text-gray-400">All unrouted events</p>
                </div>
                <ChannelSelect
                  {...channelProps}
                  value={localRouting.default}
                  onChange={(v) => setChannel('default', v)}
                  placeholder="#baton-alerts"
                  // Default has no parent fallback — only "channel" or "don't send".
                  allowFallback={false}
                />
              </div>

              {EVENT_TYPES.map(({ key, label, emoji }) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <span className="text-xs text-gray-700 flex items-center gap-1.5">
                      {emoji} {label}
                    </span>
                  </div>
                  <ChannelSelect
                    {...channelProps}
                    value={(localRouting as any)[key]}
                    onChange={(v) => setChannel(key, v)}
                    placeholder={
                      localRouting.default === null
                        ? "default (don't send)"
                        : `default (${localRouting.default || '#baton-alerts'})`
                    }
                    allowFallback
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} loading={saving} disabled={!isDirty || saving}>
              Save Settings
            </Button>
            <Button
              variant="secondary"
              onClick={handleTest}
              loading={testing}
              disabled={testing}
              icon={<Send className="w-4 h-4" />}
            >
              Send Test Message
            </Button>
            {isDirty && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Unsaved changes
              </span>
            )}
          </div>
        </>
      )}

    </div>
  );
}

// ─── Channel select ──────────────────────────────────────────

/**
 * Tristate channel picker.
 *   string         → send to that channel
 *   null           → "Don't send" (suppress this event)
 *   undefined / '' → fall back to default (only when allowFallback)
 */
function ChannelSelect({
  value, onChange, placeholder, channels, loading, allowFallback = true,
}: {
  value: string | null | undefined;
  onChange: (v: string | null | undefined) => void;
  placeholder: string;
  channels: SlackChannel[];
  loading?: boolean;
  allowFallback?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const isDisabled = value === null;
  const channelName = typeof value === 'string' && value ? value.replace(/^#/, '') : '';
  const filtered = channels.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  // No channels loaded yet — fall back to plain text input + Don't-send toggle.
  if (!loading && channels.length === 0) {
    return (
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 relative">
          <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={channelName}
            disabled={isDisabled}
            onChange={(e) => onChange(e.target.value ? `#${e.target.value.replace(/^#/, '')}` : (allowFallback ? undefined : ''))}
            placeholder={isDisabled ? "Don't send" : placeholder.replace(/^#/, '')}
            className={clsx(
              'w-full pl-7 pr-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none',
              isDisabled ? 'border-gray-200 bg-gray-50 text-gray-400 italic' : 'border-gray-200',
            )}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(isDisabled ? (allowFallback ? undefined : '') : null)}
          className={clsx(
            'px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors shrink-0',
            isDisabled
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50',
          )}
          title={isDisabled ? 'Re-enable' : "Don't send"}
        >
          {isDisabled ? 'Disabled' : "Don't send"}
        </button>
      </div>
    );
  }

  const isChannelSelected = !!channelName;
  const triggerLabel = isDisabled
    ? "Don't send"
    : isChannelSelected
      ? channelName
      : placeholder.replace(/^#/, '');

  return (
    <div className="flex-1 relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(''); }}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-[7px] text-sm rounded-lg border outline-none transition-all',
          open
            ? 'border-brand-400 ring-2 ring-brand-100 bg-white'
            : isDisabled
              ? 'border-red-200 bg-red-50/60 hover:border-red-300'
              : 'border-gray-200 bg-white hover:border-gray-300',
        )}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin shrink-0" />
        ) : isDisabled ? (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 text-red-600 shrink-0">
            <X className="w-3 h-3" />
          </span>
        ) : (
          <span className={clsx(
            'inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold shrink-0',
            isChannelSelected ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-400',
          )}>#</span>
        )}
        <span className={clsx(
          'flex-1 truncate text-left',
          isDisabled
            ? 'text-red-700 font-medium'
            : isChannelSelected
              ? 'text-gray-900 font-medium'
              : 'text-gray-400',
        )}>
          {triggerLabel}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {(isChannelSelected || isDisabled) && allowFallback && (
            <span
              role="button"
              title="Use default"
              className="p-0.5 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
              onMouseDown={(e) => { e.stopPropagation(); onChange(undefined); }}
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50/60">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-gray-400"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-gray-300 hover:text-gray-500">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Special options */}
          {!search && (
            <div className="border-b border-gray-100 py-1">
              {allowFallback && (
                <button
                  type="button"
                  onClick={() => { onChange(undefined); setOpen(false); }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                    !isChannelSelected && !isDisabled ? 'bg-brand-50' : 'hover:bg-gray-50',
                  )}
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-100 text-gray-400 shrink-0">
                    <ChevronDown className="w-3 h-3" />
                  </span>
                  <span className={clsx(
                    'flex-1 truncate text-gray-600 italic',
                    !isChannelSelected && !isDisabled && 'font-medium text-brand-700 not-italic',
                  )}>
                    Use default
                  </span>
                  {!isChannelSelected && !isDisabled && <Check className="w-3.5 h-3.5 text-brand-500 shrink-0" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                  isDisabled ? 'bg-red-50' : 'hover:bg-gray-50',
                )}
              >
                <span className={clsx(
                  'inline-flex items-center justify-center w-5 h-5 rounded shrink-0',
                  isDisabled ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400',
                )}>
                  <X className="w-3 h-3" />
                </span>
                <span className={clsx(
                  'flex-1 truncate',
                  isDisabled ? 'font-medium text-red-700' : 'text-gray-600',
                )}>
                  Don&apos;t send
                </span>
                {isDisabled && <Check className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              </button>
            </div>
          )}

          {/* List */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400 text-center">No channels found</p>
            ) : filtered.map((ch) => {
              const active = value === `#${ch.name}`;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => { onChange(`#${ch.name}`); setOpen(false); }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
                    active ? 'bg-brand-50' : 'hover:bg-gray-50',
                  )}
                >
                  <span className={clsx(
                    'inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold shrink-0',
                    active ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-400',
                  )}>#</span>
                  <span className={clsx('flex-1 truncate', active ? 'font-medium text-brand-700' : 'text-gray-700')}>
                    {ch.name}
                  </span>
                  {ch.is_private && (
                    <Lock className="w-3 h-3 text-gray-300 shrink-0" />
                  )}
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                    {ch.num_members}
                  </span>
                  {active && <Check className="w-3.5 h-3.5 text-brand-500 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/60">
            <p className="text-[10px] text-gray-400">{filtered.length} channel{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Severity icon ───────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'error':   return <XCircle       className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />;
    case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />;
    case 'success': return <CheckCircle   className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />;
    default:        return <Info          className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />;
  }
}

// ─── Slack brand icon (SVG) ───────────────────────────────────

function SlackIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.687 8.834a2.528 2.528 0 0 1-2.521 2.521 2.527 2.527 0 0 1-2.521-2.521V2.522A2.527 2.527 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zM15.166 18.956a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.166 24a2.527 2.527 0 0 1-2.521-2.522v-2.522h2.521zM15.166 17.687a2.527 2.527 0 0 1-2.521-2.521 2.526 2.526 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z" fill={color}/>
    </svg>
  );
}

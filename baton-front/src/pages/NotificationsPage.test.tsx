import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────────

const mockUseSWR = vi.fn();
const mockGlobalMutate = vi.fn();
vi.mock('swr', () => ({
  default: (...args: any[]) => mockUseSWR(...args),
  useSWRConfig: () => ({ mutate: mockGlobalMutate }),
}));

vi.mock('@/lib/api', () => ({
  fetcher: vi.fn(),
  api: {
    patch: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/utils', () => ({
  timeAgo: () => '2 min ago',
}));

const mockUseSlackConfig = vi.fn();
const mockUpdateSlackConfig = vi.fn();
const mockTestSlackNotification = vi.fn();
const mockUseNotificationPreferences = vi.fn();
const mockUpdateNotificationPreferences = vi.fn();

vi.mock('@/hooks/useApi', () => ({
  useSlackConfig: () => mockUseSlackConfig(),
  useSlackChannels: () => ({ data: { channels: [] }, isLoading: false }),
  updateSlackConfig: (...args: any[]) => mockUpdateSlackConfig(...args),
  testSlackNotification: () => mockTestSlackNotification(),
  installSlackApp: vi.fn(),
  disconnectSlack: vi.fn(),
  useNotificationPreferences: () => mockUseNotificationPreferences(),
  updateNotificationPreferences: (...args: any[]) => mockUpdateNotificationPreferences(...args),
  DEFAULT_EVENT_PREFS: {
    workflow_failed:           { inApp: true,  email: true  },
    workflow_completed:        { inApp: true,  email: false },
    workflow_launched:         { inApp: true,  email: false },
    workflow_synced:           { inApp: true,  email: false },
    retry_exhausted:           { inApp: true,  email: true  },
    rule_error:                { inApp: true,  email: true  },
    webhook_failed:            { inApp: true,  email: true  },
    connection_degraded:       { inApp: true,  email: true  },
    connection_created:        { inApp: true,  email: false },
    connection_disconnected:   { inApp: true,  email: true  },
  },
}));

// ─── Import after mocks ─────────────────────────────────────

import NotificationsPage from './NotificationsPage';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ─── Helpers ────────────────────────────────────────────────

function makeNotification(overrides: any = {}) {
  return {
    id: 'n1',
    title: 'Test Alert',
    message: 'Something happened',
    severity: 'info',
    eventType: 'workflow_launched',
    category: 'workflow_launched',
    readAt: null,
    dismissedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupInboxSWR(notifications: any[] = [], unreadCount?: number) {
  mockUseSWR.mockReturnValue({
    data: {
      notifications,
      unreadCount: unreadCount ?? notifications.filter((n: any) => !n.readAt).length,
    },
    isLoading: false,
    mutate: vi.fn(),
  });
}

function setupPreferences(events?: any) {
  mockUseNotificationPreferences.mockReturnValue({
    data: { preferences: { events: events || {} } },
    isLoading: false,
    mutate: vi.fn(),
  });
}

function setupSlackConfig(config?: any, connected = true) {
  mockUseSlackConfig.mockReturnValue({
    data: {
      config: config || { orgId: 'org-1', enabled: false, channelRouting: { default: '' } },
      connected,
    },
    isLoading: false,
    mutate: vi.fn(),
  });
}

beforeEach(() => {
  mockUseSWR.mockReset();
  mockUseSlackConfig.mockReset();
  mockUseNotificationPreferences.mockReset();
  mockUpdateSlackConfig.mockReset();
  mockTestSlackNotification.mockReset();
  mockUpdateNotificationPreferences.mockReset();

  // Default setup for all tabs
  setupInboxSWR([]);
  setupPreferences();
  setupSlackConfig();
});

// ── Tab navigation ──────────────────────────────────────────

describe('tab navigation', () => {
  it('defaults to Preferences tab', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('Event Preferences')).toBeInTheDocument();
  });

  it('switches to Inbox tab when clicked', () => {
    render(<NotificationsPage />);
    fireEvent.click(screen.getByText('Inbox'));
    // Inbox tab shows filters
    expect(screen.getByText('Severity')).toBeInTheDocument();
  });

  it('switches to Slack tab when clicked', () => {
    render(<NotificationsPage />);
    // "Slack" appears both as tab button and as column header in Preferences
    const slackButtons = screen.getAllByText('Slack');
    fireEvent.click(slackButtons[0]);
    expect(screen.getByText('Channel Routing')).toBeInTheDocument();
  });
});

// ── InboxTab ────────────────────────────────────────────────

describe('InboxTab', () => {
  function openInbox() {
    render(<NotificationsPage />);
    fireEvent.click(screen.getByText('Inbox'));
  }

  it('shows "No notifications" when list is empty', () => {
    setupInboxSWR([]);
    openInbox();
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('renders notification titles and messages', () => {
    setupInboxSWR([makeNotification({ title: 'Deploy Failed', message: 'Error in step 3' })]);
    openInbox();
    expect(screen.getByText('Deploy Failed')).toBeInTheDocument();
    expect(screen.getByText('Error in step 3')).toBeInTheDocument();
  });

  it('filters out dismissed notifications', () => {
    setupInboxSWR([
      makeNotification({ id: 'n1', title: 'Visible' }),
      makeNotification({ id: 'n2', title: 'Dismissed', dismissedAt: '2024-01-01' }),
    ]);
    openInbox();
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.queryByText('Dismissed')).not.toBeInTheDocument();
  });

  it('shows severity filter chips', () => {
    setupInboxSWR([makeNotification()]);
    openInbox();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('clicking severity filter shows only matching notifications', () => {
    setupInboxSWR([
      makeNotification({ id: 'n1', title: 'Error Alert', severity: 'error' }),
      makeNotification({ id: 'n2', title: 'Info Alert', severity: 'info' }),
    ]);
    openInbox();

    // Click Error filter
    fireEvent.click(screen.getByText('Error'));

    expect(screen.getByText('Error Alert')).toBeInTheDocument();
    expect(screen.queryByText('Info Alert')).not.toBeInTheDocument();
  });

  it('"Mark all read" button hidden when no unread notifications', () => {
    setupInboxSWR([makeNotification({ readAt: '2024-01-01' })], 0);
    openInbox();
    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();
  });

  it('"Mark all read" button visible when there are unread notifications', () => {
    setupInboxSWR([makeNotification()], 1);
    openInbox();
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('shows "No notifications match filters" when filters exclude all', () => {
    setupInboxSWR([
      makeNotification({ id: 'n1', severity: 'info' }),
    ]);
    openInbox();

    // Filter by error — should exclude the info notification
    fireEvent.click(screen.getByText('Error'));

    expect(screen.getByText('No notifications match filters')).toBeInTheDocument();
  });

  it('derives category filters from notification data', () => {
    setupInboxSWR([
      makeNotification({ id: 'n1', category: 'workflow_failed' }),
      makeNotification({ id: 'n2', category: 'connection_degraded' }),
    ]);
    openInbox();

    // Category labels shown (with _ replaced by space)
    expect(screen.getByText('workflow failed')).toBeInTheDocument();
    expect(screen.getByText('connection degraded')).toBeInTheDocument();
  });

  it('markRead: clicking mark-read button calls api.patch with correct URL', async () => {
    (api.patch as any).mockResolvedValueOnce({});
    setupInboxSWR([makeNotification({ id: 'abc123', readAt: null })]);
    openInbox();

    const markReadBtn = screen.getByTitle('Mark read');
    fireEvent.click(markReadBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/notifications/abc123/read');
    });
  });

  it('dismiss: clicking dismiss button calls api.patch with correct URL', async () => {
    (api.patch as any).mockResolvedValueOnce({});
    setupInboxSWR([makeNotification({ id: 'xyz789' })]);
    openInbox();

    const dismissBtn = screen.getByTitle('Dismiss');
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/notifications/xyz789/dismiss');
    });
  });

  it('markRead: shows toast.error when api.patch rejects', async () => {
    (api.patch as any).mockRejectedValueOnce(new Error('network error'));
    setupInboxSWR([makeNotification({ id: 'n1', readAt: null })]);
    openInbox();

    fireEvent.click(screen.getByTitle('Mark read'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to mark as read');
    });
  });

  it('dismiss: shows toast.error when api.patch rejects', async () => {
    (api.patch as any).mockRejectedValueOnce(new Error('network error'));
    setupInboxSWR([makeNotification({ id: 'n1' })]);
    openInbox();

    fireEvent.click(screen.getByTitle('Dismiss'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to dismiss notification');
    });
  });

  it('markAllRead: clicking "Mark all read" calls api.post with /notifications/read-all', async () => {
    (api.post as any).mockResolvedValueOnce({});
    setupInboxSWR([makeNotification()], 1);
    openInbox();

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/notifications/read-all');
    });
  });

  it('markAllRead: shows toast.success on success', async () => {
    (api.post as any).mockResolvedValueOnce({});
    setupInboxSWR([makeNotification()], 1);
    openInbox();

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('All marked as read');
    });
  });

  it('markAllRead: shows toast.error when api.post rejects', async () => {
    (api.post as any).mockRejectedValueOnce(new Error('server error'));
    setupInboxSWR([makeNotification()], 1);
    openInbox();

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to mark all as read');
    });
  });

  it('category filter: clicking a category chip shows only matching notifications', () => {
    setupInboxSWR([
      makeNotification({ id: 'n1', title: 'Workflow Alert', category: 'workflow_failed' }),
      makeNotification({ id: 'n2', title: 'Connection Alert', category: 'connection_degraded' }),
    ]);
    openInbox();

    // Click the workflow_failed category chip
    fireEvent.click(screen.getByText('workflow failed'));

    expect(screen.getByText('Workflow Alert')).toBeInTheDocument();
    expect(screen.queryByText('Connection Alert')).not.toBeInTheDocument();
  });

  it('date grouping: notifications from today appear under "Today"', () => {
    const todayIso = new Date().toISOString();
    setupInboxSWR([makeNotification({ id: 'n1', title: 'Recent Alert', createdAt: todayIso })]);
    openInbox();

    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('date grouping: notifications from yesterday appear under "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    setupInboxSWR([makeNotification({ id: 'n1', title: 'Yesterday Alert', createdAt: yesterday.toISOString() })]);
    openInbox();

    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('date grouping: notifications from 3 days ago appear under "This Week"', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(12, 0, 0, 0);
    setupInboxSWR([makeNotification({ id: 'n1', title: 'Old Alert', createdAt: threeDaysAgo.toISOString() })]);
    openInbox();

    expect(screen.getByText('This Week')).toBeInTheDocument();
  });

  it('date grouping: notifications from 10 days ago appear under "Earlier"', () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    tenDaysAgo.setHours(12, 0, 0, 0);
    setupInboxSWR([makeNotification({ id: 'n1', title: 'Old Alert', createdAt: tenDaysAgo.toISOString() })]);
    openInbox();

    expect(screen.getByText('Earlier')).toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: true, mutate: vi.fn() });
    render(<NotificationsPage />);
    fireEvent.click(screen.getByText('Inbox'));
    // The spinner renders as an SVG via Loader2; verify no notification list is shown
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
  });
});

// ── PreferencesTab ──────────────────────────────────────────

describe('PreferencesTab', () => {
  it('renders all event types', () => {
    render(<NotificationsPage />);

    expect(screen.getByText('Workflow Failed')).toBeInTheDocument();
    expect(screen.getByText('Workflow Completed')).toBeInTheDocument();
    // Workflow Launched was killed as routine-success noise (2026-08-07);
    // the Bulk Upload run events replaced it in the matrix.
    expect(screen.queryByText('Workflow Launched')).not.toBeInTheDocument();
    expect(screen.getByText('Bulk Upload Run Finished')).toBeInTheDocument();
    expect(screen.getByText('Bulk Upload Run Stopped')).toBeInTheDocument();
    expect(screen.getByText('Automation Failed')).toBeInTheDocument();
    expect(screen.getByText('Connection Degraded')).toBeInTheDocument();
    expect(screen.getByText('Webhook Failed')).toBeInTheDocument();
  });

  it('renders the In-App channel column (Slack moved to Slack tab)', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('In-App')).toBeInTheDocument();
    // Slack column was removed from the matrix; routing is configured in the
    // Slack tab. The word "Slack" still appears in the tab bar / blurb.
    expect(screen.getByTitle('Toggle all In-App')).toBeInTheDocument();
    expect(screen.queryByTitle('Toggle all Slack')).not.toBeInTheDocument();
  });

  it('Save button is disabled when no changes made', () => {
    render(<NotificationsPage />);
    const saveBtn = screen.getByText('Save Preferences');
    expect(saveBtn.closest('button')).toBeDisabled();
  });

  it('calls updateNotificationPreferences on save', async () => {
    mockUpdateNotificationPreferences.mockResolvedValueOnce({});
    render(<NotificationsPage />);

    // Toggle a checkbox by clicking on one of the toggle buttons (there are 36 = 12 events x 3 channels)
    // Find all toggle buttons - they have title "Toggle all ..."
    // Instead, let's click a specific toggle in the matrix
    // The toggles are buttons inside the grid cells
    const allButtons = screen.getAllByRole('button');
    // Find a toggle button (the ones without text)
    const toggleButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      return svg && !btn.textContent?.trim();
    });

    if (toggleButtons.length > 0) {
      fireEvent.click(toggleButtons[0]);

      // Now save should be enabled
      const saveBtn = screen.getByText('Save Preferences');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateNotificationPreferences).toHaveBeenCalled();
      });
    }
  });

  it('shows "Unsaved changes" when dirty', () => {
    render(<NotificationsPage />);

    const allButtons = screen.getAllByRole('button');
    const toggleButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      return svg && !btn.textContent?.trim();
    });

    if (toggleButtons.length > 0) {
      fireEvent.click(toggleButtons[0]);
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    }
  });

  it('Discard button resets to server state', () => {
    render(<NotificationsPage />);

    const allButtons = screen.getAllByRole('button');
    const toggleButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      return svg && !btn.textContent?.trim();
    });

    if (toggleButtons.length > 0) {
      fireEvent.click(toggleButtons[0]);
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Discard'));
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    }
  });

  it('toggleAllChannel: clicking a column header toggle flips all checkboxes in that column', () => {
    render(<NotificationsPage />);

    // Click the "In-App" column header which calls toggleAllChannel('inApp')
    const inAppHeader = screen.getByTitle('Toggle all In-App');
    fireEvent.click(inAppHeader);

    // After toggling all In-App off, isDirty should be true and "Unsaved changes" should show
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('Email column is currently disabled in the matrix', () => {
    render(<NotificationsPage />);
    // Email is intentionally commented out of CHANNELS — guard against silent re-introduction.
    expect(screen.queryByTitle('Toggle all Email')).not.toBeInTheDocument();
  });

  it('handleSave success: calls toast.success and clears dirty state', async () => {
    mockUpdateNotificationPreferences.mockResolvedValueOnce({});
    render(<NotificationsPage />);

    // Make a change to enable the save button
    const allButtons = screen.getAllByRole('button');
    const toggleButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      return svg && !btn.textContent?.trim();
    });
    fireEvent.click(toggleButtons[0]);

    const saveBtn = screen.getByText('Save Preferences');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Notification preferences saved');
    });

    // After save, dirty state should be cleared
    await waitFor(() => {
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });
  });

  it('handleSave error: calls toast.error when updateNotificationPreferences rejects', async () => {
    mockUpdateNotificationPreferences.mockRejectedValueOnce(new Error('server error'));
    render(<NotificationsPage />);

    // Make a change to enable the save button
    const allButtons = screen.getAllByRole('button');
    const toggleButtons = allButtons.filter(btn => {
      const svg = btn.querySelector('svg');
      return svg && !btn.textContent?.trim();
    });
    fireEvent.click(toggleButtons[0]);

    const saveBtn = screen.getByText('Save Preferences');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save preferences');
    });
  });
});

// ── SlackTab ────────────────────────────────────────────────

describe('SlackTab', () => {
  function openSlack() {
    render(<NotificationsPage />);
    const slackButtons = screen.getAllByText('Slack');
    fireEvent.click(slackButtons[0]);
  }

  it('shows Add to Slack button and warning when not connected', () => {
    setupSlackConfig(undefined, false);
    openSlack();
    expect(screen.getByRole('button', { name: /Add to Slack/i })).toBeInTheDocument();
    // Banner copy is split across <span> + <strong>, so match by a function.
    expect(
      screen.getByText((_, el) =>
        el?.tagName === 'SPAN' &&
        /Click/.test(el.textContent ?? '') &&
        /Add to Slack/.test(el.textContent ?? '') &&
        /above/.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
  });

  it('hides warning banner when connected', () => {
    setupSlackConfig(undefined, true);
    openSlack();
    // The banner's lead-in only renders when not connected.
    expect(screen.queryByText(/install the bot in your workspace/i)).not.toBeInTheDocument();
  });

  it('toggle reflects server enabled state', () => {
    setupSlackConfig({ orgId: 'org-1', enabled: true, channelRouting: { default: '#alerts' } });
    openSlack();
    expect(screen.getByText('Sending alerts to Slack')).toBeInTheDocument();
  });

  it('hides toggle and routing when not connected', () => {
    setupSlackConfig(undefined, false);
    openSlack();
    expect(screen.queryByText('Slack Notifications')).not.toBeInTheDocument();
    expect(screen.queryByText('Channel Routing')).not.toBeInTheDocument();
  });

  it('renders default channel input', () => {
    openSlack();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('baton-alerts')).toBeInTheDocument();
  });

  it('test button calls testSlackNotification', async () => {
    mockTestSlackNotification.mockResolvedValueOnce({ message: 'Sent!' });
    openSlack();

    const testBtn = screen.getByText('Send Test Message');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(mockTestSlackNotification).toHaveBeenCalledTimes(1);
    });
  });

  it('test button not rendered when not connected', () => {
    setupSlackConfig(undefined, false);
    openSlack();
    expect(screen.queryByText('Send Test Message')).not.toBeInTheDocument();
  });

  it('Save button disabled when not dirty', () => {
    openSlack();
    const saveBtn = screen.getByText('Save Settings');
    expect(saveBtn.closest('button')).toBeDisabled();
  });

  it('handleSave: typing in the default channel input makes Save button enabled', async () => {
    openSlack();

    const channelInput = screen.getByPlaceholderText('baton-alerts');
    fireEvent.change(channelInput, { target: { value: 'general' } });

    const saveBtn = screen.getByText('Save Settings');
    expect(saveBtn.closest('button')).not.toBeDisabled();
  });

  it('handleSave: typing in channel input and clicking Save calls mockUpdateSlackConfig', async () => {
    mockUpdateSlackConfig.mockResolvedValueOnce({});
    openSlack();

    const channelInput = screen.getByPlaceholderText('baton-alerts');
    fireEvent.change(channelInput, { target: { value: 'alerts' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockUpdateSlackConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          channelRouting: expect.objectContaining({ default: '#alerts' }),
        })
      );
    });
  });

  it('handleSave success: shows toast.success after successful save', async () => {
    mockUpdateSlackConfig.mockResolvedValueOnce({});
    openSlack();

    const channelInput = screen.getByPlaceholderText('baton-alerts');
    fireEvent.change(channelInput, { target: { value: 'my-channel' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Slack settings saved');
    });
  });

  it('handleSave error: shows toast.error when updateSlackConfig rejects', async () => {
    const err = new Error('network failure');
    mockUpdateSlackConfig.mockRejectedValueOnce(err);
    openSlack();

    const channelInput = screen.getByPlaceholderText('baton-alerts');
    fireEvent.change(channelInput, { target: { value: 'my-channel' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('network failure');
    });
  });

  it('handleSave error: shows generic message when error has no message', async () => {
    mockUpdateSlackConfig.mockRejectedValueOnce({});
    openSlack();

    const channelInput = screen.getByPlaceholderText('baton-alerts');
    fireEvent.change(channelInput, { target: { value: 'my-channel' } });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save');
    });
  });

  it('toggle enabled state: clicking enable toggle makes component dirty', () => {
    setupSlackConfig({ orgId: 'org-1', enabled: false, channelRouting: { default: '' } }, true);
    openSlack();

    // The toggle button is for the enable/disable toggle (no title when token is configured)
    // Find it by looking for the ToggleLeft/ToggleRight icon button
    const allButtons = screen.getAllByRole('button');
    // The enable toggle is the only button without a title that wraps a wide SVG
    const enableToggle = allButtons.find(btn =>
      !btn.hasAttribute('title') &&
      !btn.textContent?.trim() &&
      btn.querySelector('svg')
    );

    expect(enableToggle).toBeDefined();
    fireEvent.click(enableToggle!);

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('toggle enabled state: clicking toggle shows "Sending alerts to Slack" when enabling', () => {
    setupSlackConfig({ orgId: 'org-1', enabled: false, channelRouting: { default: '' } }, true);
    openSlack();

    // Currently disabled — shows "Alerts are paused"
    expect(screen.getByText('Alerts are paused')).toBeInTheDocument();

    const allButtons = screen.getAllByRole('button');
    const enableToggle = allButtons.find(btn =>
      !btn.hasAttribute('title') &&
      !btn.textContent?.trim() &&
      btn.querySelector('svg')
    );

    fireEvent.click(enableToggle!);

    expect(screen.getByText('Sending alerts to Slack')).toBeInTheDocument();
  });

  it('handleTest error: shows toast.error when testSlackNotification rejects', async () => {
    const err = { message: 'invalid channel' };
    mockTestSlackNotification.mockRejectedValueOnce(err);
    openSlack();

    fireEvent.click(screen.getByText('Send Test Message'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('invalid channel');
    });
  });

  it('handleTest error: shows generic message when error has no message', async () => {
    mockTestSlackNotification.mockRejectedValueOnce({});
    openSlack();

    fireEvent.click(screen.getByText('Send Test Message'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Test failed - check bot token and channel');
    });
  });

  it('channel routing input: typing a per-event channel updates the input value', () => {
    openSlack();

    // The per-event channel inputs use the default channel as placeholder text
    // Find the first per-event placeholder input (workflow_failed)
    const allInputs = screen.getAllByRole('textbox');
    // First input is default channel, subsequent ones are per-event
    const perEventInput = allInputs[1];

    fireEvent.change(perEventInput, { target: { value: 'workflow-errors' } });

    expect((perEventInput as HTMLInputElement).value).toBe('workflow-errors');
  });

  it('Save button becomes enabled when a per-event channel is set', () => {
    openSlack();

    const allInputs = screen.getAllByRole('textbox');
    const perEventInput = allInputs[1];

    fireEvent.change(perEventInput, { target: { value: 'workflow-errors' } });

    const saveBtn = screen.getByText('Save Settings');
    expect(saveBtn.closest('button')).not.toBeDisabled();
  });

  it('shows loading state when isLoading is true', () => {
    mockUseSlackConfig.mockReturnValue({ data: undefined, isLoading: true, mutate: vi.fn() });
    render(<NotificationsPage />);
    const slackButtons = screen.getAllByText('Slack');
    fireEvent.click(slackButtons[0]);

    // The spinner renders and the channel routing section is not shown
    expect(screen.queryByText('Channel Routing')).not.toBeInTheDocument();
  });
});

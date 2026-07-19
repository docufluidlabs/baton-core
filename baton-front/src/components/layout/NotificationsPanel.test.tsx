import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationsPanel } from './NotificationsPanel';

// ─── Mocks ──────────────────────────────────────────────────

const mockMutate = vi.fn();
const mockUseSWR = vi.fn();

vi.mock('swr', () => ({
  default: (...args: any[]) => mockUseSWR(...args),
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

const mockApiPatch = vi.fn();
const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  fetcher: vi.fn(),
  api: {
    patch: (...args: any[]) => mockApiPatch(...args),
    post: (...args: any[]) => mockApiPost(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/utils', () => ({
  timeAgo: () => '2 min ago',
  formatDateFull: () => 'January 1, 2024, 12:00 AM',
}));

// ─── Helpers ────────────────────────────────────────────────

function makeNotification(overrides: any = {}) {
  return {
    id: 'n1',
    title: 'Test Alert',
    message: 'Something happened',
    severity: 'info',
    eventType: 'workflow_launched',
    readAt: null,
    dismissedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function setupSWR(notifications: any[] = [], unreadCount?: number) {
  mockUseSWR.mockReturnValue({
    data: {
      notifications,
      unreadCount: unreadCount ?? notifications.filter(n => !n.readAt).length,
    },
    isLoading: false,
    mutate: vi.fn(),
  });
}

beforeEach(() => {
  mockUseSWR.mockReset();
  mockMutate.mockReset();
  mockApiPatch.mockReset();
  mockApiPost.mockReset();
  setupSWR([]);
  // Clear localStorage
  localStorage.clear();
});

// ── Bell icon and badge ─────────────────────────────────────

describe('bell icon and badge', () => {
  it('renders bell icon', () => {
    render(<NotificationsPanel />);
    // Bell icon is in a button
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('shows unread count badge when unreadCount > 0', () => {
    setupSWR([makeNotification()], 3);
    render(<NotificationsPanel />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows "9+" when unreadCount exceeds 9', () => {
    setupSWR([makeNotification()], 12);
    render(<NotificationsPanel />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('hides badge when unreadCount is 0', () => {
    setupSWR([], 0);
    render(<NotificationsPanel />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });
});

// ── Panel open/close ────────────────────────────────────────

describe('panel open/close', () => {
  it('opens panel on bell click', () => {
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('closes panel on second bell click', () => {
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);

    const button = screen.getByRole('button');
    fireEvent.click(button); // open
    fireEvent.click(button); // close

    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});

// ── Notification list ───────────────────────────────────────

describe('notification list', () => {
  it('shows "All caught up!" when no visible notifications', () => {
    setupSWR([]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('All caught up!')).toBeInTheDocument();
  });

  it('renders notification titles and messages', () => {
    setupSWR([makeNotification({ title: 'Deploy Failed', message: 'Error in step 3' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Deploy Failed')).toBeInTheDocument();
    expect(screen.getByText('Error in step 3')).toBeInTheDocument();
  });

  it('filters out dismissed notifications', () => {
    setupSWR([
      makeNotification({ id: 'n1', title: 'Visible' }),
      makeNotification({ id: 'n2', title: 'Dismissed', dismissedAt: '2024-01-01' }),
    ]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.queryByText('Dismissed')).not.toBeInTheDocument();
  });
});

// ── Actions ─────────────────────────────────────────────────

describe('actions', () => {
  it('calls PATCH on markRead and revalidates', async () => {
    mockApiPatch.mockResolvedValueOnce({});
    setupSWR([makeNotification({ id: 'n1' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button')); // open panel

    // Click the mark-read button (Check icon)
    const markReadBtn = screen.getByTitle('Mark read');
    fireEvent.click(markReadBtn);

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/notifications/n1/read');
    });
  });

  it('calls PATCH on dismiss and revalidates', async () => {
    mockApiPatch.mockResolvedValueOnce({});
    setupSWR([makeNotification({ id: 'n1' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    const dismissBtn = screen.getByTitle('Dismiss');
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/notifications/n1/dismiss');
    });
  });

  it('calls POST on markAllRead', async () => {
    mockApiPost.mockResolvedValueOnce({});
    setupSWR([makeNotification()], 3);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    const markAllBtn = screen.getByText('Mark all read');
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/notifications/read-all');
    });
  });

  it('shows toast error on markRead API failure', async () => {
    mockApiPatch.mockRejectedValueOnce(new Error('fail'));
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    const markReadBtn = screen.getByTitle('Mark read');
    fireEvent.click(markReadBtn);

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to mark notification as read');
    });
  });

  it('"Mark all read" only visible when unreadCount > 0', () => {
    setupSWR([makeNotification({ readAt: '2024-01-01' })], 0);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();
  });
});

// ── SeverityIcon ────────────────────────────────────────────

describe('SeverityIcon', () => {
  it('renders different icons for different severities', () => {
    const severities = ['error', 'warning', 'success', 'info'];
    for (const severity of severities) {
      setupSWR([makeNotification({ id: `n-${severity}`, severity })]);
      const { unmount } = render(<NotificationsPanel />);
      fireEvent.click(screen.getByRole('button'));
      // Just verify it renders without error
      expect(screen.getByText('Test Alert')).toBeInTheDocument();
      unmount();
    }
  });
});

// ── dismiss error handling ───────────────────────────────────

describe('dismiss error handling', () => {
  it('shows toast.error when dismiss API call fails', async () => {
    mockApiPatch.mockRejectedValueOnce(new Error('network error'));
    setupSWR([makeNotification({ id: 'n1' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button')); // open panel

    const dismissBtn = screen.getByTitle('Dismiss');
    fireEvent.click(dismissBtn);

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to dismiss notification');
    });
  });
});

// ── revalidateBoth ───────────────────────────────────────────

describe('revalidateBoth', () => {
  it('calls globalMutate with a key-matching function after markRead', async () => {
    mockApiPatch.mockResolvedValueOnce({});
    setupSWR([makeNotification({ id: 'n1' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByTitle('Mark read'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });

    // The matcher function should match keys starting with '/notifications'
    const matcher = mockMutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher('/notifications?limit=20')).toBe(true);
    expect(matcher('/notifications')).toBe(true);
    expect(matcher('/other-key')).toBe(false);
    expect(matcher(42)).toBe(false);
  });

  it('calls globalMutate after dismiss', async () => {
    mockApiPatch.mockResolvedValueOnce({});
    setupSWR([makeNotification({ id: 'n1' })]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByTitle('Dismiss'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });
});

// ── outside click closes panel ───────────────────────────────

describe('outside click closes panel', () => {
  it('closes panel when mousedown fires outside the panel ref', async () => {
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);

    // Open panel
    const bellButton = screen.getByRole('button');
    fireEvent.click(bellButton);
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    // Simulate a mousedown on a node outside the panel
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });
  });

  it('does not close panel when mousedown fires inside the panel', async () => {
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);

    const bellButton = screen.getByRole('button');
    fireEvent.click(bellButton);
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    // Mousedown inside the panel header — should keep it open
    fireEvent.mouseDown(screen.getByText('Notifications'));

    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });
});

// ── timestamps ──────────────────────────────────────────────

describe('timestamps', () => {
  it('shows relative time with the full date as a hover title', () => {
    setupSWR([makeNotification()]);
    render(<NotificationsPanel />);
    fireEvent.click(screen.getByRole('button'));

    const timestamp = screen.getByText('2 min ago');
    expect(timestamp).toBeInTheDocument();
    expect(timestamp).toHaveAttribute('title', 'January 1, 2024, 12:00 AM');
  });
});

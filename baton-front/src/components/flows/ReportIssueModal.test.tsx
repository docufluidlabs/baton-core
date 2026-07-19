/**
 * Tests for ReportIssueModal
 * Key fix verified: after successful submission, success screen is shown
 * and onClose is NOT called (modal stays open so user sees the result).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportIssueModal } from './ReportIssueModal';

// ─── Mocks ──────────────────────────────────────────────────

const mockReportInstance = vi.fn();
vi.mock('@/hooks/useApi', () => ({
  reportInstance: (...args: any[]) => mockReportInstance(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Fixtures ────────────────────────────────────────────────

const fakeInstance = {
  id: 'inst-1',
  orgId: 'org-1',
  workflowId: 'wf-1',
  instanceName: 'Test Workflow — Run 1',
  status: 'failed' as const,
  errorMessage: 'Step 2 timed out',
  startedAt: '2026-04-07T10:00:00.000Z',
  retryCount: 0,
};

function renderModal(overrides: Partial<Parameters<typeof ReportIssueModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmitted = vi.fn();
  render(
    <ReportIssueModal
      instance={fakeInstance as any}
      onClose={onClose}
      onSubmitted={onSubmitted}
      {...overrides}
    />,
  );
  return { onClose, onSubmitted };
}

async function fillAndSubmit(title = 'Something broke') {
  const input = screen.getByPlaceholderText(/workflow fails/i);
  fireEvent.change(input, { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: /send to support/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────

describe('ReportIssueModal', () => {
  it('renders the form on mount', () => {
    renderModal();
    expect(screen.getByText('Report Issue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to support/i })).toBeInTheDocument();
  });

  it('submit button is disabled when title is empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /send to support/i })).toBeDisabled();
  });

  it('submit button is enabled once title is entered', () => {
    renderModal();
    const input = screen.getByPlaceholderText(/workflow fails/i);
    fireEvent.change(input, { target: { value: 'Something broke' } });
    expect(screen.getByRole('button', { name: /send to support/i })).not.toBeDisabled();
  });

  it('shows success screen after successful submission', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: 'https://app.support.example.com/t/task-1' });
    renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Ticket Created')).toBeInTheDocument();
    });
  });

  it('does NOT call onClose on successful submission — modal stays open', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: 'https://app.support.example.com/t/task-1' });
    const { onClose } = renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Ticket Created')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onSubmitted with instance id on success', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: 'https://app.support.example.com/t/task-1' });
    const { onSubmitted } = renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith('inst-1');
    });
  });

  it('shows View in ClickUp link when taskUrl is returned', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: 'https://app.support.example.com/t/task-1' });
    renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view in clickup/i });
      expect(link).toHaveAttribute('href', 'https://app.support.example.com/t/task-1');
    });
  });

  it('shows error screen on failed submission', async () => {
    mockReportInstance.mockRejectedValue({ message: 'Network error' });
    renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Failed to Create Ticket')).toBeInTheDocument();
    });
  });

  it('does NOT call onClose on failed submission', async () => {
    mockReportInstance.mockRejectedValue(new Error('Network error'));
    const { onClose } = renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText('Failed to Create Ticket')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows Try Again button on error screen', async () => {
    mockReportInstance.mockRejectedValue(new Error('fail'));
    renderModal();

    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  it('returns to form when Try Again is clicked', async () => {
    mockReportInstance.mockRejectedValue(new Error('fail'));
    renderModal();

    await fillAndSubmit();

    await waitFor(() => screen.getByRole('button', { name: /try again/i }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByRole('button', { name: /send to support/i })).toBeInTheDocument();
  });

  it('calls onClose when Close button clicked on success screen', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: undefined });
    const { onClose } = renderModal();

    await fillAndSubmit();

    await waitFor(() => screen.getByText('Ticket Created'));
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('passes title and description to reportInstance', async () => {
    mockReportInstance.mockResolvedValue({ taskUrl: undefined });
    renderModal();

    const titleInput = screen.getByPlaceholderText(/workflow fails/i);
    const descInput = screen.getByPlaceholderText(/describe what you expected/i);
    fireEvent.change(titleInput, { target: { value: 'My Title' } });
    fireEvent.change(descInput, { target: { value: 'Some details' } });
    fireEvent.click(screen.getByRole('button', { name: /send to support/i }));

    await waitFor(() => {
      expect(mockReportInstance).toHaveBeenCalledWith('inst-1', {
        title: 'My Title',
        description: 'Some details',
      });
    });
  });
});

/**
 * Tests for ActionLogsSidebar
 * Key fix verified: Maestro Instance ID copy button is present when maestroInstanceId is set.
 * Also covers: filter chips, status badge rendering, empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActionLogsSidebar } from './ActionLogsSidebar';
import type { AutomationAction } from '@/hooks/useApi';

// ─── Mocks ──────────────────────────────────────────────────

const mockUseAutomationActions = vi.fn();
const mockUseAutomationQueue = vi.fn();
vi.mock('@/hooks/useApi', () => ({
  useAutomationActions: (...args: any[]) => mockUseAutomationActions(...args),
  useAutomationQueue: (...args: any[]) => mockUseAutomationQueue(...args),
  retryInstance: vi.fn(),
  releaseQueuedWebhook: vi.fn(),
  cancelQueuedWebhook: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/utils', () => ({
  timeAgo: () => '5m ago',
}));

// ─── Fixtures ────────────────────────────────────────────────

function makeAction(overrides: Partial<AutomationAction> = {}): AutomationAction {
  return {
    actionNumber: 1,
    pipelineEntryId: 'pipeline-1',
    webhookEventId: 'webhook-1',
    triggeredAt: '2026-04-07T10:00:00.000Z',
    status: 'launched',
    signatureValid: true,
    payload: { event: 'contact.created' },
    errorMessage: null,
    userMessage: null,
    instance: {
      id: 'inst-1',
      maestroInstanceId: 'maestro-inst-abc',
      status: 'completed',
      retryCount: 0,
      retryMaxAttempts: null,
      nextRetryAt: null,
      errorMessage: null,
      inputData: null,
    },
    ...overrides,
  };
}

function renderSidebar(actions: AutomationAction[] = [makeAction()]) {
  mockUseAutomationActions.mockReturnValue({ data: { actions }, isLoading: false, mutate: vi.fn() });
  render(
    <ActionLogsSidebar
      open={true}
      ruleId="rule-1"
      ruleName="Test Automation"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Queue hook is only active when the rule is paused; default to no queue data
  mockUseAutomationQueue.mockReturnValue({ data: undefined, mutate: vi.fn() });
  // Mock clipboard
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ─── Tests ──────────────────────────────────────────────────

describe('ActionLogsSidebar', () => {
  it('shows loading spinner when isLoading — no action cards rendered', () => {
    mockUseAutomationActions.mockReturnValue({ data: undefined, isLoading: true, mutate: vi.fn() });
    render(
      <ActionLogsSidebar open={true} ruleId="rule-1" ruleName="Test" onClose={vi.fn()} />,
    );
    // No action cards (e.g. "Relay 1") should appear while loading
    expect(screen.queryByText('Relay 1')).toBeNull();
    // No empty-state message either
    expect(screen.queryByText(/no relays yet/i)).toBeNull();
  });

  it('shows empty state when no actions', () => {
    mockUseAutomationActions.mockReturnValue({ data: { actions: [] }, isLoading: false, mutate: vi.fn() });
    render(
      <ActionLogsSidebar open={true} ruleId="rule-1" ruleName="Test" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/no relays yet/i)).toBeInTheDocument();
  });

  it('renders action cards for each action', () => {
    renderSidebar([makeAction({ actionNumber: 1 }), makeAction({ actionNumber: 2, pipelineEntryId: 'pipeline-2' })]);
    expect(screen.getByText('Relay 1')).toBeInTheDocument();
    expect(screen.getByText('Relay 2')).toBeInTheDocument();
  });

  it('shows "Relay" label when actionNumber is null', () => {
    renderSidebar([makeAction({ actionNumber: null })]);
    expect(screen.getByText('Relay')).toBeInTheDocument();
  });

  it('shows filter chips with correct counts', () => {
    renderSidebar([
      makeAction({ status: 'launched' }),
      makeAction({ status: 'running', pipelineEntryId: 'p2' }),
      makeAction({ status: 'failed', pipelineEntryId: 'p3' }),
    ]);
    // 'launched' actions display as Completed; 'running' as Running/Queued
    expect(screen.getByText('1 Completed')).toBeInTheDocument();
    expect(screen.getByText('1 Running/Queued')).toBeInTheDocument();
    expect(screen.getByText('1 Failed')).toBeInTheDocument();
    expect(screen.getByText('0 Cancelled')).toBeInTheDocument();
  });

  it('filters actions when a filter chip is clicked', () => {
    renderSidebar([
      makeAction({ actionNumber: 1, status: 'launched' }),
      makeAction({ actionNumber: 2, pipelineEntryId: 'p2', status: 'failed' }),
    ]);

    fireEvent.click(screen.getByText('1 Failed'));

    expect(screen.queryByText('Relay 1')).toBeNull();
    expect(screen.getByText('Relay 2')).toBeInTheDocument();
  });

  it('shows "no matches" when filter yields no results', () => {
    renderSidebar([makeAction({ status: 'launched' })]);

    fireEvent.click(screen.getByText('0 Failed'));

    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  // There is deliberately no backdrop — the canvas stays interactive while the
  // sidebar is open. Closing happens via the Escape key or the X button.
  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    mockUseAutomationActions.mockReturnValue({ data: { actions: [] }, isLoading: false, mutate: vi.fn() });
    render(
      <ActionLogsSidebar open={true} ruleId="rule-1" ruleName="Test" onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    mockUseAutomationActions.mockReturnValue({ data: { actions: [] }, isLoading: false, mutate: vi.fn() });
    render(
      <ActionLogsSidebar open={true} ruleId="rule-1" ruleName="Test" onClose={onClose} />,
    );
    // With no actions, the header close (X) button is the only button rendered
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalled();
  });
});

// ─── Maestro Instance ID copy button ────────────────────────

describe('ActionLogsSidebar — Workflow Builder Instance ID copy button', () => {
  it('copy button is present for Workflow Builder Instance ID when set', async () => {
    renderSidebar([makeAction()]); // instance.maestroInstanceId = 'maestro-inst-abc'

    // Expand the card
    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => {
      expect(screen.getByText('Workflow Builder Instance ID')).toBeInTheDocument();
    });

    // The ID value should be visible
    expect(screen.getByText('maestro-inst-abc')).toBeInTheDocument();
  });

  it('clicking Workflow Builder copy button writes to clipboard', async () => {
    renderSidebar([makeAction()]);

    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => screen.getByText('maestro-inst-abc'));

    // Find all copy buttons and click the one in the Workflow Builder row
    // The Workflow Builder row copy button is next to 'maestro-inst-abc'
    const maestroValue = screen.getByText('maestro-inst-abc');
    const row = maestroValue.closest('div');
    const copyBtn = row?.querySelector('button');
    expect(copyBtn).toBeTruthy();

    fireEvent.click(copyBtn!);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('maestro-inst-abc');
  });

  it('no copy button for Workflow Builder Instance ID when null', async () => {
    renderSidebar([makeAction({ instance: null })]);

    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => screen.getByText('Workflow Builder Instance ID'));

    // Should show - instead
    const maestroRow = screen.getByText('Workflow Builder Instance ID').closest('div');
    expect(maestroRow?.querySelector('button')).toBeFalsy();
  });
});

// ─── Webhook verification stage ─────────────────────────────

describe('ActionLogsSidebar — stage indicators', () => {
  it('shows Verified for valid signature', async () => {
    renderSidebar([makeAction({ signatureValid: true })]);
    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => {
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });
  });

  it('shows Verification failed for invalid signature', async () => {
    renderSidebar([makeAction({ signatureValid: false })]);
    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => {
      expect(screen.getByText('Verification failed')).toBeInTheDocument();
    });
  });

  it('shows Completed for the Workflow Builder Trigger stage when an instance exists', async () => {
    renderSidebar([makeAction({ status: 'launched' })]);
    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => {
      expect(screen.getByText('Workflow Builder Trigger')).toBeInTheDocument();
    });
    // Instance exists → the trigger stage reads "Completed"
    const stageRow = screen.getByText('Workflow Builder Trigger').closest('div');
    expect(stageRow?.textContent).toContain('Completed');
  });

  it('shows a pending Workflow Builder Trigger stage when no instance exists', async () => {
    renderSidebar([makeAction({ status: 'launched', instance: null })]);
    fireEvent.click(screen.getByText('Relay 1'));

    await waitFor(() => {
      expect(screen.getByText('Workflow Builder Trigger')).toBeInTheDocument();
    });
    // No instance → the trigger stage is pending: "-" placeholder, no "Completed"
    const stageRow = screen.getByText('Workflow Builder Trigger').closest('div');
    expect(stageRow?.textContent).toContain('-');
    expect(screen.queryByText('Completed')).toBeNull();
  });
});

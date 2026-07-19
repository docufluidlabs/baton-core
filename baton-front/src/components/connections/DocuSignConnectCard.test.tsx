/**
 * Tests for DocuSignConnectCard — guided OAuth setup vs. Connect button
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocuSignConnectCard } from './DocuSignConnectCard';

// ─── Mocks ──────────────────────────────────────────────────

const mockUseSetup = vi.fn();
vi.mock('@/hooks/useApi', () => ({
  useDocusignSetupStatus: (...args: any[]) => mockUseSetup(...args),
}));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: vi.fn(),
  },
}));

// ─── Helpers ────────────────────────────────────────────────

const REDIRECT_URI = 'http://localhost:3001/api/connections/docusign/callback';

function makeStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    configured: false,
    redirectUri: REDIRECT_URI,
    oauthBase: 'https://account-d.docusign.com',
    developerPortalUrl: 'https://developers.docusign.com',
    ...overrides,
  };
}

function setupHook(data: unknown, extras: Partial<Record<string, unknown>> = {}) {
  mockUseSetup.mockReturnValue({
    data,
    mutate: vi.fn(),
    isValidating: false,
    ...extras,
  });
}

const mockWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mockUseSetup.mockReset();
  mockToastSuccess.mockReset();
  mockWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  });
});

// ── Unconfigured: guided setup ──────────────────────────────

describe('unconfigured — guided setup', () => {
  it('shows the exact redirect URI in a read-only input with a Copy button', () => {
    setupHook(makeStatus());
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);

    const input = screen.getByLabelText('OAuth Redirect URI') as HTMLInputElement;
    expect(input.value).toBe(REDIRECT_URI);
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    // The dead Connect button is gone
    expect(screen.queryByRole('button', { name: /connect docusign/i })).not.toBeInTheDocument();
  });

  it('copies the redirect URI and toasts "Copied"', async () => {
    setupHook(makeStatus());
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(REDIRECT_URI);
      expect(mockToastSuccess).toHaveBeenCalledWith('Copied');
    });
  });

  it('links to the DocuSign developer portal', () => {
    setupHook(makeStatus());
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);

    const link = screen.getByRole('link', { name: /developers\.docusign\.com/i });
    expect(link).toHaveAttribute('href', 'https://developers.docusign.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the sandbox note when oauthBase is account-d', () => {
    setupHook(makeStatus({ oauthBase: 'https://account-d.docusign.com' }));
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);
    expect(screen.getByText(/developer sandbox/i)).toBeInTheDocument();
  });

  it('hides the sandbox note for production oauthBase', () => {
    setupHook(makeStatus({ oauthBase: 'https://account.docusign.com' }));
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);
    expect(screen.queryByText(/developer sandbox/i)).not.toBeInTheDocument();
  });

  it('"Check again" revalidates the setup status', () => {
    const mutate = vi.fn();
    setupHook(makeStatus(), { mutate });
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(mutate).toHaveBeenCalled();
  });
});

// ── Configured: today's Connect button ──────────────────────

describe('configured — Connect button', () => {
  it('shows the Connect Docusign button and calls onConnect on click', () => {
    const onConnect = vi.fn();
    setupHook(makeStatus({ configured: true }));
    render(<DocuSignConnectCard connecting={false} onConnect={onConnect} />);

    const button = screen.getByRole('button', { name: /connect docusign/i });
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalled();
    // No guided setup rendered
    expect(screen.queryByLabelText('OAuth Redirect URI')).not.toBeInTheDocument();
  });

  it('shows the connecting spinner state', () => {
    setupHook(makeStatus({ configured: true }));
    render(<DocuSignConnectCard connecting={true} onConnect={vi.fn()} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('falls back to the Connect button while the status is still loading', () => {
    setupHook(undefined);
    render(<DocuSignConnectCard connecting={false} onConnect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /connect docusign/i })).toBeInTheDocument();
  });
});

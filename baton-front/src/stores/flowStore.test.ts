/**
 * Tests for flowStore — fitView fix
 * Key fix verified: fitView can be called multiple times (no hasFitView guard blocking re-calls).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFlowStore } from './flowStore';

// Reset Zustand store between tests
beforeEach(() => {
  useFlowStore.setState({
    rfInstance: null,
    hasFitView: false,
  });
});

describe('flowStore — fitView', () => {
  it('does nothing when rfInstance is null', () => {
    useFlowStore.getState().fitView();
    expect(useFlowStore.getState().hasFitView).toBe(false);
  });

  it('calls rfInstance.fitView and sets hasFitView to true', () => {
    const mockFitView = vi.fn();
    useFlowStore.setState({
      rfInstance: { fitView: mockFitView } as any,
    });

    useFlowStore.getState().fitView();

    expect(mockFitView).toHaveBeenCalledWith({ padding: 0.12, maxZoom: 1 });
    expect(useFlowStore.getState().hasFitView).toBe(true);
  });

  it('can be called multiple times — no hasFitView guard blocking re-calls', () => {
    const mockFitView = vi.fn();
    useFlowStore.setState({
      rfInstance: { fitView: mockFitView } as any,
    });

    useFlowStore.getState().fitView();
    useFlowStore.getState().fitView();
    useFlowStore.getState().fitView();

    expect(mockFitView).toHaveBeenCalledTimes(3);
  });

  it('works after hasFitView was already true (re-center after node add/remove)', () => {
    const mockFitView = vi.fn();
    useFlowStore.setState({
      rfInstance: { fitView: mockFitView } as any,
      hasFitView: true, // simulate already fit
    });

    useFlowStore.getState().fitView();

    expect(mockFitView).toHaveBeenCalledOnce();
  });
});

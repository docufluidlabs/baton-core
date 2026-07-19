/**
 * Tests for WorkflowNode — dynamic platform icon
 * Key fix verified: PlatformIcon uses data.platform instead of hardcoded "docusign".
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WorkflowNode, type WorkflowNodeData } from './WorkflowNode';

// Mock ReactFlow Handle — it requires ReactFlowProvider context
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

// Capture the platform prop passed to PlatformIcon
const platformIconSpy = vi.fn();
vi.mock('@/components/ui/PlatformIcon', () => ({
  PlatformIcon: (props: any) => {
    platformIconSpy(props);
    return <img data-testid="platform-icon" data-platform={props.platform} />;
  },
}));

function makeData(overrides: Partial<WorkflowNodeData> = {}): WorkflowNodeData {
  return {
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    maestroStatus: 'active',
    launchCount: 10,
    completedCount: 8,
    failCount: 1,
    cancelledCount: 0,
    runningCount: 1,
    ...overrides,
  };
}

// NodeProps requires many fields — cast to satisfy TS while keeping tests focused
function renderNode(data: WorkflowNodeData) {
  render(<WorkflowNode {...{ id: 'n1', data, type: 'workflow' } as any} />);
}

describe('WorkflowNode — dynamic PlatformIcon', () => {
  it('renders PlatformIcon with provided platform', () => {
    platformIconSpy.mockClear();
    renderNode(makeData({ platform: 'salesforce' }));

    expect(platformIconSpy).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'salesforce' }),
    );
  });

  it('falls back to "docusign" when platform is undefined', () => {
    platformIconSpy.mockClear();
    renderNode(makeData({ platform: undefined }));

    expect(platformIconSpy).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'docusign' }),
    );
  });

  it('renders PlatformIcon with hubspot platform', () => {
    platformIconSpy.mockClear();
    renderNode(makeData({ platform: 'hubspot' }));

    expect(platformIconSpy).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'hubspot' }),
    );
  });
});

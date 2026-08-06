/**
 * Bulk Upload Page - Baton
 *
 * The standalone home of Bulk Upload: launch a Docusign Workflow Builder
 * workflow for every row of an uploaded file. Platform-agnostic by design -
 * the file is the trigger, wherever it was exported from - and manual by
 * nature (you initiate every run), which is why it lives apart from Flow
 * Builder's set-and-forget automations.
 *
 * Composes the existing Bulk Upload building blocks: BatchSidebar (create /
 * edit), BulkUploadWizard (upload -> map -> launch) and BatchLogsSidebar
 * (runs -> rows drill-in), around the page's own wide BulkUploadCard list.
 */
import { useMemo } from 'react';
import {
  useBatchProcessors,
  useWorkflows,
  pauseBatchRun,
  resumeBatchRun,
} from '@/hooks/useApi';
import { useSWRConfig } from 'swr';
import { BulkUploadCard } from '@/components/flows/BulkUploadCard';
import { BatchSidebar } from '@/components/flows/BatchSidebar';
import { BulkUploadWizard } from '@/components/flows/BulkUploadWizard';
import { BatchLogsSidebar } from '@/components/flows/BatchLogsSidebar';
import { useFlowStore } from '@/stores/flowStore';
import { Plus, Loader2, FileSpreadsheet, Upload, Table2, ListChecks } from 'lucide-react';

export default function BulkUploadPage() {
  const { data: batchData, error: batchError } = useBatchProcessors();
  const { data: wfData } = useWorkflows({ refreshInterval: 30_000 });
  const { mutate } = useSWRConfig();

  const {
    batchSidebarOpen, editingBatchProcessorId, openBatchSidebar, closeBatchSidebar,
    batchWizardProcessorId, openBatchWizard, closeBatchWizard,
    batchLogsProcessorId, openBatchLogs, closeBatchLogs,
  } = useFlowStore();

  const processors = useMemo(() => batchData?.processors ?? [], [batchData]);
  const workflows = useMemo(() => wfData?.workflows ?? [], [wfData]);
  const isLoading = !batchData && !batchError;
  const loadFailed = !batchData && !!batchError;

  const workflowById = useMemo(() => new Map(workflows.map((wf) => [wf.id, wf])), [workflows]);

  async function handleRunAction(processorId: string, runId: string, action: 'pause' | 'resume') {
    if (action === 'pause') await pauseBatchRun(processorId, runId);
    else await resumeBatchRun(processorId, runId);
    mutate('/batch-processors');
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[880px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Bulk Upload</h1>
            <p className="text-sm text-gray-500 mt-1">
              Launch a Docusign Workflow Builder workflow for every row of a file. Any CSV, XLSX or
              TSV works - the file is the trigger, wherever it came from.
            </p>
          </div>
          <button
            onClick={() => openBatchSidebar()}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Bulk Upload
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : loadFailed ? (
          <div className="text-center py-24">
            <p className="text-sm text-gray-500 mb-4">Couldn't load your Bulk Uploads.</p>
            <button
              onClick={() => mutate('/batch-processors')}
              className="px-4 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
            >
              Try again
            </button>
          </div>
        ) : processors.length === 0 ? (
          <EmptyState onCreate={() => openBatchSidebar()} />
        ) : (
          <div className="space-y-4">
            {processors.map((p) => {
              const wf = workflowById.get(p.targetWorkflowId);
              const activeRun = p.activeRun;
              return (
                <BulkUploadCard
                  key={p.id}
                  processor={p}
                  workflowName={wf?.name ?? 'Unknown workflow'}
                  workflowStatus={wf?.maestroStatus}
                  onUpload={() => openBatchWizard(p.id)}
                  onPause={activeRun ? () => handleRunAction(p.id, activeRun.id, 'pause') : undefined}
                  onResume={activeRun ? () => handleRunAction(p.id, activeRun.id, 'resume') : undefined}
                  onViewRuns={() => openBatchLogs(p.id)}
                  onEdit={() => openBatchSidebar(p.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create / edit sidebar */}
      <BatchSidebar
        open={batchSidebarOpen}
        onClose={closeBatchSidebar}
        editingProcessor={processors.find((p) => p.id === editingBatchProcessorId) ?? null}
        onSaved={() => mutate('/batch-processors')}
      />

      {/* Upload wizard - mounted per open so state resets between uploads */}
      {(() => {
        const wizardProcessor = processors.find((p) => p.id === batchWizardProcessorId);
        if (!wizardProcessor) return null;
        return (
          <BulkUploadWizard
            processor={wizardProcessor}
            onClose={closeBatchWizard}
            onStarted={() => mutate('/batch-processors')}
          />
        );
      })()}

      {/* Runs -> rows drill-in */}
      {(() => {
        const logsProcessor = processors.find((p) => p.id === batchLogsProcessorId) ?? null;
        return (
          <BatchLogsSidebar
            open={batchLogsProcessorId !== null}
            processor={logsProcessor}
            workflowName={workflowById.get(logsProcessor?.targetWorkflowId ?? '')?.name ?? null}
            onClose={closeBatchLogs}
          />
        );
      })()}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    {
      icon: FileSpreadsheet,
      title: 'Connect a workflow',
      text: 'Pick the Docusign Workflow Builder workflow every row should launch.',
    },
    {
      icon: Upload,
      title: 'Upload your file',
      text: 'CSV, XLSX or TSV - exported from any CRM, sheet, or system.',
    },
    {
      icon: Table2,
      title: 'Map the columns',
      text: 'Match file columns to the workflow inputs and pick the rows to launch.',
    },
    {
      icon: ListChecks,
      title: 'Track every row',
      text: 'Rows release on your throttle; each one becomes a workflow instance you can follow.',
    },
  ];

  return (
    <div className="text-center py-14">
      <div className="w-20 h-20 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-6">
        <FileSpreadsheet className="w-10 h-10 text-blue-400" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Launch workflows from any spreadsheet</h2>
      <p className="text-sm text-gray-500 max-w-md mx-auto mb-10">
        Bulk Upload turns a file into workflow launches - one instance per row, throttled and
        tracked. No platform connection needed.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-3xl mx-auto mb-10 text-left">
        {steps.map((s, i) => (
          <div key={s.title} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-600 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
              <s.icon className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900">{s.title}</p>
            <p className="text-xs text-gray-500 mt-1 leading-snug">{s.text}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onCreate}
        className="px-8 py-3 bg-brand-600 text-white text-base font-medium rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-600/25 inline-flex items-center gap-2 transition-all hover:shadow-xl hover:shadow-brand-600/30"
      >
        <Plus className="w-5 h-5" /> New Bulk Upload
      </button>
    </div>
  );
}

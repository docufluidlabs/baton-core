/**
 * Batch Sidebar - Bulk Upload creator / editor
 *
 * Minimal panel modeled on FlowSidebar: name, target workflow (search + sync),
 * throttle defaults, stop-after-failures. Platform-agnostic by design - the
 * file is the trigger, wherever it was exported from. The file upload itself
 * happens later, from the Bulk Upload page's wizard.
 */
import { useState, useEffect } from 'react';
import {
  useWorkflows,
  createBatchProcessor,
  updateBatchProcessor,
  deleteBatchProcessor,
  syncSingleWorkflow,
  syncWorkflows,
  type BatchProcessor,
} from '@/hooks/useApi';
import { useSWRConfig } from 'swr';
import { X, Loader2, RefreshCw, Trash2, FileSpreadsheet } from 'lucide-react';
import clsx from 'clsx';
import { PortalSelect } from './FlowSidebar';

interface BatchSidebarProps {
  open: boolean;
  onClose: () => void;
  editingProcessor?: BatchProcessor | null;
  onSaved: () => void;
}

export function BatchSidebar({ open, onClose, editingProcessor, onSaved }: BatchSidebarProps) {
  const { data: workflowsData } = useWorkflows();
  const { mutate } = useSWRConfig();

  const workflows = (workflowsData?.workflows || []).filter((wf) => wf.maestroStatus === 'active');

  const [name, setName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [releaseCount, setReleaseCount] = useState('5');
  const [intervalMinutes, setIntervalMinutes] = useState('10');
  const [stopAfterFailures, setStopAfterFailures] = useState('5');
  // Both empty by default - see the explanatory copy next to the inputs.
  const [maxUnfinished, setMaxUnfinished] = useState('');
  const [overdueDays, setOverdueDays] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Pre-fill when editing / reset when creating
  useEffect(() => {
    if (editingProcessor) {
      setName(editingProcessor.name);
      setWorkflowId(editingProcessor.targetWorkflowId);
      setReleaseCount(String(editingProcessor.throttleReleaseCount));
      setIntervalMinutes(String(editingProcessor.throttleIntervalMinutes));
      setStopAfterFailures(String(editingProcessor.stopAfterConsecutiveFailures));
      setMaxUnfinished(editingProcessor.maxUnfinishedInstances ? String(editingProcessor.maxUnfinishedInstances) : '');
      setOverdueDays(editingProcessor.expectedDurationDays ? String(editingProcessor.expectedDurationDays) : '');
    } else {
      setName('');
      setWorkflowId('');
      setReleaseCount('5');
      setIntervalMinutes('10');
      setStopAfterFailures('5');
      setMaxUnfinished('');
      setOverdueDays('');
    }
    setConfirmingDelete(false);
    setDeleting(false);
  }, [editingProcessor, open]);

  async function handleSyncWorkflow() {
    setSyncing(true);
    try {
      if (workflowId) {
        await syncSingleWorkflow(workflowId);
      } else {
        await syncWorkflows();
      }
      mutate('/workflows');
    } catch {
      // error shown by global handler
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete() {
    if (!editingProcessor) return;
    setDeleting(true);
    try {
      await deleteBatchProcessor(editingProcessor.id);
      mutate('/batch-processors');
      onSaved();
      onClose();
    } catch {
      // error shown by global handler
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !workflowId) return;
    const release = parseInt(releaseCount, 10);
    const interval = parseInt(intervalMinutes, 10);
    const stopAfter = parseInt(stopAfterFailures, 10);
    const cap = parseInt(maxUnfinished, 10);
    const overdue = parseInt(overdueDays, 10);
    // Clearing the field turns the setting off - null clears it server-side.
    const capValue = Number.isFinite(cap) && cap > 0 ? cap : null;
    const overdueValue = Number.isFinite(overdue) && overdue > 0 ? overdue : null;

    setSaving(true);
    try {
      if (editingProcessor) {
        await updateBatchProcessor(editingProcessor.id, {
          name: name.trim(),
          targetWorkflowId: workflowId,
          throttleReleaseCount: Number.isFinite(release) && release > 0 ? release : undefined,
          throttleIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : undefined,
          stopAfterConsecutiveFailures: Number.isFinite(stopAfter) && stopAfter > 0 ? stopAfter : undefined,
          maxUnfinishedInstances: capValue,
          expectedDurationDays: overdueValue,
        });
      } else {
        await createBatchProcessor({
          name: name.trim(),
          targetWorkflowId: workflowId,
          throttleReleaseCount: Number.isFinite(release) && release > 0 ? release : undefined,
          throttleIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : undefined,
          stopAfterConsecutiveFailures: Number.isFinite(stopAfter) && stopAfter > 0 ? stopAfter : undefined,
          maxUnfinishedInstances: capValue,
          expectedDurationDays: overdueValue,
        });
      }
      mutate('/batch-processors');
      onSaved();
      onClose();
    } catch {
      // error shown by global handler
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* z-[65]/z-[70]: the settings drawer must open ABOVE the Runs & rows
          panel (z-50) - QA round 2 found the gear dimming the screen while the
          drawer mounted underneath the open logs panel. */}
      {open && <div className="fixed inset-0 bg-black/20 z-[65]" onClick={onClose} />}

      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full md:w-[400px] bg-white border-l border-gray-200 z-[70] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900">
              {editingProcessor ? 'Edit Bulk Upload' : 'New Bulk Upload'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(100vh - 140px)' }}>
          <p className="text-xs text-gray-500 leading-relaxed">
            Upload a CSV, XLSX or TSV file and Baton launches the target Docusign Workflow Builder
            workflow once per row, throttled to your settings.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Give your Bulk Upload a name..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Target Workflow */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Target Workflow</label>
            <div className="flex gap-2">
              <PortalSelect
                value={workflowId}
                onChange={setWorkflowId}
                placeholder="Select workflow..."
                className="flex-1 min-w-0"
                searchable
                options={workflows.map((wf) => ({ value: wf.id, label: wf.name }))}
              />
              <button
                onClick={handleSyncWorkflow}
                disabled={syncing}
                className="px-2.5 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500 disabled:opacity-50 shrink-0"
                title={workflowId ? 'Sync selected workflow' : 'Sync all workflows'}
              >
                <RefreshCw className={clsx('w-4 h-4', syncing && 'animate-spin')} />
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              Each file row launches one instance of this workflow.
            </p>
          </div>

          {/* Throttling */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Throttling</label>
            <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500">
              <span>Release</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={releaseCount}
                onChange={(e) => setReleaseCount(e.target.value.replace(/[^\d]/g, ''))}
                className="w-16 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
              />
              <span>rows every</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(e.target.value.replace(/[^\d]/g, ''))}
                className="w-16 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
              />
              <span>minutes</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Stop after consecutive failures</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={stopAfterFailures}
                onChange={(e) => setStopAfterFailures(e.target.value.replace(/[^\d]/g, ''))}
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
              />
              <span className="text-sm text-gray-500">failures in a row</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              A run stops automatically when this many rows fail back to back, so one bad file
              does not keep launching workflows.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Unfinished instances cap</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">No more than</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="off"
                value={maxUnfinished}
                onChange={(e) => setMaxUnfinished(e.target.value.replace(/[^\d]/g, ''))}
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none placeholder:text-gray-300"
              />
              <span className="text-sm text-gray-500">unfinished at once</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              Off by default on purpose: a signature workflow only completes when a human
              signs, so a cap alone could stall a batch forever. Set Mark as Overdue below
              as the release valve - an Overdue instance stops counting toward the cap, so
              the next row can launch.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Mark as Overdue</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">after</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="off"
                value={overdueDays}
                onChange={(e) => setOverdueDays(e.target.value.replace(/[^\d]/g, ''))}
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none placeholder:text-gray-300"
              />
              <span className="text-sm text-gray-500">days</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              Instances that take longer than this surface in Control Center as{' '}
              <span className="font-medium text-amber-700">Overdue</span> and free their cap
              slot. Postpone an Overdue instance there to keep waiting on it instead.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-4 border-t border-gray-100 bg-white space-y-3">
          {editingProcessor && confirmingDelete && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium mb-2">Delete this Bulk Upload?</p>
              <p className="text-xs text-red-600 mb-3">
                This cannot be undone. A Bulk Upload with a running run cannot be deleted - cancel
                the run first from Logs.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="flex-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white bg-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !workflowId}
              className="flex-1 px-4 py-2.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {editingProcessor ? 'Update Bulk Upload' : 'Create Bulk Upload'}
            </button>
          </div>
          {editingProcessor && !confirmingDelete && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Bulk Upload
            </button>
          )}
        </div>
      </div>
    </>
  );
}

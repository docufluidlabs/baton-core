import { useState, useMemo } from 'react';
import {
  useWorkflows,
  useWorkflowInstances,
  useConnections,
  syncWorkflows,
  syncSingleWorkflow,
  launchWorkflow,
  cancelInstance,
  connectPlatform,
  parseTriggerInputSchema,
  type Workflow,
} from '@/hooks/useApi';
import { timeAgo } from '@/lib/utils';
import { useSWRConfig } from 'swr';
import {
  RefreshCw,
  Play,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Search,
  Workflow as WorkflowIcon,
  Ban,
  ExternalLink,
  Pencil,
  Eye,
  LayoutList,
  LayoutGrid,
  AlertTriangle,
} from 'lucide-react';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import clsx from 'clsx';
import { useLayoutStore } from '@/stores/layoutStore';

// ─── Status helpers ──────────────────────────────────────────

const STATUS_CONFIG: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  completed: { dot: 'bg-green-500', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-l-green-500' },
  running:   { dot: 'bg-blue-500',  bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-l-blue-500'  },
  failed:    { dot: 'bg-red-500',   bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-l-red-500'   },
  cancelled: { dot: 'bg-orange-400',bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-l-orange-400'},
  active:    { dot: 'bg-green-500', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-l-green-500' },
  draft:     { dot: 'bg-gray-400',  bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-l-gray-400'  },
  paused:    { dot: 'bg-yellow-500',bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-l-yellow-500'},
};

function statusDot(status: string) {
  const cfg = STATUS_CONFIG[status];
  return <span className={clsx('inline-block w-2 h-2 rounded-full shrink-0', cfg?.dot || 'bg-gray-400')} />;
}

function statusBadge(status: string) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={clsx('text-[11px] font-medium px-2 py-0.5 rounded-full capitalize whitespace-nowrap', cfg?.bg, cfg?.text || 'bg-gray-50 text-gray-600')}>
      {status}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────

export default function WorkflowsPage() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <WorkflowsTab />
    </div>
  );
}

// ─── Workflows Tab ───────────────────────────────────────────

function WorkflowsTab() {
  const { data, isLoading } = useWorkflows();
  const { data: connData } = useConnections();
  const { mutate } = useSWRConfig();
  const [syncing, setSyncing] = useState(false);
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const viewMode = useLayoutStore((s) => s.workflowViewMode);
  const setViewMode = useLayoutStore((s) => s.setWorkflowViewMode);

  const workflows = useMemo(
    () => (data?.workflows || []).filter((wf) => wf.maestroStatus === 'active'),
    [data?.workflows],
  );

  const filteredWorkflows = useMemo(() => {
    if (!search.trim()) return workflows;
    const q = search.toLowerCase();
    return workflows.filter(
      (wf) => wf.name.toLowerCase().includes(q) || wf.description?.toLowerCase().includes(q),
    );
  }, [workflows, search]);

  const byDate = (a: Workflow, b: Workflow) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const hasApiParams = (wf: Workflow) => parseTriggerInputSchema(wf.triggerInputSchema).length > 0;
  const apiReady = useMemo(() => filteredWorkflows.filter(hasApiParams).sort(byDate), [filteredWorkflows]);
  const apiNotReady = useMemo(() => filteredWorkflows.filter((wf) => !hasApiParams(wf)).sort(byDate), [filteredWorkflows]);

  async function handleSync() {
    const hasDocusign = connData?.connections?.some((c) => c.platform === 'docusign');
    if (!hasDocusign) {
      await connectPlatform('docusign');
      return;
    }
    setSyncing(true);
    try {
      await syncWorkflows();
      mutate('/workflows');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Workflow Checker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sync workflows from Docusign Workflow Builder, create test pairs, and launch.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 hover:shadow-md active:scale-[0.98] disabled:opacity-50 flex items-center gap-2 transition-all duration-150"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync from Docusign
        </button>
      </div>

      {workflows.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workflows..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode('list')}
              className={clsx(
                'w-8 h-8 flex items-center justify-center transition-colors',
                viewMode === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50',
              )}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={clsx(
                'w-8 h-8 flex items-center justify-center transition-colors',
                viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50',
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        viewMode === 'list' ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex gap-4">
            {[0, 1].map((col) => (
              <div key={col} className="flex-1 flex flex-col gap-4">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-44 animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        )
      ) : workflows.length === 0 ? (
        <EmptyState onSync={handleSync} syncing={syncing} />
      ) : filteredWorkflows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Search className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No workflows matching &ldquo;{search}&rdquo;</p>
          <button onClick={() => setSearch('')} className="text-xs text-brand-600 hover:underline mt-2">
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {apiReady.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-bold text-gray-900 whitespace-nowrap">API Parameters Ready</h2>
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-900">{apiReady.length}</span>
              </div>
              {viewMode === 'list' ? (
                <div className="space-y-3">
                  {apiReady.map((wf) => (
                    <WorkflowCard
                      key={wf.id}
                      workflow={wf}
                      expanded={expandedWorkflow === wf.id}
                      onToggle={() => setExpandedWorkflow(expandedWorkflow === wf.id ? null : wf.id)}
                    />
                  ))}
                </div>
              ) : (
                <MasonryGrid workflows={apiReady} onSync={async (id) => { await syncSingleWorkflow(id); mutate('/workflows'); }} />
              )}
            </section>
          )}
          {apiNotReady.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-bold text-gray-900 whitespace-nowrap">API Parameters Not Set Up</h2>
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-900">{apiNotReady.length}</span>
              </div>
              {viewMode === 'list' ? (
                <div className="space-y-3">
                  {apiNotReady.map((wf) => (
                    <WorkflowCard
                      key={wf.id}
                      workflow={wf}
                      expanded={expandedWorkflow === wf.id}
                      onToggle={() => setExpandedWorkflow(expandedWorkflow === wf.id ? null : wf.id)}
                    />
                  ))}
                </div>
              ) : (
                <MasonryGrid workflows={apiNotReady} onSync={async (id) => { await syncSingleWorkflow(id); mutate('/workflows'); }} />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Workflow Card ────────────────────────────────────────────

function WorkflowCard({
  workflow,
  expanded,
  onToggle,
}: {
  workflow: Workflow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [launching, setLaunching] = useState(false);
  const [syncingOne, setSyncingOne] = useState(false);
  const [triggerInputs, setTriggerInputs] = useState<Record<string, string>>({});
  const { mutate } = useSWRConfig();

  const schemaFields = useMemo(() => parseTriggerInputSchema(workflow.triggerInputSchema), [workflow.triggerInputSchema]);

  const requiredFilled = schemaFields
    .filter((f) => f.required)
    .every((f) => (triggerInputs[f.key] || '').trim());

  async function handleLaunch() {
    if (!requiredFilled) return;
    setLaunching(true);
    try {
      const inputs: Record<string, unknown> = {};
      for (const field of schemaFields) {
        const val = triggerInputs[field.key];
        if (val !== undefined && val !== '')
          inputs[field.key] = field.type === 'number' ? Number(val) : val;
      }
      const instanceName = `Test - ${
        Object.values(triggerInputs).filter(Boolean).join(', ') ||
        new Date().toLocaleTimeString()
      }`;
      await launchWorkflow(workflow.id, instanceName, inputs);
      mutate(`/workflows/${workflow.id}/instances?live=true`);
      mutate('/workflows');
      mutate('/instances/counts');
      setTriggerInputs({});
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div
      className={clsx(
        'bg-white rounded-xl border transition-all',
        expanded
          ? 'border-brand-200 shadow-md ring-1 ring-brand-100'
          : 'border-gray-200 hover:border-gray-300',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 cursor-pointer select-none" onClick={onToggle}>
        <ChevronRight
          className={clsx(
            'w-5 h-5 transition-all duration-200',
            expanded ? 'rotate-90 text-brand-500' : 'text-gray-400',
          )}
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate text-[15px]">{workflow.name}</h3>
          {workflow.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{workflow.description}</p>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <span className="inline-flex items-center gap-1.5 w-[70px]">
            {statusDot(workflow.maestroStatus)}
            <span
              className={clsx(
                'text-[11px] font-medium capitalize',
                STATUS_CONFIG[workflow.maestroStatus]?.text || 'text-gray-500',
              )}
            >
              {workflow.maestroStatus}
            </span>
          </span>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="animate-slide-down">
          {/* Action bar */}
          <div className="flex items-center gap-1 px-4 py-2 border-t border-b border-gray-100 bg-gray-50/60">
            <ToolbarButton
              onClick={async () => {
                setSyncingOne(true);
                try {
                  await syncSingleWorkflow(workflow.id);
                  mutate('/workflows');
                } finally {
                  setSyncingOne(false);
                }
              }}
              disabled={syncingOne}
              icon={
                syncingOne ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )
              }
              label="Sync"
            />
            {workflow.maestroInstancesUrl && (
              <ToolbarLink
                href={workflow.maestroInstancesUrl}
                icon={<Eye className="w-3.5 h-3.5" />}
                label="Instances"
              />
            )}
            {workflow.maestroUrl && (
              <ToolbarLink
                href={workflow.maestroUrl}
                icon={<Pencil className="w-3.5 h-3.5" />}
                label="Edit Workflow"
              />
            )}
          </div>

          <div className="p-5 space-y-5">
            {/* Trigger inputs */}
            {schemaFields.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {schemaFields.map((field) => (
                  <div key={field.key}>
                    <label className="flex items-baseline gap-1.5 text-xs font-medium text-gray-600 mb-1.5">
                      {field.label}
                      <span className="text-[10px] font-normal px-1 py-px rounded bg-gray-100 text-gray-400 leading-none">
                        {field.dataType}
                      </span>
                      {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.enum ? (
                      <select
                        value={triggerInputs[field.key] || ''}
                        onChange={(e) =>
                          setTriggerInputs({ ...triggerInputs, [field.key]: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 bg-white outline-none"
                      >
                        <option value="">Select...</option>
                        {field.enum.map((v: string) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={triggerInputs[field.key] || field.defaultValue || ''}
                        onChange={(e) =>
                          setTriggerInputs({ ...triggerInputs, [field.key]: e.target.value })
                        }
                        placeholder={field.defaultValue || field.key}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
                        onKeyDown={(e) => e.key === 'Enter' && handleLaunch()}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleLaunch}
              disabled={launching || !requiredFilled}
              className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 hover:shadow-md active:scale-[0.98] disabled:opacity-50 flex items-center gap-2 transition-all duration-150 shadow-sm"
            >
              {launching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> Run Test
                </>
              )}
            </button>

            <LaunchHistory workflowId={workflow.id} maestroBaseUrl={workflow.maestroInstancesUrl} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workflow Grid Card (flip) ──────────────────────────────

const INST_STATUS = {
  completed: { dot: 'bg-emerald-500', border: 'border-l-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: 'bg-emerald-500' },
  running:   { dot: 'bg-blue-500',    border: 'border-l-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700',    bar: 'bg-blue-500'   },
  failed:    { dot: 'bg-red-500',     border: 'border-l-red-500',     bg: 'bg-red-50',     text: 'text-red-700',     bar: 'bg-red-500'    },
  cancelled: { dot: 'bg-amber-500',   border: 'border-l-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-700',   bar: 'bg-amber-500'  },
} as const;
const INST_FALLBACK = { dot: 'bg-gray-400', border: 'border-l-gray-300', bg: 'bg-gray-50', text: 'text-gray-600', bar: 'bg-gray-400' };
const instCfg = (s: string) => INST_STATUS[s as keyof typeof INST_STATUS] ?? INST_FALLBACK;

function MasonryGrid({ workflows, onSync }: { workflows: Workflow[]; onSync: (id: string) => Promise<void> }) {
  const cols = 2;
  const columns = useMemo(() => {
    const result: Workflow[][] = Array.from({ length: cols }, () => []);
    workflows.forEach((wf, i) => result[i % cols].push(wf));
    return result;
  }, [workflows]);

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {columns.map((col, ci) => (
        <div key={ci} className="md:flex-1 flex flex-col gap-4">
          {col.map((wf) => (
            <WorkflowGridCard key={wf.id} workflow={wf} onSync={async () => onSync(wf.id)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function WorkflowGridCard({ workflow, onSync }: { workflow: Workflow; onSync: () => Promise<void> }) {
  const [flipped, setFlipped] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [triggerInputs, setTriggerInputs] = useState<Record<string, string>>({});
  const { mutate } = useSWRConfig();

  function flip() {
    if (!flipped) {
      setShowBack(true);
      setFlipped(true);
    } else {
      setFlipped(false);
      setTimeout(() => setShowBack(false), 600);
    }
  }

  const schemaFields = useMemo(() => parseTriggerInputSchema(workflow.triggerInputSchema), [workflow.triggerInputSchema]);

  const requiredFilled = schemaFields
    .filter((f) => f.required)
    .every((f) => (triggerInputs[f.key] || '').trim());

  async function handleLaunch() {
    if (!requiredFilled) return;
    setLaunching(true);
    try {
      const inputs: Record<string, unknown> = {};
      for (const field of schemaFields) {
        const val = triggerInputs[field.key];
        if (val !== undefined && val !== '')
          inputs[field.key] = field.type === 'number' ? Number(val) : val;
      }
      const instanceName = `Test - ${
        Object.values(triggerInputs).filter(Boolean).join(', ') ||
        new Date().toLocaleTimeString()
      }`;
      await launchWorkflow(workflow.id, instanceName, inputs);
      mutate(`/workflows/${workflow.id}/instances?live=true`);
      mutate('/workflows');
      mutate('/instances/counts');
      setTriggerInputs({});
      // Auto-flip to instances so user sees the new running instance
      setShowBack(true);
      setFlipped(true);
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div style={{ perspective: '1200px' }}>
      <div
        className="relative"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          minHeight: showBack ? '280px' : '0px',
          transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* ── Side A: Workflow & Launch ────────────── */}
        <div
          className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-colors overflow-hidden flex flex-col min-h-[150px]"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="px-3.5 pt-3.5 pb-3 flex-1 flex flex-col">
            {/* Header row */}
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg shrink-0 ring-1 ring-purple-100/60 mt-0.5">
                <PlatformIcon platform="docusign" size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-3">{workflow.name}</h3>
              </div>
              <span className="inline-flex items-center gap-1 shrink-0">
                {statusDot(workflow.maestroStatus)}
                <span className={clsx('text-[10px] font-medium capitalize', STATUS_CONFIG[workflow.maestroStatus]?.text || 'text-gray-500')}>
                  {workflow.maestroStatus}
                </span>
              </span>
            </div>

          </div>

          {/* Trigger inputs */}
          {schemaFields.length > 0 && (
            <div className="px-3.5 pb-2 space-y-1.5">
              {schemaFields.map((field) => (
                <div key={field.key} className="flex items-center gap-2">
                  <label className="text-[10px] font-medium text-gray-500 w-[80px] shrink-0 truncate" title={field.label}>
                    {field.label}{field.required && <span className="text-red-400">*</span>}
                  </label>
                  {field.enum ? (
                    <select
                      value={triggerInputs[field.key] || ''}
                      onChange={(e) => setTriggerInputs({ ...triggerInputs, [field.key]: e.target.value })}
                      className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:ring-1 focus:ring-brand-500 bg-white outline-none"
                    >
                      <option value="">Select...</option>
                      {field.enum.map((v: string) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={triggerInputs[field.key] || field.defaultValue || ''}
                      onChange={(e) => setTriggerInputs({ ...triggerInputs, [field.key]: e.target.value })}
                      placeholder={field.defaultValue || field.key}
                      className="flex-1 min-w-0 px-2 py-1 text-[11px] border border-gray-200 rounded-md focus:ring-1 focus:ring-brand-500 focus:border-transparent outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && handleLaunch()}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions footer */}
          <div className="flex items-center gap-1.5 px-3.5 py-2 border-t border-gray-100 bg-gray-50/50">
            <button
              onClick={handleLaunch}
              disabled={launching || !requiredFilled}
              className="px-3 py-1.5 bg-brand-600 text-white text-[11px] font-medium rounded-md hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 inline-flex items-center gap-1.5 transition-all shadow-sm"
            >
              {launching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {launching ? 'Running...' : 'Run Test'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setSyncing(true); onSync().finally(() => setSyncing(false)); }}
              disabled={syncing}
              className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
              title="Sync"
            >
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            {workflow.maestroUrl && (
              <a href={workflow.maestroUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Edit in Workflow Builder">
                <Pencil className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={flip}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-md transition-colors"
            >
              Instances &rarr;
            </button>
          </div>
        </div>

        {/* ── Side B: Instances ───────────────────── */}
        <div
          className="absolute inset-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {showBack && <GridCardInstances workflowId={workflow.id} maestroBaseUrl={workflow.maestroInstancesUrl} onFlipBack={flip} schemaKeys={schemaFields.map((f) => f.key)} />}
        </div>
      </div>
    </div>
  );
}

// ─── Grid Card Instances (Side B) ───────────────────────────

function GridCardInstances({ workflowId, maestroBaseUrl, onFlipBack, schemaKeys }: {
  workflowId: string;
  maestroBaseUrl?: string;
  onFlipBack: () => void;
  schemaKeys?: string[];
}) {
  const { data, isLoading, mutate: mutateInstances } = useWorkflowInstances(workflowId, true);
  const { mutate } = useSWRConfig();
  const instances = data?.instances || [];
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());
  function toggleParams(id: string) {
    setExpandedParams((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 shrink-0">
        <h4 className="text-[12px] font-semibold text-gray-700 flex-1">
          Instances {!isLoading && <span className="text-gray-400 font-normal">({instances.length})</span>}
        </h4>
        <button
          onClick={(e) => { e.stopPropagation(); mutateInstances(); }}
          className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Instance list */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
        </div>
      ) : instances.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <Clock className="w-5 h-5 text-gray-300 mb-2" />
          <p className="text-[11px] text-gray-400">No instances yet</p>
          <p className="text-[10px] text-gray-300 mt-0.5">Run a test to see instances here</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {instances.slice(0, 10).map((inst) => {
            const sc = instCfg(inst.status);
            const monitorUrl = maestroBaseUrl && inst.maestroInstanceId
              ? `${maestroBaseUrl}/monitor/${inst.maestroInstanceId}`
              : undefined;

            const rawStep = inst.lastCompletedStep;
            const hasTotalSteps = inst.totalSteps != null && inst.totalSteps > 0;
            const progressPercent = hasTotalSteps
              ? inst.status === 'completed'
                ? 100
                : rawStep != null && rawStep >= 0
                  ? Math.round(((rawStep + 1) / inst.totalSteps!) * 100)
                  : 0
              : null;
            const stepNumber = inst.status === 'completed'
              ? inst.totalSteps
              : rawStep != null && rawStep >= 0 ? rawStep + 1 : 0;

            return (
              <div key={inst.id} className={clsx(
                'rounded-md border border-gray-100 overflow-hidden border-l-[3px]', sc.border,
              )}>
                <div className="px-2.5 py-2">
                  {/* Name + badge */}
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-medium text-gray-800 truncate flex-1">{inst.instanceName}</p>
                    <span className={clsx('text-[9px] font-semibold px-1.5 py-[2px] rounded capitalize shrink-0 leading-none', sc.bg, sc.text)}>
                      {inst.status}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {progressPercent !== null && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="flex-1 h-[2px] bg-gray-100 rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full', sc.bar)} style={{ width: `${progressPercent}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-400 tabular-nums">{stepNumber}/{inst.totalSteps}</span>
                      <span className="text-[9px] text-gray-300">{timeAgo(inst.startedAt)}</span>
                    </div>
                  )}

                  {/* Error */}
                  {inst.status === 'failed' && inst.errorMessage && (
                    <div className="flex items-start gap-1 mt-1.5 bg-red-50/80 rounded px-1.5 py-1">
                      <AlertTriangle className="w-2.5 h-2.5 text-red-400 shrink-0 mt-px" />
                      <p className="text-[9px] text-red-500 line-clamp-1">{inst.errorMessage}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 mt-1.5">
                    {inst.status === 'running' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancellingId(inst.id);
                          cancelInstance(inst.id).then(() => mutateInstances()).finally(() => setCancellingId(null));
                        }}
                        disabled={cancellingId === inst.id}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      >
                        {cancellingId === inst.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Ban className="w-2.5 h-2.5" />}
                        Cancel
                      </button>
                    )}
                    {(inst.status === 'failed' || inst.status === 'cancelled') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRetryingId(inst.id);
                          launchWorkflow(inst.workflowId, `Retry - ${inst.instanceName}`, inst.inputData)
                            .then(() => { mutateInstances(); mutate('/workflows'); mutate('/instances/counts'); }).finally(() => setRetryingId(null));
                        }}
                        disabled={retryingId === inst.id}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium text-brand-600 hover:bg-brand-50 rounded transition-colors disabled:opacity-50"
                      >
                        {retryingId === inst.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                        Try Again
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 ml-auto">
                      {inst.inputData && Object.keys(inst.inputData).length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleParams(inst.id); }}
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          {expandedParams.has(inst.id) ? 'Hide' : 'Params'}
                        </button>
                      )}
                      {monitorUrl && (
                        <a href={monitorUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                          <Eye className="w-2.5 h-2.5" /> Detail
                        </a>
                      )}
                      {inst.instanceUrl && (
                        <a href={inst.instanceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                          <ExternalLink className="w-2.5 h-2.5" /> Open
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {expandedParams.has(inst.id) && inst.inputData && (() => {
                  const entries = schemaKeys && schemaKeys.length > 0
                    ? schemaKeys.flatMap((k) => k in inst.inputData! ? [[k, inst.inputData![k]] as [string, unknown]] : [])
                    : Object.entries(inst.inputData);
                  if (!entries.length) return null;
                  return (
                    <div className="border-t border-gray-100">
                      {entries.map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 px-2.5 py-1 odd:bg-gray-50/60">
                          <span className="text-[9px] font-medium text-gray-400 w-[90px] shrink-0 truncate" title={key}>{key}</span>
                          <span className="text-[10px] text-gray-800 font-mono truncate">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '-')}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer — flip back */}
      <button
        onClick={onFlipBack}
        className="w-full py-2 text-[10px] text-gray-400 hover:text-brand-600 hover:bg-gray-100/80 transition-colors border-t border-gray-100 text-center shrink-0"
      >
        &larr; Back to workflow
      </button>
    </>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1.5 text-xs font-medium text-gray-500 rounded-md hover:bg-brand-50 hover:text-brand-700 hover:shadow-sm disabled:opacity-50 flex items-center gap-1.5 transition-all"
    >
      {icon} {label}
    </button>
  );
}

function ToolbarLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="px-2.5 py-1.5 text-xs font-medium text-gray-500 rounded-md hover:bg-brand-50 hover:text-brand-700 hover:shadow-sm inline-flex items-center gap-1.5 transition-all"
    >
      {icon} {label}
    </a>
  );
}

// ─── Launch History ───────────────────────────────────────────

function LaunchHistory({
  workflowId,
  maestroBaseUrl,
}: {
  workflowId: string;
  maestroBaseUrl?: string;
}) {
  const { data, isLoading, mutate: mutateInstances } = useWorkflowInstances(workflowId, true);
  const instances = data?.instances || [];
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="py-4 text-center">
        <Loader2 className="w-4 h-4 animate-spin inline text-gray-400" />
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="py-4 text-center border border-dashed border-gray-200 rounded-lg">
        <p className="text-xs text-gray-400">No test runs yet. Use Run Test above to start.</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Completion History
      </h4>
      <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {instances.slice(0, 5).map((inst) => {
          const monitorUrl =
            maestroBaseUrl && inst.maestroInstanceId
              ? `${maestroBaseUrl}/monitor/${inst.maestroInstanceId}`
              : undefined;

          return (
            <div
              key={inst.id}
              className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-gray-50/50 transition-colors"
            >
              <InstanceStatusIcon status={inst.status} size="sm" />
              <span className="flex-1 text-sm text-gray-700 truncate">{inst.instanceName}</span>

              {inst.totalSteps != null && inst.totalSteps > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 w-20">
                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        STATUS_CONFIG[inst.status]?.dot || 'bg-gray-400',
                      )}
                      style={{
                        width: `${
                          inst.status === 'completed'
                            ? 100
                            : Math.round(
                                (((inst.lastCompletedStep ?? -1) + 1) / inst.totalSteps) * 100,
                              )
                        }%`,
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 tabular-nums">
                    {inst.status === 'completed'
                      ? inst.totalSteps
                      : (inst.lastCompletedStep ?? -1) + 1}
                    /{inst.totalSteps}
                  </span>
                </div>
              )}

              <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
                {timeAgo(inst.startedAt)}
              </span>

              {statusBadge(inst.status)}

              <div className="flex items-center gap-1.5 shrink-0">
                {inst.status === 'running' && (
                  <button
                    onClick={async () => {
                      setCancellingId(inst.id);
                      try {
                        await cancelInstance(inst.id);
                        mutateInstances();
                      } finally {
                        setCancellingId(null);
                      }
                    }}
                    disabled={cancellingId === inst.id}
                    className="px-1.5 py-1 text-[11px] font-medium text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center gap-1"
                  >
                    {cancellingId === inst.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Ban className="w-3 h-3" />
                    )}
                    Cancel
                  </button>
                )}
                {monitorUrl && (
                  <a
                    href={monitorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors inline-flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" /> Detail
                  </a>
                )}
                {inst.instanceUrl && (
                  <a
                    href={inst.instanceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Open
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────

function InstanceStatusIcon({
  status,
  size = 'md',
}: {
  status: string;
  size?: 'sm' | 'md';
}) {
  const cls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  switch (status) {
    case 'completed':
      return <CheckCircle className={clsx(cls, 'text-green-500')} />;
    case 'running':
      return <Loader2 className={clsx(cls, 'text-blue-500 animate-spin')} />;
    case 'failed':
      return <XCircle className={clsx(cls, 'text-red-500')} />;
    case 'cancelled':
      return <Ban className={clsx(cls, 'text-orange-500')} />;
    default:
      return <Clock className={clsx(cls, 'text-gray-400')} />;
  }
}

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <WorkflowIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-1">No workflows synced</h3>
      <p className="text-sm text-gray-500 mb-6">
        Connect Docusign and sync your Workflow Builder workflows to get started.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 hover:shadow-md active:scale-[0.98] disabled:opacity-50 inline-flex items-center gap-2 transition-all duration-150"
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        Sync from Docusign
      </button>
    </div>
  );
}

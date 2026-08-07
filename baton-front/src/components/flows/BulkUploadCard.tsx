/**
 * Bulk Upload Card - one processor on the Bulk Upload page.
 *
 * Bulk Upload is an operated tool (you initiate it), unlike Flow Builder's
 * set-and-forget automations - so its card is built for operating: identity +
 * destination workflow up top, a row-centric progress strip while a run is
 * active, and the last run's outcome when idle. Row-by-row detail lives one
 * click away in the runs sidebar.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Pause, Play, Settings, FileText, Upload } from 'lucide-react';
import batonLogo from '@/assets/baton.svg';
import { PlatformIcon } from '@/components/ui/PlatformIcon';
import type { BatchProcessor } from '@/hooks/useApi';

export type BulkUploadCardStatus = 'idle' | 'queued' | 'running' | 'paused' | 'done';

const STATUS_CFG: Record<BulkUploadCardStatus, { badgeBg: string; badgeText: string; label: string }> = {
  idle:    { badgeBg: 'bg-gray-50',   badgeText: 'text-gray-500',   label: 'idle' },
  queued:  { badgeBg: 'bg-blue-50',   badgeText: 'text-blue-600',   label: 'queued' },
  running: { badgeBg: 'bg-blue-50',   badgeText: 'text-blue-700',   label: 'running' },
  paused:  { badgeBg: 'bg-yellow-50', badgeText: 'text-yellow-700', label: 'paused' },
  done:    { badgeBg: 'bg-green-50',  badgeText: 'text-green-700',  label: 'done' },
};

const WF_STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-400',
  paused: 'bg-amber-400',
  inactive: 'bg-gray-400',
  error: 'bg-red-400',
};

/**
 * The destination workflow as a Docusign-branded chip - dark navy (from the
 * Docusign mark), the Docusign logo, and the workflow name in white bold so
 * the target reads at a glance.
 */
function WorkflowChip({ name, status }: { name: string; status?: string }) {
  return (
    <span className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-lg bg-[#1B0730] max-w-full min-w-0">
      {/* White tile behind the mark - its own navy path would vanish against
          the chip background otherwise. */}
      <span className="w-[18px] h-[18px] rounded-[5px] bg-white flex items-center justify-center shrink-0">
        <PlatformIcon platform="docusign" size={12} />
      </span>
      <span className="text-[12px] font-bold text-white truncate">{name}</span>
      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', WF_STATUS_DOT[status ?? ''] || WF_STATUS_DOT.inactive)} />
    </span>
  );
}

interface BulkUploadCardProps {
  processor: BatchProcessor;
  workflowName: string;
  workflowStatus?: string;
  onUpload: () => void;
  /** Pause/resume the given runs of this Bulk Upload (per-strip buttons pass
   *  one id; the section-level Pause all/Resume all passes every match). */
  onRunAction?: (runIds: string[], action: 'pause' | 'resume') => void;
  /** Open the runs sidebar drilled straight into one run's rows. */
  onViewRows?: (runId: string) => void;
  onViewRuns: () => void;
  onEdit: () => void;
}

/** How many run strips show before the rest collapse behind an expander. */
const MAX_VISIBLE_STRIPS = 2;

export function BulkUploadCard({ processor: p, workflowName, workflowStatus, onUpload, onRunAction, onViewRows, onViewRuns, onEdit }: BulkUploadCardProps) {
  // Runs execute concurrently - every active run gets its OWN strip with its
  // own bar and status (user decision: side-by-side beats summed-together).
  const activeRuns = p.activeRuns ?? [];
  const queuedRuns = p.queuedRuns ?? [];
  const anyRunning = activeRuns.some((r) => r.status === 'running');
  const status: BulkUploadCardStatus =
    anyRunning ? 'running' :
    activeRuns.length > 0 ? 'paused' :
    queuedRuns.length > 0 ? 'queued' :
    p.lastRun?.status === 'completed' ? 'done' : 'idle';
  const cfg = STATUS_CFG[status];

  const [showAllRuns, setShowAllRuns] = useState(false);
  const visibleRuns = showAllRuns ? activeRuns : activeRuns.slice(0, MAX_VISIBLE_STRIPS);
  const hiddenCount = activeRuns.length - visibleRuns.length;

  const runningIds = activeRuns.filter((r) => r.status === 'running').map((r) => r.id);
  const pausedIds = activeRuns.filter((r) => r.status === 'paused').map((r) => r.id);

  // "per file": each run throttles independently, so with several files in
  // flight the combined launch rate is (files x this rate).
  const throttleLine = `throttle: ${p.throttleReleaseCount} ${p.throttleReleaseCount === 1 ? 'row' : 'rows'} / ${p.throttleIntervalMinutes} min per file`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header: identity + destination + actions */}
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={batonLogo} alt="" className="w-6 h-6 shrink-0" />
            <h3 className="text-[15px] font-semibold text-gray-900 truncate">{p.name}</h3>
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0', cfg.badgeBg, cfg.badgeText)}>
              {cfg.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 min-w-0">
            <WorkflowChip name={workflowName} status={workflowStatus} />
            <span className="shrink-0">{throttleLine}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onViewRuns}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Runs & rows
          </button>
          <button
            onClick={onEdit}
            title="Settings"
            className="p-2 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onUpload}
            title={activeRuns.length > 0 ? 'Each file starts its own run immediately - runs execute at the same time' : undefined}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-brand-600 text-white hover:bg-brand-700 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" /> Upload file
          </button>
        </div>
      </div>

      {/* Active runs - one strip per run, each with its own bar and status */}
      {activeRuns.length > 0 ? (
        <div className="border-t border-gray-100 bg-blue-50/30 px-5 py-3.5">
          {activeRuns.length > 1 && (
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <p className="text-xs font-medium text-gray-800">
                {activeRuns.length} files processing at the same time
              </p>
              <span className="flex items-center gap-1.5 shrink-0">
                {runningIds.length > 1 && onRunAction && (
                  <button
                    onClick={() => onRunAction(runningIds, 'pause')}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                  >
                    <Pause className="w-3 h-3" /> Pause all
                  </button>
                )}
                {pausedIds.length > 1 && onRunAction && (
                  <button
                    onClick={() => onRunAction(pausedIds, 'resume')}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                  >
                    <Play className="w-3 h-3" /> Resume all
                  </button>
                )}
              </span>
            </div>
          )}

          <div className="space-y-3">
            {visibleRuns.map((r) => (
              <RunStrip key={r.id} run={r} onRunAction={onRunAction} onViewRows={onViewRows} />
            ))}
          </div>

          {(hiddenCount > 0 || showAllRuns) && activeRuns.length > MAX_VISIBLE_STRIPS && (
            <button
              onClick={() => setShowAllRuns((v) => !v)}
              className="mt-2.5 w-full flex items-center justify-center gap-1 py-1 text-[11px] font-medium text-gray-500 hover:text-brand-600 hover:bg-white/60 rounded-lg transition-colors"
            >
              {showAllRuns
                ? <>Show fewer runs</>
                : <>Show all {activeRuns.length} runs ({hiddenCount} more)</>}
            </button>
          )}
        </div>
      ) : (
        <div className="border-t border-gray-100 px-5 py-2.5">
          <p className="text-[11px] text-gray-400 truncate">
            {p.lastRun
              ? `Last run · ${p.lastRun.fileName} · ${p.lastRun.counts.completed}/${p.lastRun.selectedRows} completed` +
                (p.lastRun.counts.failed > 0 ? ` · ${p.lastRun.counts.failed} failed` : '')
              : 'No runs yet - upload a file to launch this workflow once per row.'}
          </p>
        </div>
      )}

      {/* Transitional: pre-concurrency queued runs, promoted within ~30s */}
      {queuedRuns.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-2">
          <p className="text-[11px] text-gray-500 truncate">
            <span className="font-medium text-blue-600">Starting shortly:</span>{' '}
            {queuedRuns.slice(0, 2).map((r, i) => (
              <span key={r.id}>
                {i > 0 && ' · '}
                run #{r.runNumber} · {r.fileName} · {r.selectedRows} rows
              </span>
            ))}
            {queuedRuns.length > 2 && ` · +${queuedRuns.length - 2} more`}
          </p>
        </div>
      )}

      {/* Sequence summary across every run of this Bulk Upload */}
      {(p.runsTotal ?? 0) > 0 && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-1.5">
          <p className="text-[10px] text-gray-400 tabular-nums">
            {p.runsTotal} {p.runsTotal === 1 ? 'run' : 'runs'} · {p.rowsTotal ?? 0} rows uploaded · {p.rowsProcessed ?? 0} processed
          </p>
        </div>
      )}
    </div>
  );
}

/** One active run: its own header line, progress bar, counters, countdown and
 *  pause/resume control - runs execute concurrently, so each reads on its own. */
function RunStrip({ run: r, onRunAction, onViewRows }: {
  run: NonNullable<BatchProcessor['activeRuns']>[number];
  onRunAction?: (runIds: string[], action: 'pause' | 'resume') => void;
  onViewRows?: (runId: string) => void;
}) {
  const c = r.counts;
  // "Processed" = no longer waiting (launched, skipped, or cancelled). Counting
  // launches alone would miscount: cancelled rows may never have launched, and
  // skipped rows never will - selectedRows minus queued is the only fraction
  // that monotonically reaches its denominator.
  const processed = Math.max(0, (r.selectedRows ?? 0) - c.queued);
  const barTotal = c.queued + c.running + c.completed + c.failed;
  const pct = (n: number) => (barTotal > 0 ? (n / barTotal) * 100 : 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <p className="text-xs text-gray-600 truncate">
          <span className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle', r.status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-yellow-400')} />
          <span className="font-medium text-gray-800">{r.fileName}</span>
          <span className="text-gray-400"> · run #{r.runNumber}</span>
          {r.startedAt && (
            <span className="text-gray-400"> · started {new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          )}
          {r.status === 'paused' && <span className="text-yellow-700 font-medium"> · paused</span>}
        </p>
        <span className="flex items-center gap-1.5 shrink-0">
          {onViewRows && (
            <button
              onClick={() => onViewRows(r.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:text-brand-600 hover:bg-white rounded-lg border border-gray-200 transition-colors"
            >
              <FileText className="w-3 h-3" /> See rows
            </button>
          )}
          {onRunAction && (
            r.status === 'running' ? (
              <button
                onClick={() => onRunAction([r.id], 'pause')}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            ) : (
              <button
                onClick={() => onRunAction([r.id], 'resume')}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            )
          )}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-gray-100">
          {pct(c.queued) > 0 && <div className="bg-yellow-300 shrink-0" style={{ width: `${pct(c.queued)}%` }} />}
          {pct(c.running) > 0 && <div className="bg-blue-400 shrink-0 animate-pulse" style={{ width: `${pct(c.running)}%` }} />}
          {pct(c.completed) > 0 && <div className="bg-green-500 shrink-0" style={{ width: `${pct(c.completed)}%` }} />}
          {pct(c.failed) > 0 && <div className="bg-red-500 shrink-0" style={{ width: `${pct(c.failed)}%` }} />}
        </div>
        <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
          {processed}/{r.selectedRows} rows processed
        </span>
      </div>

      <p className="text-[11px] mt-1.5 tabular-nums">
        <Counter n={c.queued} label="queued" cls="text-yellow-600" />
        <Dot />
        <Counter n={c.running} label="running" cls="text-blue-600" />
        <Dot />
        <Counter n={c.completed} label="completed" cls="text-green-600" />
        <Dot />
        <Counter n={c.failed} label="failed" cls="text-red-500" />
        <Dot />
        <Counter n={c.cancelled} label="cancelled" cls="text-gray-400" />
        {r.status === 'running' && r.nextReleaseAt && c.queued > 0 && (
          <span className="text-blue-500"><Dot /> next release in <ReleaseCountdown nextReleaseAt={r.nextReleaseAt} /></span>
        )}
      </p>
    </div>
  );
}

function Counter({ n, label, cls }: { n: number; label: string; cls: string }) {
  return <span className={n > 0 ? cls : 'text-gray-300'}><span className="font-semibold">{n}</span> {label}</span>;
}

function Dot() {
  return <span className="text-gray-300"> · </span>;
}

/** mm:ss countdown to the dispatcher's next release. */
function ReleaseCountdown({ nextReleaseAt }: { nextReleaseAt: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function calc() {
      const diff = new Date(nextReleaseAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('00:00'); return; }
      const secs = Math.ceil(diff / 1000);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      setLabel(`${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [nextReleaseAt]);

  return <>{label}</>;
}

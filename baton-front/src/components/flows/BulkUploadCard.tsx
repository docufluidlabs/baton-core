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
  onPause?: () => void;
  onResume?: () => void;
  onViewRuns: () => void;
  onEdit: () => void;
}

export function BulkUploadCard({ processor: p, workflowName, workflowStatus, onUpload, onPause, onResume, onViewRuns, onEdit }: BulkUploadCardProps) {
  const activeRun = p.activeRun;
  const queuedRuns = p.queuedRuns ?? [];
  const status: BulkUploadCardStatus =
    activeRun?.status === 'running' ? 'running' :
    activeRun ? 'paused' :
    queuedRuns.length > 0 ? 'queued' :
    p.lastRun?.status === 'completed' ? 'done' : 'idle';
  const cfg = STATUS_CFG[status];

  const run = activeRun ?? null;
  const counts = run?.counts;
  // "Processed" = no longer waiting (launched, skipped, or cancelled). Counting
  // launches alone would miscount: cancelled rows may never have launched, and
  // skipped rows never will - selectedRows minus queued is the only fraction
  // that monotonically reaches its denominator.
  const processed = run && counts ? Math.max(0, run.selectedRows - counts.queued) : 0;
  const barTotal = counts ? counts.queued + counts.running + counts.completed + counts.failed : 0;
  const pct = (n: number) => (barTotal > 0 ? (n / barTotal) * 100 : 0);

  const throttleLine = `${p.throttleReleaseCount} ${p.throttleReleaseCount === 1 ? 'row' : 'rows'} every ${p.throttleIntervalMinutes} min`;

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
            title={activeRun ? 'Queue another file - it runs after the current one' : undefined}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-brand-600 text-white hover:bg-brand-700 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" /> Upload file
          </button>
        </div>
      </div>

      {/* Active run strip */}
      {run && counts ? (
        <div className="border-t border-gray-100 bg-blue-50/30 px-5 py-3.5">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <p className="text-xs text-gray-600 truncate">
              <span className="font-medium text-gray-800">{run.fileName}</span>
              <span className="text-gray-400"> · run #{run.runNumber}</span>
              {run.startedAt && (
                <span className="text-gray-400"> · started {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </p>
            {status === 'running' && onPause && (
              <button
                onClick={onPause}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors shrink-0"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}
            {status === 'paused' && onResume && (
              <button
                onClick={onResume}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors shrink-0"
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-gray-100">
              {pct(counts.queued) > 0 && <div className="bg-gray-300 shrink-0" style={{ width: `${pct(counts.queued)}%` }} />}
              {pct(counts.running) > 0 && <div className="bg-blue-400 shrink-0 animate-pulse" style={{ width: `${pct(counts.running)}%` }} />}
              {pct(counts.completed) > 0 && <div className="bg-green-500 shrink-0" style={{ width: `${pct(counts.completed)}%` }} />}
              {pct(counts.failed) > 0 && <div className="bg-red-500 shrink-0" style={{ width: `${pct(counts.failed)}%` }} />}
            </div>
            <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
              {processed}/{run.selectedRows} rows processed
            </span>
          </div>

          <p className="text-[11px] mt-2 tabular-nums">
            <Counter n={counts.queued} label="queued" cls="text-gray-500" />
            <Dot />
            <Counter n={counts.running} label="running" cls="text-blue-600" />
            <Dot />
            <Counter n={counts.completed} label="completed" cls="text-green-600" />
            <Dot />
            <Counter n={counts.failed} label="failed" cls="text-red-500" />
            <Dot />
            <Counter n={counts.cancelled} label="cancelled" cls="text-gray-400" />
            {status === 'running' && run.nextReleaseAt && counts.queued > 0 && (
              <span className="text-blue-500"><Dot /> next release in <ReleaseCountdown nextReleaseAt={run.nextReleaseAt} /></span>
            )}
          </p>
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

      {/* Files waiting their turn - runs execute strictly in sequence */}
      {queuedRuns.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-2">
          <p className="text-[11px] text-gray-500 truncate">
            <span className="font-medium text-blue-600">Up next:</span>{' '}
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

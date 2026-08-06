/**
 * Bulk Upload Wizard - Baton
 *
 * 4-step modal launched from a Bulk Upload card's "Upload file" button:
 *  Step 1 - Upload the CSV/XLSX/TSV file (drag-drop or picker), preview it
 *  Step 2 - Map file columns to workflow parameters (auto-matched by header)
 *  Step 3 - Row selection + throttling
 *  Step 4 - Preflight review + start the run
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Upload, ChevronRight, ChevronLeft, Loader2, CheckCircle, AlertCircle, FileSpreadsheet, Play,
} from 'lucide-react';
import clsx from 'clsx';
import { Modal } from '@/components/ui/Modal';
import {
  useWorkflows,
  uploadBatchFile,
  preflightBatchRun,
  startBatchRun,
  parseTriggerInputSchema,
  type BatchProcessor,
  type BatchUploadResult,
  type BatchPreflightResult,
  type BatchMapping,
  type BatchRowSelection,
  type BatchRunSettings,
  type SchemaField,
} from '@/hooks/useApi';

// ─── Mapping helpers (exported for tests) ────────────────────

/** One parameter's mapping choice in the UI. */
export type MappingChoice =
  | { kind: 'column'; column: string }
  | { kind: 'fixed'; value: string }
  | { kind: 'unset' };

/** Case-insensitive, non-alphanumerics stripped - "Signer Email" matches "signer_email". */
export function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Auto-preselect a column for every parameter whose normalized name (or label)
 *  matches a normalized file header. Unmatched parameters start unset. */
export function autoMapColumns(fields: SchemaField[], columns: string[]): Record<string, MappingChoice> {
  const byNorm = new Map<string, string>();
  const ambiguous = new Set<string>();
  // Distinct headers can share a normalized form (Smartsheet reality:
  // "Contact$" and "Contact%" both normalize to "contact"). Those are valid
  // columns, but auto-picking one would be a silent guess - leave the
  // parameter unset so the user chooses.
  for (const col of columns) {
    const norm = normalizeHeader(col);
    if (byNorm.has(norm)) ambiguous.add(norm);
    else byNorm.set(norm, col);
  }
  const mapping: Record<string, MappingChoice> = {};
  for (const f of fields) {
    const keyNorm = normalizeHeader(f.key);
    const labelNorm = normalizeHeader(f.label);
    const match =
      (!ambiguous.has(keyNorm) ? byNorm.get(keyNorm) : undefined) ??
      (!ambiguous.has(labelNorm) ? byNorm.get(labelNorm) : undefined);
    mapping[f.key] = match ? { kind: 'column', column: match } : { kind: 'unset' };
  }
  return mapping;
}

/** Convert UI choices to the API mapping shape (unset parameters omitted). */
export function toApiMapping(mapping: Record<string, MappingChoice>): BatchMapping {
  const out: BatchMapping = {};
  for (const [param, choice] of Object.entries(mapping)) {
    if (choice.kind === 'column') out[param] = { type: 'column', column: choice.column };
    else if (choice.kind === 'fixed') out[param] = { type: 'fixed', value: choice.value };
  }
  return out;
}

// ─── Mapping step (exported for tests) ───────────────────────

const FIXED_VALUE = '__fixed__';
const NOT_SET = '__unset__';

export function WizardMappingStep({ fields, columns, previewRow, mapping, onChange }: {
  fields: SchemaField[];
  columns: string[];
  previewRow?: Record<string, string>;
  mapping: Record<string, MappingChoice>;
  onChange: (param: string, choice: MappingChoice) => void;
}) {
  const usedColumns = new Set(
    Object.values(mapping).flatMap((c) => (c.kind === 'column' ? [c.column] : [])),
  );
  const unusedColumns = columns.filter((c) => !usedColumns.has(c));

  const previewPayload: Record<string, string> = {};
  for (const f of fields) {
    const choice = mapping[f.key];
    if (!choice || choice.kind === 'unset') continue;
    previewPayload[f.key] = choice.kind === 'fixed' ? choice.value : (previewRow?.[choice.column] ?? '');
  }

  if (fields.length === 0) {
    return (
      <div className="bg-amber-50 rounded-lg border border-amber-100 p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          This workflow has no published trigger inputs. Add them in Docusign Workflow Builder,
          then sync the workflow and reopen this wizard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Map each workflow parameter to a file column. Matching headers were preselected.
      </p>

      <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
        {fields.map((f) => {
          const choice = mapping[f.key] ?? { kind: 'unset' as const };
          const selectValue =
            choice.kind === 'column' ? choice.column :
            choice.kind === 'fixed' ? FIXED_VALUE :
            NOT_SET;
          return (
            <div key={f.key} className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 font-mono">{f.key}</span>
                <span className="text-[10px] text-gray-400 uppercase">
                  {f.dataType || 'string'}
                  {f.required && <span className="text-red-400 ml-1">required</span>}
                </span>
              </div>
              <select
                value={selectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === NOT_SET) onChange(f.key, { kind: 'unset' });
                  else if (v === FIXED_VALUE) onChange(f.key, { kind: 'fixed', value: '' });
                  else onChange(f.key, { kind: 'column', column: v });
                }}
                aria-label={`Map ${f.key}`}
                className="w-full text-[12px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none focus:ring-1 focus:ring-brand-500"
              >
                {columns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
                <option value={FIXED_VALUE}>Fixed value...</option>
                <option value={NOT_SET}>- not set -</option>
              </select>
              {choice.kind === 'fixed' && (
                <input
                  type="text"
                  value={choice.value}
                  onChange={(e) => onChange(f.key, { kind: 'fixed', value: e.target.value })}
                  placeholder="Fixed value sent for every row"
                  aria-label={`Fixed value for ${f.key}`}
                  className="w-full text-[12px] font-mono bg-white border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Live payload preview from the first data row */}
      <div>
        <p className="text-xs font-medium text-gray-700 mb-1.5">Payload preview (row 1)</p>
        <pre className="text-[11px] text-gray-700 font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(previewPayload, null, 2)}
        </pre>
      </div>

      {unusedColumns.length > 0 && (
        <p className="text-[11px] text-gray-500 leading-snug">
          Unused columns: {unusedColumns.join(', ')}
        </p>
      )}
    </div>
  );
}

// ─── Wizard ──────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = { 1: 'File', 2: 'Mapping', 3: 'Rows', 4: 'Review' };

interface BulkUploadWizardProps {
  processor: BatchProcessor;
  onClose: () => void;
  onStarted: () => void;
}

export function BulkUploadWizard({ processor, onClose, onStarted }: BulkUploadWizardProps) {
  const { data: wfData } = useWorkflows();
  const workflow = wfData?.workflows?.find((w) => w.id === processor.targetWorkflowId);
  const fields = useMemo(
    () => parseTriggerInputSchema(workflow?.triggerInputSchema),
    [workflow?.triggerInputSchema],
  );

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<BatchUploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mapping, setMapping] = useState<Record<string, MappingChoice>>({});

  const [rowMode, setRowMode] = useState<'all' | 'range'>('all');
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState('');
  const [releaseCount, setReleaseCount] = useState(String(processor.throttleReleaseCount));
  const [intervalMinutes, setIntervalMinutes] = useState(String(processor.throttleIntervalMinutes));
  const [stopAfterFailures, setStopAfterFailures] = useState(String(processor.stopAfterConsecutiveFailures));

  const [preflight, setPreflight] = useState<BatchPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState(false);
  const [skipProblemRows, setSkipProblemRows] = useState(true);
  const [starting, setStarting] = useState(false);

  const doUpload = useCallback(async (f: File, sheet?: string) => {
    setUploading(true);
    try {
      const result = await uploadBatchFile(processor.id, f, sheet);
      setFile(f);
      setUploadResult(result);
      setMapping({}); // re-seeded from autoMapColumns by the effect below
      setRowMode('all');
      setRangeFrom('1');
      setRangeTo(String(result.totalRows));
    } catch {
      // error shown by global handler
    } finally {
      setUploading(false);
    }
  }, [processor.id]);

  // Auto-preselect normalized header matches whenever the schema fields or the
  // uploaded columns change - without clobbering choices the user already made.
  // (Fields can arrive after the upload when /workflows is still loading.)
  useEffect(() => {
    if (!uploadResult) return;
    setMapping((prev) => {
      const auto = autoMapColumns(fields, uploadResult.columns);
      const next: Record<string, MappingChoice> = {};
      for (const f of fields) next[f.key] = prev[f.key] ?? auto[f.key];
      return next;
    });
  }, [fields, uploadResult]);

  function handleFilePicked(f: File | undefined | null) {
    if (!f) return;
    doUpload(f);
  }

  // Row selection derived values
  const totalRows = uploadResult?.totalRows ?? 0;
  const from = Math.min(Math.max(parseInt(rangeFrom, 10) || 1, 1), Math.max(totalRows, 1));
  const to = Math.min(Math.max(parseInt(rangeTo, 10) || totalRows, from), Math.max(totalRows, 1));
  const selectedCount = rowMode === 'all' ? totalRows : to - from + 1;

  const rowSelection: BatchRowSelection = rowMode === 'all' ? { mode: 'all' } : { mode: 'range', from, to };
  const settings: BatchRunSettings = {
    releaseCount: Math.max(parseInt(releaseCount, 10) || processor.throttleReleaseCount, 1),
    intervalMinutes: Math.max(parseInt(intervalMinutes, 10) || processor.throttleIntervalMinutes, 1),
    stopAfterFailures: Math.max(parseInt(stopAfterFailures, 10) || processor.stopAfterConsecutiveFailures, 1),
  };

  // Preflight when entering step 4 - pins the schema snapshot server-side.
  useEffect(() => {
    if (step !== 4 || !uploadResult) return;
    let cancelled = false;
    setPreflight(null);
    setPreflightError(false);
    setPreflightLoading(true);
    preflightBatchRun(processor.id, uploadResult.runId, { mapping: toApiMapping(mapping), rowSelection, settings })
      .then((result) => { if (!cancelled) setPreflight(result); })
      .catch(() => { if (!cancelled) setPreflightError(true); })
      .finally(() => { if (!cancelled) setPreflightLoading(false); });
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStart() {
    if (!uploadResult || !preflight) return;
    setStarting(true);
    try {
      await startBatchRun(processor.id, uploadResult.runId, {
        mapping: toApiMapping(mapping),
        rowSelection,
        settings,
        skipProblemRows,
      });
      onStarted();
      onClose();
    } catch {
      // error shown by global handler
    } finally {
      setStarting(false);
    }
  }

  const launchCount = preflight
    ? (skipProblemRows ? preflight.readyRows : preflight.readyRows + preflight.problemRows.length)
    : 0;

  const canNext =
    step === 1 ? !!uploadResult && !uploading :
    step === 3 ? selectedCount > 0 :
    true;

  const canStart =
    !!preflight && !preflightLoading && !starting &&
    preflight.unmappedRequired.length === 0 && launchCount > 0;

  // Problems grouped by problem string for the review step
  const groupedProblems = useMemo(() => {
    if (!preflight) return [];
    const groups = new Map<string, number[]>();
    for (const row of preflight.problemRows) {
      for (const problem of row.problems) {
        const list = groups.get(problem) ?? [];
        list.push(row.rowNumber);
        groups.set(problem, list);
      }
    }
    return Array.from(groups.entries());
  }, [preflight]);

  return (
    <Modal open onClose={onClose} title={`Bulk Upload - ${processor.name}`} className="max-w-xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {([1, 2, 3, 4] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={clsx(
              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
              step === s ? 'bg-brand-600 text-white' :
              s < step ? 'bg-green-500 text-white' :
              'bg-gray-200 text-gray-500',
            )}>
              {s < step ? <CheckCircle className="w-3.5 h-3.5" /> : s}
            </div>
            <span className={clsx('text-xs font-medium', step === s ? 'text-brand-600' : 'text-gray-400')}>
              {STEP_LABELS[s]}
            </span>
            {i < 3 && <div className="h-px bg-gray-200 w-6" />}
          </div>
        ))}
      </div>

      <div className="min-h-[260px]">
        {/* ── Step 1: File ─────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.tsv"
              className="hidden"
              onChange={(e) => { handleFilePicked(e.target.files?.[0]); e.target.value = ''; }}
            />

            {!uploadResult ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFilePicked(e.dataTransfer.files?.[0]); }}
                disabled={uploading}
                className={clsx(
                  'w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed transition-colors',
                  dragActive ? 'border-brand-400 bg-brand-50/50' : 'border-gray-300 hover:border-brand-300 hover:bg-gray-50',
                )}
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                ) : (
                  <Upload className="w-6 h-6 text-gray-400" />
                )}
                <p className="text-sm font-medium text-gray-700">
                  {uploading ? 'Parsing file...' : 'Drop your file here or click to browse'}
                </p>
                <p className="text-xs text-gray-400">CSV, XLSX or TSV · up to 10 MB</p>
              </button>
            ) : (
              <>
                {/* Parsed summary */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                      <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{file?.name}</p>
                      <p className="text-xs text-gray-500">
                        {uploadResult.totalRows} rows · {uploadResult.columns.length} columns
                        {uploadResult.blankRowsSkipped > 0 && ` · ${uploadResult.blankRowsSkipped} blank rows skipped`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="shrink-0 px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center gap-1"
                    >
                      {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Replace
                    </button>
                  </div>

                  {uploadResult.sheetNames.length > 1 && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 shrink-0">Sheet</label>
                      <select
                        value={uploadResult.sheetName ?? uploadResult.sheetNames[0]}
                        onChange={(e) => file && doUpload(file, e.target.value)}
                        disabled={uploading}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        {uploadResult.sheetNames.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Preview table - first 3 rows */}
                {uploadResult.preview.length > 0 && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="text-[11px] w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            {uploadResult.columns.map((col) => (
                              <th key={col} className="px-2.5 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {uploadResult.preview.map((row, i) => (
                            <tr key={i}>
                              {uploadResult.columns.map((col) => (
                                <td key={col} className="px-2.5 py-1.5 text-gray-700 whitespace-nowrap max-w-[160px] truncate">{row[col] ?? ''}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Mapping ──────────────────────────── */}
        {step === 2 && uploadResult && (
          <WizardMappingStep
            fields={fields}
            columns={uploadResult.columns}
            previewRow={uploadResult.preview[0]}
            mapping={mapping}
            onChange={(param, choice) => setMapping((prev) => ({ ...prev, [param]: choice }))}
          />
        )}

        {/* ── Step 3: Rows + throttling ───────────────── */}
        {step === 3 && uploadResult && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Rows to process</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    checked={rowMode === 'all'}
                    onChange={() => setRowMode('all')}
                    className="accent-brand-600"
                  />
                  All {totalRows} rows
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer flex-wrap">
                  <input
                    type="radio"
                    checked={rowMode === 'range'}
                    onChange={() => setRowMode('range')}
                    className="accent-brand-600"
                  />
                  Range from
                  <input
                    type="number"
                    min={1}
                    max={totalRows}
                    value={rangeFrom}
                    onChange={(e) => { setRangeFrom(e.target.value.replace(/[^\d]/g, '')); setRowMode('range'); }}
                    className="w-20 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                  to
                  <input
                    type="number"
                    min={1}
                    max={totalRows}
                    value={rangeTo}
                    onChange={(e) => { setRangeTo(e.target.value.replace(/[^\d]/g, '')); setRowMode('range'); }}
                    className="w-20 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                  {rowMode === 'range' && (
                    <span className="text-xs text-gray-400">{selectedCount} rows</span>
                  )}
                </label>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Throttling</p>
              <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500">
                <span>Release</span>
                <input
                  type="number"
                  min={1}
                  value={releaseCount}
                  onChange={(e) => setReleaseCount(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-16 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <span>rows every</span>
                <input
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-16 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <span>minutes</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500 mt-2">
                <span>Stop after</span>
                <input
                  type="number"
                  min={1}
                  value={stopAfterFailures}
                  onChange={(e) => setStopAfterFailures(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-16 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
                />
                <span>consecutive failures</span>
              </div>
            </div>

            <p className="text-[11px] text-gray-400 leading-snug">
              Duplicate detection across runs is coming soon.
            </p>
          </div>
        )}

        {/* ── Step 4: Review + start ──────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            {preflightLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                <p className="text-sm text-gray-500">Validating rows...</p>
              </div>
            ) : preflightError ? (
              <div className="bg-red-50 rounded-lg border border-red-100 p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">
                  Validation failed. Go back a step and try again, or re-upload the file.
                </p>
              </div>
            ) : preflight ? (
              <>
                {/* Ready / problem counts */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl border border-green-100 p-3 text-center">
                    <p className="text-xl font-semibold text-green-700 tabular-nums">{preflight.readyRows}</p>
                    <p className="text-[11px] font-medium text-green-600">rows ready</p>
                  </div>
                  <div className={clsx(
                    'rounded-xl border p-3 text-center',
                    preflight.problemRows.length > 0 ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100',
                  )}>
                    <p className={clsx('text-xl font-semibold tabular-nums', preflight.problemRows.length > 0 ? 'text-amber-700' : 'text-gray-400')}>
                      {preflight.problemRows.length}
                    </p>
                    <p className={clsx('text-[11px] font-medium', preflight.problemRows.length > 0 ? 'text-amber-600' : 'text-gray-400')}>
                      rows with problems
                    </p>
                  </div>
                </div>

                {preflight.unmappedRequired.length > 0 && (
                  <div className="bg-red-50 rounded-lg border border-red-100 p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">
                      Required parameters not mapped:{' '}
                      {preflight.unmappedRequired.map((f) => (
                        <code key={f} className="bg-red-100 px-1 rounded mx-0.5">{f}</code>
                      ))}
                      <span className="block mt-1">Go back to Mapping and map them before starting.</span>
                    </p>
                  </div>
                )}

                {/* Problem details grouped by problem */}
                {groupedProblems.length > 0 && (
                  <div className="bg-amber-50 rounded-lg border border-amber-100 p-3 space-y-1.5">
                    {groupedProblems.map(([problem, rowNumbers]) => (
                      <p key={problem} className="text-xs text-amber-700">
                        <span className="font-medium">{problem}</span>
                        {' - '}row{rowNumbers.length !== 1 ? 's' : ''}{' '}
                        {rowNumbers.slice(0, 10).join(', ')}
                        {rowNumbers.length > 10 && ` and ${rowNumbers.length - 10} more`}
                      </p>
                    ))}
                  </div>
                )}

                {/* Consequences */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-1 text-xs text-gray-600">
                  <p>
                    Will launch <span className="font-semibold text-gray-900 tabular-nums">{launchCount}</span> workflow
                    instance{launchCount !== 1 ? 's' : ''}, {settings.releaseCount} every {settings.intervalMinutes} min.
                  </p>
                  <p>Estimated duration: about {formatMinutes(preflight.estimatedMinutes)}.</p>
                  {/* Usage line renders only when a relay meter reports usage -
                      the self-hosted default meters nothing. */}
                  {preflight.planUsage?.used != null && (
                    <p>{preflight.planUsage.used} of {preflight.planUsage.included ?? 'unlimited'} relays used.</p>
                  )}
                </div>

                {/* Problem-row handling */}
                {preflight.problemRows.length > 0 && (
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={skipProblemRows}
                        onChange={() => setSkipProblemRows(true)}
                        className="accent-brand-600 mt-0.5"
                      />
                      <span>
                        Skip rows with problems
                        <span className="block text-[11px] text-gray-400">Recommended - only valid rows are launched</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        checked={!skipProblemRows}
                        onChange={() => setSkipProblemRows(false)}
                        className="accent-brand-600 mt-0.5"
                      />
                      <span>
                        Process all rows as-is
                        <span className="block text-[11px] text-gray-400">Problem rows will likely fail and count toward the stop limit</span>
                      </span>
                    </label>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-5 border-t border-gray-100">
        <button
          onClick={() => (step > 1 ? setStep((s) => (s - 1) as Step) : onClose())}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" />
          {step === 1 ? 'Cancel' : 'Back'}
        </button>

        {step < 4 ? (
          <button
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={!canNext}
            className="flex items-center gap-1.5 text-sm font-medium bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-2 text-sm font-medium bg-brand-600 text-white px-5 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {starting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {processor.activeRun ? 'Queueing...' : 'Starting...'}</>
              : processor.activeRun
                ? <><Play className="w-4 h-4" /> Queue run</>
                : <><Play className="w-4 h-4" /> Start run</>}
          </button>
        )}
      </div>
    </Modal>
  );
}

function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return 'a minute';
  if (mins < 60) return `${Math.ceil(mins)} minute${Math.ceil(mins) !== 1 ? 's' : ''}`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

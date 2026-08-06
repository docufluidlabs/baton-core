/**
 * Batch Service — Baton (Bulk Upload)
 *
 * Everything behind the Bulk Upload feature that is not route plumbing:
 *   - Spreadsheet parsing (CSV/TSV/XLSX from a Buffer, values as trimmed strings)
 *   - Mapping (column/fixed value → workflow trigger inputs) and row validation
 *   - BatchProcessor / BatchRun / BatchRow persistence helpers
 *   - The dispatcher that releases queued rows for due runs (called from the
 *     scheduler cron every 30s, guarded by SCHEDULER_ENABLED)
 *
 * Row lifecycle: staged → queued → launching → launched → completed/failed
 * (or cancelled/skipped). The conditional queued→launching update in the
 * dispatcher is the double-release guard when several ticks overlap.
 */

import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo, logError, logDebug } from '../lib/logger';
import { ValidationError } from '../middleware/error-handler';
import {
  BatchFileType,
  BatchMapping,
  BatchProcessor,
  BatchRow,
  BatchRowSelection,
  BatchRowStatus,
  BatchRun,
  BatchRunSettings,
  BatchRunStatus,
  WorkflowInstance,
  WorkflowLaunchJob,
} from '../lib/types';
import { sendMessage, QueueNames } from '../queue/sqs-client';

// ─── Defaults ────────────────────────────────────────────────

export const BATCH_DEFAULTS: BatchRunSettings = {
  releaseCount: 5,
  intervalMinutes: 10,
  stopAfterFailures: 5,
};

// ─── File Parsing ────────────────────────────────────────────

export interface ParsedSpreadsheet {
  fileType: BatchFileType;
  columns: string[];
  /** One record per data row (file order), values as trimmed strings. */
  rows: Record<string, string>[];
  blankRowsSkipped: number;
  sheetNames: string[];
  sheetName: string;
}

const EXTENSION_TO_TYPE: Record<string, BatchFileType> = {
  csv: 'csv',
  tsv: 'tsv',
  xlsx: 'xlsx',
};

export const UNSUPPORTED_FILE_MESSAGE = 'Save the file as CSV, XLSX or TSV and try again.';

export function detectFileType(fileName: string): BatchFileType {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  const type = EXTENSION_TO_TYPE[ext];
  if (!type) throw new ValidationError(UNSUPPORTED_FILE_MESSAGE);
  return type;
}

/**
 * Normalize a header for duplicate detection and parameter auto-matching:
 * lowercase, strip non-alphanumerics. "Object ID" / "object_id" → "objectid".
 */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse a CSV/TSV/XLSX buffer into headers + string rows.
 *
 * - CSV/TSV are read with `raw: true` so cells stay the literal file text
 *   (protects 13-digit IDs and leading zeros from numeric coercion).
 * - XLSX cells are extracted with `raw: false` so the formatted display text
 *   is used instead of the underlying float.
 * - All values are trimmed; fully blank rows are skipped (and counted).
 * - First row = headers. Unnamed (blank-header) columns are dropped.
 * - Byte-identical duplicate headers are rejected with an actionable message;
 *   headers that merely share a normalized form are kept as distinct columns.
 */
export function parseSpreadsheetBuffer(
  buffer: Buffer,
  fileName: string,
  sheet?: string,
): ParsedSpreadsheet {
  const fileType = detectFileType(fileName);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellText: true,
      // CSV/TSV: keep every cell as the literal string from the file.
      ...(fileType !== 'xlsx' ? { raw: true } : {}),
    });
  } catch {
    throw new ValidationError(UNSUPPORTED_FILE_MESSAGE);
  }

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new ValidationError('The file has no sheets with data.');
  }

  let sheetName = sheetNames[0];
  if (sheet) {
    if (!sheetNames.includes(sheet)) {
      throw new ValidationError(`Sheet "${sheet}" was not found in the file.`);
    }
    sheetName = sheet;
  }

  const worksheet = workbook.Sheets[sheetName];
  // raw:false → formatted display text for each cell; defval '' keeps row shape.
  const grid: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });

  if (grid.length === 0) {
    throw new ValidationError('The file is empty. Add a header row and at least one data row.');
  }

  const headerRow = (grid[0] || []).map((h) => String(h ?? '').trim());
  const columns: string[] = [];
  const columnIndexes: number[] = [];
  headerRow.forEach((header, i) => {
    if (header) {
      columns.push(header);
      columnIndexes.push(i);
    }
  });
  if (columns.length === 0) {
    throw new ValidationError('The first row must contain column headers.');
  }

  // Duplicate header detection. Mapping is keyed by the EXACT header string,
  // so only byte-identical headers are genuinely ambiguous (row values would
  // overwrite each other). Headers that merely normalize the same (a real
  // Smartsheet case: "Contact$" and "Contact%" both normalize to "contact")
  // are distinct columns and must be allowed — they are only excluded from
  // parameter auto-matching (see ambiguousNormalizedKeys).
  const seenExact = new Set<string>();
  const duplicates: string[] = [];
  for (const column of columns) {
    if (seenExact.has(column)) {
      duplicates.push(`"${column}"`);
    } else {
      seenExact.add(column);
    }
  }
  if (duplicates.length > 0) {
    throw new ValidationError(
      `Duplicate column headers found: ${duplicates.join(', ')}. ` +
      'Rename the columns so every header is unique and upload the file again.',
    );
  }

  const rows: Record<string, string>[] = [];
  let blankRowsSkipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r] || [];
    const values = columnIndexes.map((i) => String(cells[i] ?? '').trim());
    if (values.every((v) => v === '')) {
      blankRowsSkipped++;
      continue;
    }
    const data: Record<string, string> = {};
    columns.forEach((column, i) => {
      data[column] = values[i];
    });
    rows.push(data);
  }

  return { fileType, columns, rows, blankRowsSkipped, sheetNames, sheetName };
}

// ─── Schema Fields ───────────────────────────────────────────

export interface SchemaFieldSpec {
  key: string;
  required: boolean;
}

// Workflow Builder adds these to every workflow — they are populated by
// Workflow Builder itself, never mapped from an uploaded file. Mirrors the
// frontend parseTriggerInputSchema.
const MAESTRO_SYSTEM_FIELDS = new Set(['startDate', 'workflowBuilder', 'workflowPreparer', 'workflowSigner']);

/**
 * Parse a triggerInputSchema (Workflow Builder array format or JSON Schema)
 * into a flat list of mappable fields with their required flag.
 */
export function parseTriggerSchemaFields(schema: Record<string, any> | undefined | null): SchemaFieldSpec[] {
  if (!schema) return [];

  // Workflow Builder array format: [{ field_name, field_data_type, default_value }]
  if (Array.isArray(schema)) {
    return schema
      .filter((item: any) =>
        item?.field_name &&
        !MAESTRO_SYSTEM_FIELDS.has(item.field_name) &&
        item.field_data_type !== 'Participants')
      .map((item: any) => ({ key: item.field_name as string, required: false }));
  }

  // JSON Schema format: { properties: {...}, required: [...] }
  if (schema.properties && typeof schema.properties === 'object') {
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    return Object.keys(schema.properties)
      .filter((key) => !MAESTRO_SYSTEM_FIELDS.has(key))
      .map((key) => ({ key, required: required.has(key) }));
  }

  return [];
}

// ─── Mapping + Row Validation ────────────────────────────────

/**
 * Build the trigger inputs for one row from the run's mapping.
 * Column sources read the row value (missing column → ''), fixed sources use
 * their configured value. Params absent from the mapping stay unset.
 */
export function buildRowInputs(
  mapping: BatchMapping | undefined,
  rowData: Record<string, string>,
): Record<string, string> {
  const inputs: Record<string, string> = {};
  if (!mapping) return inputs;
  for (const [param, spec] of Object.entries(mapping)) {
    if (!spec) continue;
    if (spec.type === 'column') {
      inputs[param] = rowData[spec.column] ?? '';
    } else if (spec.type === 'fixed') {
      inputs[param] = spec.value ?? '';
    }
  }
  return inputs;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCIENTIFIC_NOTATION_REGEX = /^\d+(\.\d+)?[eE]\+\d+$/;
export const CORRUPTED_NUMBER_PROBLEM = 'value looks like a corrupted long number';

/**
 * Validate one row against the pinned schema + mapping. Returns the list of
 * problems (empty = valid):
 *   - required schema fields that are mapped but empty for this row
 *   - fields whose name contains 'email' must match a basic email regex
 *   - warn-level: a mapped column value in scientific notation (Excel corrupted
 *     a long numeric ID) → "value looks like a corrupted long number"
 */
export function validateRowData(
  schemaFields: SchemaFieldSpec[],
  mapping: BatchMapping,
  rowData: Record<string, string>,
): string[] {
  const problems: string[] = [];
  const inputs = buildRowInputs(mapping, rowData);

  for (const field of schemaFields) {
    const isMapped = !!mapping[field.key];
    const value = inputs[field.key];
    if (field.required && isMapped && (!value || value === '')) {
      problems.push(`required field "${field.key}" is empty`);
      continue;
    }
    if (isMapped && value && field.key.toLowerCase().includes('email') && !EMAIL_REGEX.test(value)) {
      problems.push(`"${field.key}" is not a valid email address`);
    }
  }

  for (const spec of Object.values(mapping)) {
    if (spec?.type !== 'column') continue;
    const value = rowData[spec.column] ?? '';
    if (SCIENTIFIC_NOTATION_REGEX.test(value)) {
      problems.push(CORRUPTED_NUMBER_PROBLEM);
      break;
    }
  }

  return problems;
}

export function isRowSelected(rowNumber: number, selection: BatchRowSelection | undefined): boolean {
  if (!selection || selection.mode === 'all') return true;
  return rowNumber >= selection.from && rowNumber <= selection.to;
}

export interface RunValidationResult {
  readyRows: number;
  problemRows: { rowNumber: number; problems: string[] }[];
  unmappedRequired: string[];
  selectedCount: number;
  /** All rows with recomputed included/problems, ready to persist. */
  rows: BatchRow[];
}

/**
 * Validate every selected row of a run against schema + mapping. Returns the
 * per-row results plus updated row items (included/problems recomputed) for
 * persistence.
 */
export function validateRunRows(
  rows: BatchRow[],
  schema: Record<string, any> | undefined,
  mapping: BatchMapping,
  rowSelection: BatchRowSelection,
): RunValidationResult {
  const schemaFields = parseTriggerSchemaFields(schema);
  const unmappedRequired = schemaFields
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => f.key);

  let readyRows = 0;
  let selectedCount = 0;
  const problemRows: { rowNumber: number; problems: string[] }[] = [];

  const updated = rows.map((row) => {
    const included = isRowSelected(row.rowNumber, rowSelection);
    let problems: string[] = [];
    if (included) {
      selectedCount++;
      problems = validateRowData(schemaFields, mapping, row.data);
      if (problems.length === 0) {
        readyRows++;
      } else {
        problemRows.push({ rowNumber: row.rowNumber, problems });
      }
    }
    return { ...row, included, problems };
  });

  return { readyRows, problemRows, unmappedRequired, selectedCount, rows: updated };
}

// ─── Row Naming ──────────────────────────────────────────────

/**
 * Display name for a row (also used as the Workflow Builder instance name):
 * "{seq} · {first mapped column value} · row {rowNumber}".
 */
export function buildRowName(run: BatchRun, row: BatchRow): string {
  let label = '';
  for (const spec of Object.values(run.mapping || {})) {
    if (spec?.type === 'column') {
      label = row.data[spec.column] ?? '';
      break;
    }
  }
  if (!label) {
    for (const column of run.columns) {
      if (row.data[column]) {
        label = row.data[column];
        break;
      }
    }
  }
  const seq = row.seq ?? row.rowNumber;
  return label ? `${seq} · ${label} · row ${row.rowNumber}` : `${seq} · row ${row.rowNumber}`;
}

// ─── Processor CRUD ──────────────────────────────────────────

export async function createProcessor(params: {
  orgId: string;
  name: string;
  targetWorkflowId: string;
  sourcePlatform?: string;
  throttleReleaseCount?: number;
  throttleIntervalMinutes?: number;
  stopAfterConsecutiveFailures?: number;
  createdBy?: string;
}): Promise<BatchProcessor> {
  const docClient = getDocClient();
  const now = new Date().toISOString();
  const processor: BatchProcessor = {
    id: uuidv4(),
    orgId: params.orgId,
    name: params.name,
    targetWorkflowId: params.targetWorkflowId,
    sourcePlatform: params.sourcePlatform,
    status: 'active',
    throttleReleaseCount: params.throttleReleaseCount ?? BATCH_DEFAULTS.releaseCount,
    throttleIntervalMinutes: params.throttleIntervalMinutes ?? BATCH_DEFAULTS.intervalMinutes,
    stopAfterConsecutiveFailures: params.stopAfterConsecutiveFailures ?? BATCH_DEFAULTS.stopAfterFailures,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
  };
  await docClient.send(new PutCommand({
    TableName: TableNames.BATCH_PROCESSORS,
    Item: processor,
  }));
  logInfo('Batch processor created', { id: processor.id, orgId: params.orgId });
  return processor;
}

export async function getProcessor(id: string): Promise<BatchProcessor | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.BATCH_PROCESSORS,
    Key: { id },
  }));
  return (result.Item as BatchProcessor) || null;
}

export async function getProcessorsByOrg(orgId: string): Promise<BatchProcessor[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.BATCH_PROCESSORS,
    IndexName: 'orgId-index',
    KeyConditionExpression: 'orgId = :orgId',
    ExpressionAttributeValues: { ':orgId': orgId },
  }));
  return (result.Items as BatchProcessor[]) || [];
}

/** Generic partial update on a processor (undefined fields are skipped). */
export async function updateProcessor(id: string, fields: Record<string, any>): Promise<void> {
  const docClient = getDocClient();
  const sets: string[] = ['#f_updatedAt = :v_updatedAt'];
  const values: Record<string, any> = { ':v_updatedAt': new Date().toISOString() };
  const names: Record<string, string> = { '#f_updatedAt': 'updatedAt' };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    names[`#f_${key}`] = key;
    sets.push(`#f_${key} = :v_${key}`);
    values[`:v_${key}`] = value;
  }
  await docClient.send(new UpdateCommand({
    TableName: TableNames.BATCH_PROCESSORS,
    Key: { id },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: values,
    ExpressionAttributeNames: names,
  }));
}

export async function deleteProcessor(id: string): Promise<void> {
  const docClient = getDocClient();
  await docClient.send(new DeleteCommand({
    TableName: TableNames.BATCH_PROCESSORS,
    Key: { id },
  }));
  logInfo('Batch processor deleted', { id });
}

// ─── Run + Row Persistence ───────────────────────────────────

export async function getRun(id: string): Promise<BatchRun | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.BATCH_RUNS,
    Key: { id },
  }));
  return (result.Item as BatchRun) || null;
}

/** Runs for a processor, newest first. */
export async function getRunsByProcessor(batchProcessorId: string): Promise<BatchRun[]> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.BATCH_RUNS,
    IndexName: 'batchProcessorId-createdAt-index',
    KeyConditionExpression: 'batchProcessorId = :pid',
    ExpressionAttributeValues: { ':pid': batchProcessorId },
    ScanIndexForward: false,
  }));
  return (result.Items as BatchRun[]) || [];
}

/** Generic partial update on a run (undefined fields are skipped). */
export async function updateRun(id: string, fields: Record<string, any>): Promise<void> {
  const docClient = getDocClient();
  const sets: string[] = [];
  const values: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    names[`#f_${key}`] = key;
    sets.push(`#f_${key} = :v_${key}`);
    values[`:v_${key}`] = value;
  }
  if (sets.length === 0) return;
  await docClient.send(new UpdateCommand({
    TableName: TableNames.BATCH_RUNS,
    Key: { id },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: values,
    ExpressionAttributeNames: names,
  }));
}

export async function getRow(runId: string, rowNumber: number): Promise<BatchRow | null> {
  const docClient = getDocClient();
  const result = await docClient.send(new GetCommand({
    TableName: TableNames.BATCH_ROWS,
    Key: { runId, rowNumber },
  }));
  return (result.Item as BatchRow) || null;
}

/** All rows of a run (rowNumber ascending), paginated past the 1MB limit. */
export async function getRowsByRun(runId: string): Promise<BatchRow[]> {
  const docClient = getDocClient();
  const rows: BatchRow[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.BATCH_ROWS,
      KeyConditionExpression: 'runId = :runId',
      ExpressionAttributeValues: { ':runId': runId },
      ScanIndexForward: true,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    rows.push(...((result.Items as BatchRow[]) || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return rows;
}

/** BatchWrite rows in chunks of 25, retrying unprocessed items a few times. */
export async function putRows(rows: BatchRow[]): Promise<void> {
  const docClient = getDocClient();
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    let requestItems: Record<string, any[]> = {
      [TableNames.BATCH_ROWS]: chunk.map((row) => ({ PutRequest: { Item: row } })),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
      const unprocessed = result.UnprocessedItems;
      if (!unprocessed || Object.keys(unprocessed).length === 0) break;
      requestItems = unprocessed as Record<string, any[]>;
    }
  }
}

/** Generic partial update on a row (undefined fields are skipped). */
export async function updateRow(
  runId: string,
  rowNumber: number,
  fields: Record<string, any>,
  conditionStatus?: BatchRowStatus[],
): Promise<boolean> {
  const docClient = getDocClient();
  const sets: string[] = [];
  const values: Record<string, any> = {};
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    names[`#f_${key}`] = key;
    sets.push(`#f_${key} = :v_${key}`);
    values[`:v_${key}`] = value;
  }
  if (sets.length === 0) return false;

  let conditionExpression: string | undefined;
  if (conditionStatus && conditionStatus.length > 0) {
    names['#st'] = 'status';
    conditionStatus.forEach((status, i) => {
      values[`:cond_${i}`] = status;
    });
    conditionExpression = `#st IN (${conditionStatus.map((_, i) => `:cond_${i}`).join(', ')})`;
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: TableNames.BATCH_ROWS,
      Key: { runId, rowNumber },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: values,
      ExpressionAttributeNames: names,
      ...(conditionExpression ? { ConditionExpression: conditionExpression } : {}),
    }));
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/**
 * Create a draft run + one staged row per data row. Called from the upload
 * endpoint after parsing succeeds.
 */
export async function createRunWithRows(params: {
  processor: BatchProcessor;
  fileName: string;
  parsed: ParsedSpreadsheet;
  createdBy?: string;
}): Promise<BatchRun> {
  const { processor, fileName, parsed, createdBy } = params;
  const docClient = getDocClient();
  const now = new Date().toISOString();

  const existingRuns = await getRunsByProcessor(processor.id);
  const runNumber = existingRuns.length > 0
    ? Math.max(...existingRuns.map((r) => r.runNumber || 0)) + 1
    : 1;

  const run: BatchRun = {
    id: uuidv4(),
    orgId: processor.orgId,
    batchProcessorId: processor.id,
    runNumber,
    fileName,
    fileType: parsed.fileType,
    sheetName: parsed.sheetName,
    columns: parsed.columns,
    totalRows: parsed.rows.length,
    status: 'draft',
    settings: {
      releaseCount: processor.throttleReleaseCount,
      intervalMinutes: processor.throttleIntervalMinutes,
      stopAfterFailures: processor.stopAfterConsecutiveFailures,
    },
    consecutiveFailures: 0,
    createdAt: now,
    createdBy,
  };

  await docClient.send(new PutCommand({
    TableName: TableNames.BATCH_RUNS,
    Item: run,
  }));

  const rows: BatchRow[] = parsed.rows.map((data, i) => ({
    runId: run.id,
    rowNumber: i + 1,
    orgId: processor.orgId,
    batchProcessorId: processor.id,
    data,
    included: true,
    problems: [],
    status: 'staged',
  }));
  await putRows(rows);

  logInfo('Batch run created', { runId: run.id, processorId: processor.id, rows: rows.length });
  return run;
}

/**
 * Delete leftover draft runs (and their rows) for a processor. Re-uploading a
 * file in the wizard replaces the previous draft.
 */
export async function deleteDraftRuns(batchProcessorId: string): Promise<void> {
  const docClient = getDocClient();
  const runs = await getRunsByProcessor(batchProcessorId);
  for (const run of runs.filter((r) => r.status === 'draft')) {
    const rows = await getRowsByRun(run.id);
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [TableNames.BATCH_ROWS]: chunk.map((row) => ({
            DeleteRequest: { Key: { runId: row.runId, rowNumber: row.rowNumber } },
          })),
        },
      }));
    }
    await docClient.send(new DeleteCommand({
      TableName: TableNames.BATCH_RUNS,
      Key: { id: run.id },
    }));
    logInfo('Stale draft batch run deleted', { runId: run.id, processorId: batchProcessorId });
  }
}

// ─── Row Counts + Display Status ─────────────────────────────

export interface BatchRowCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

/** Counts by display status. 'staged' rows (not yet started/unselected) are not counted. */
export function computeRowCounts(rows: BatchRow[]): BatchRowCounts {
  const counts: BatchRowCounts = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };
  for (const row of rows) {
    switch (row.status) {
      case 'queued': counts.queued++; break;
      case 'launching':
      case 'launched': counts.running++; break;
      case 'completed': counts.completed++; break;
      case 'failed': counts.failed++; break;
      case 'cancelled': counts.cancelled++; break;
      case 'skipped': counts.skipped++; break;
      default: break; // staged
    }
  }
  return counts;
}

export type BatchRowDisplayStatus = BatchRowStatus | 'running';

export interface ResolvedBatchRow extends BatchRow {
  displayStatus: BatchRowDisplayStatus;
  instance?: WorkflowInstance;
}

const TERMINAL_INSTANCE_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Hydrate launched rows with their WorkflowInstance (BatchGet, chunks of 100)
 * and resolve the display status: launched + instance running → 'running';
 * terminal instance states are mapped through AND lazily persisted back to the
 * row so subsequent reads are cheap.
 */
export async function resolveRowInstanceStatuses(rows: BatchRow[]): Promise<ResolvedBatchRow[]> {
  const docClient = getDocClient();
  const instanceIds = [...new Set(
    rows
      .filter((r) => (r.status === 'launched' || r.status === 'launching') && r.workflowInstanceId)
      .map((r) => r.workflowInstanceId!),
  )];

  const instanceMap = new Map<string, WorkflowInstance>();
  for (let i = 0; i < instanceIds.length; i += 100) {
    const chunk = instanceIds.slice(i, i + 100);
    const batchResult = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [TableNames.WORKFLOW_INSTANCES]: {
          Keys: chunk.map((id) => ({ id })),
        },
      },
    }));
    const items = (batchResult.Responses?.[TableNames.WORKFLOW_INSTANCES] || []) as WorkflowInstance[];
    for (const item of items) instanceMap.set(item.id, item);
  }

  const resolved: ResolvedBatchRow[] = [];
  for (const row of rows) {
    const instance = row.workflowInstanceId ? instanceMap.get(row.workflowInstanceId) : undefined;
    let displayStatus: BatchRowDisplayStatus = row.status === 'launching' ? 'running' : row.status;
    let effectiveRow = row;

    if (row.status === 'launched' && instance) {
      if (TERMINAL_INSTANCE_STATUSES.has(instance.status)) {
        displayStatus = instance.status as BatchRowDisplayStatus;
        const completedAt = instance.completedAt || new Date().toISOString();
        // Lazily persist the terminal state back to the row (guarded so a
        // concurrent resolver or cancel doesn't get clobbered).
        const updated = await updateRow(row.runId, row.rowNumber, {
          status: instance.status,
          completedAt,
          ...(instance.status === 'failed' && instance.errorMessage ? { errorMessage: instance.errorMessage } : {}),
        }, ['launched']);
        if (updated) {
          effectiveRow = {
            ...row,
            status: instance.status as BatchRowStatus,
            completedAt,
            ...(instance.status === 'failed' && instance.errorMessage ? { errorMessage: instance.errorMessage } : {}),
          };
        }
      } else {
        displayStatus = 'running';
      }
    }

    resolved.push({ ...effectiveRow, displayStatus, instance });
  }
  return resolved;
}

// ─── Dispatcher ──────────────────────────────────────────────

/** Full paginated scan of batch runs matching one status. */
async function scanRunsByStatus(status: BatchRunStatus): Promise<BatchRun[]> {
  const docClient = getDocClient();
  const runs: BatchRun[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result: any = await docClient.send(new ScanCommand({
      TableName: TableNames.BATCH_RUNS,
      FilterExpression: '#st = :status',
      ExpressionAttributeValues: { ':status': status },
      ExpressionAttributeNames: { '#st': 'status' },
      ExclusiveStartKey: lastKey,
    }));
    runs.push(...((result.Items as BatchRun[]) || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return runs;
}

/**
 * Release queued rows for every running run whose nextReleaseAt is due, then
 * reconcile and promote the per-processor run queues (runs execute in strict
 * sequence per processor). Called from the scheduler cron every 30s
 * (SCHEDULER_ENABLED-gated).
 */
export async function dispatchDueBatchRuns(): Promise<void> {
  const nowIso = new Date().toISOString();

  const running = await scanRunsByStatus('running');
  const due = running.filter((r) => r.nextReleaseAt && r.nextReleaseAt <= nowIso);
  if (due.length === 0) {
    logDebug('No batch runs due for release');
  }

  for (const run of due) {
    try {
      await dispatchRun(run);
    } catch (err) {
      logError('Batch run dispatch failed', err, { runId: run.id });
    }
  }

  try {
    await reconcileRunQueues(running);
  } catch (err) {
    logError('Batch run queue reconciliation failed', err);
  }
}

/**
 * Enforce the one-run-at-a-time invariant, then start the oldest queued run
 * of every processor with no running or paused run.
 *
 * Reconciliation first: the start/resume routes use non-atomic check-then-write
 * (DynamoDB has no cross-item conditions here), so two near-simultaneous
 * writes can leave a processor with two running runs. Every tick demotes all
 * but the oldest back to 'queued', so any such window closes within 30s.
 *
 * A paused run deliberately blocks promotion - the operator stopped the
 * sequence, so the next file must not jump ahead.
 */
async function reconcileRunQueues(runningRuns: BatchRun[]): Promise<void> {
  const docClient = getDocClient();

  // 1. Demote duplicate running runs (keep the oldest by run number).
  const runningByProcessor = new Map<string, BatchRun[]>();
  for (const run of runningRuns) {
    const list = runningByProcessor.get(run.batchProcessorId) ?? [];
    list.push(run);
    runningByProcessor.set(run.batchProcessorId, list);
  }
  for (const [processorId, list] of runningByProcessor) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.runNumber ?? 0) - (b.runNumber ?? 0));
    for (const dupe of sorted.slice(1)) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TableNames.BATCH_RUNS,
          Key: { id: dupe.id },
          UpdateExpression: 'SET #st = :queued',
          ConditionExpression: '#st = :running',
          ExpressionAttributeValues: { ':queued': 'queued', ':running': 'running' },
          ExpressionAttributeNames: { '#st': 'status' },
        }));
        logInfo('Duplicate running batch run demoted to queued', { runId: dupe.id, processorId });
      } catch (err: any) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
      }
    }
  }

  // 2. Promote the oldest queued run of each idle processor.
  const queued = await scanRunsByStatus('queued');
  if (queued.length === 0) return;

  const queuedByProcessor = new Map<string, BatchRun[]>();
  for (const run of queued) {
    const list = queuedByProcessor.get(run.batchProcessorId) ?? [];
    list.push(run);
    queuedByProcessor.set(run.batchProcessorId, list);
  }

  for (const [processorId, candidates] of queuedByProcessor) {
    const siblings = await getRunsByProcessor(processorId);
    if (siblings.some((r) => r.status === 'running' || r.status === 'paused')) continue;

    const next = candidates.sort((a, b) => (a.runNumber ?? 0) - (b.runNumber ?? 0))[0];
    const now = new Date().toISOString();
    try {
      // Condition guards double-promotion when dispatcher ticks overlap.
      await docClient.send(new UpdateCommand({
        TableName: TableNames.BATCH_RUNS,
        Key: { id: next.id },
        UpdateExpression: 'SET #st = :running, startedAt = :now, nextReleaseAt = :now, consecutiveFailures = :zero',
        ConditionExpression: '#st = :queued',
        ExpressionAttributeValues: { ':running': 'running', ':queued': 'queued', ':now': now, ':zero': 0 },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
      logInfo('Queued batch run promoted to running', { runId: next.id, processorId });
    } catch (err: any) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
  }
}

/**
 * Atomically claim a queued run for cancellation (queued -> cancelled) so the
 * dispatcher's promotion can never start it mid-cancel. Returns false when
 * the run was promoted first.
 */
export async function claimQueuedRunForCancel(runId: string): Promise<boolean> {
  try {
    await getDocClient().send(new UpdateCommand({
      TableName: TableNames.BATCH_RUNS,
      Key: { id: runId },
      UpdateExpression: 'SET #st = :cancelled, completedAt = :now',
      ConditionExpression: '#st = :queued',
      ExpressionAttributeValues: { ':cancelled': 'cancelled', ':queued': 'queued', ':now': new Date().toISOString() },
      ExpressionAttributeNames: { '#st': 'status' },
    }));
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function dispatchRun(run: BatchRun): Promise<void> {
  const docClient = getDocClient();
  const settings = run.settings ?? BATCH_DEFAULTS;

  // 1. Stop-after-failures guard
  if ((run.consecutiveFailures ?? 0) >= settings.stopAfterFailures) {
    try {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.BATCH_RUNS,
        Key: { id: run.id },
        UpdateExpression: 'SET #st = :stopped',
        ConditionExpression: '#st = :running',
        ExpressionAttributeValues: { ':stopped': 'stopped', ':running': 'running' },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
      logInfo('Batch run stopped after consecutive failures', {
        runId: run.id,
        consecutiveFailures: run.consecutiveFailures,
        stopAfterFailures: settings.stopAfterFailures,
      });
    } catch (err: any) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
    return;
  }

  const processor = await getProcessor(run.batchProcessorId);
  if (!processor) {
    logError('Batch run references a missing processor - skipping', null, { runId: run.id });
    return;
  }

  // 2. Release up to releaseCount queued rows (seq order == rowNumber order)
  const queued = await queryQueuedRows(run.id, settings.releaseCount);
  let released = 0;
  for (const row of queued) {
    // Conditional queued → launching — the double-release guard when two
    // dispatcher ticks (or pods) overlap.
    try {
      await docClient.send(new UpdateCommand({
        TableName: TableNames.BATCH_ROWS,
        Key: { runId: run.id, rowNumber: row.rowNumber },
        UpdateExpression: 'SET #st = :launching',
        ConditionExpression: '#st = :queued',
        ExpressionAttributeValues: { ':launching': 'launching', ':queued': 'queued' },
        ExpressionAttributeNames: { '#st': 'status' },
      }));
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') continue; // already released elsewhere
      throw err;
    }

    const job: WorkflowLaunchJob = {
      workflowId: processor.targetWorkflowId,
      orgId: run.orgId,
      inputData: buildRowInputs(run.mapping, row.data),
      instanceName: buildRowName(run, row),
      sourcePlatform: processor.sourcePlatform,
      batch: { runId: run.id, rowNumber: row.rowNumber },
    };
    await sendMessage(QueueNames.WORKFLOW_LAUNCHER, job);
    released++;
  }

  if (released > 0) {
    logInfo('Batch rows released', { runId: run.id, released });
  }

  // 3. Advance nextReleaseAt
  await docClient.send(new UpdateCommand({
    TableName: TableNames.BATCH_RUNS,
    Key: { id: run.id },
    UpdateExpression: 'SET nextReleaseAt = :next',
    ExpressionAttributeValues: {
      ':next': new Date(Date.now() + settings.intervalMinutes * 60_000).toISOString(),
    },
  }));

  // 4. Completion detection — nothing left to release, nothing in flight,
  // and every launched row's instance is terminal.
  if (released === 0) {
    await completeRunIfFinished(run.id);
  }
}

/** First `max` queued rows of a run (rowNumber ascending), paginated. */
async function queryQueuedRows(runId: string, max: number): Promise<BatchRow[]> {
  const docClient = getDocClient();
  const collected: BatchRow[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TableNames.BATCH_ROWS,
      KeyConditionExpression: 'runId = :runId',
      FilterExpression: '#st = :queued',
      ExpressionAttributeValues: { ':runId': runId, ':queued': 'queued' },
      ExpressionAttributeNames: { '#st': 'status' },
      ScanIndexForward: true,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    for (const item of (result.Items as BatchRow[]) || []) {
      collected.push(item);
      if (collected.length >= max) return collected;
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return collected;
}

/**
 * Mark a run 'completed' when no queued/launching rows remain and all launched
 * rows are terminal (checking — and lazily persisting — their instances).
 */
export async function completeRunIfFinished(runId: string): Promise<boolean> {
  const docClient = getDocClient();
  const rows = await getRowsByRun(runId);

  if (rows.some((r) => r.status === 'queued' || r.status === 'launching')) return false;

  const launched = rows.filter((r) => r.status === 'launched');
  if (launched.length > 0) {
    const resolved = await resolveRowInstanceStatuses(launched);
    const stillRunning = resolved.some(
      (r) => r.status === 'launched' && r.instance && !TERMINAL_INSTANCE_STATUSES.has(r.instance.status),
    );
    if (stillRunning) return false;
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: TableNames.BATCH_RUNS,
      Key: { id: runId },
      UpdateExpression: 'SET #st = :completed, completedAt = :now',
      ConditionExpression: '#st = :running',
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':running': 'running',
        ':now': new Date().toISOString(),
      },
      ExpressionAttributeNames: { '#st': 'status' },
    }));
    logInfo('Batch run completed', { runId });
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

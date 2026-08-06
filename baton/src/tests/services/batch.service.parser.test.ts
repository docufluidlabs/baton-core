/**
 * Bulk Upload file parser tests — batch.service.parseSpreadsheetBuffer
 * CSV/TSV/XLSX buffer fixtures: preserves long numeric IDs as strings, trims
 * whitespace, skips blank rows (counted), rejects byte-identical duplicate
 * headers and unsupported extensions, keeps normalized-collision headers as
 * distinct columns, sniffs semicolon delimiters, supports XLSX sheet selection.
 */
import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../../db/client', () => ({
  getDocClient: vi.fn(() => ({ send: vi.fn() })),
  TableNames: {
    BATCH_PROCESSORS: 'batch-processors',
    BATCH_RUNS: 'batch-runs',
    BATCH_ROWS: 'batch-rows',
    WORKFLOW_INSTANCES: 'instances',
  },
}));

vi.mock('../../queue/sqs-client', () => ({
  sendMessage: vi.fn(),
  QueueNames: { WORKFLOW_LAUNCHER: 'workflow-launcher' },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  parseSpreadsheetBuffer,
  detectFileType,
  normalizeHeader,
  UNSUPPORTED_FILE_MESSAGE,
} from '../../services/batch.service';

// ─── Fixtures ───────────────────────────────────────────────

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function xlsxBuffer(aoa: any[][], sheetName = 'Sheet1', extraSheets: Record<string, any[][]> = {}): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  for (const [name, rows] of Object.entries(extraSheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── Tests ──────────────────────────────────────────────────

describe('detectFileType', () => {
  it('maps supported extensions', () => {
    expect(detectFileType('contacts.csv')).toBe('csv');
    expect(detectFileType('Contacts.XLSX')).toBe('xlsx');
    expect(detectFileType('data.tsv')).toBe('tsv');
  });

  it('rejects unsupported extensions with the exact copy', () => {
    expect(() => detectFileType('legacy.xls')).toThrow(UNSUPPORTED_FILE_MESSAGE);
    expect(() => detectFileType('data.json')).toThrow(UNSUPPORTED_FILE_MESSAGE);
    expect(() => detectFileType('noextension')).toThrow(UNSUPPORTED_FILE_MESSAGE);
  });
});

describe('normalizeHeader', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeHeader('Object ID')).toBe('objectid');
    expect(normalizeHeader('object_id')).toBe('objectid');
    expect(normalizeHeader('OBJECT-ID')).toBe('objectid');
  });
});

describe('parseSpreadsheetBuffer — CSV', () => {
  it('parses headers + rows with values as trimmed strings', () => {
    const result = parseSpreadsheetBuffer(
      csvBuffer('Name,Object ID,Email\n  Alice  ,1234567890123,alice@example.com\nBob,0042,bob@example.com\n'),
      'contacts.csv',
    );

    expect(result.fileType).toBe('csv');
    expect(result.columns).toEqual(['Name', 'Object ID', 'Email']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      Name: 'Alice',
      'Object ID': '1234567890123',
      Email: 'alice@example.com',
    });
  });

  it('preserves long numeric IDs and leading zeros as strings', () => {
    const result = parseSpreadsheetBuffer(
      csvBuffer('Id,Zip\n9007199254740993,00501\n'),
      'ids.csv',
    );

    // Above Number.MAX_SAFE_INTEGER — would corrupt if coerced to a float
    expect(result.rows[0].Id).toBe('9007199254740993');
    expect(result.rows[0].Zip).toBe('00501');
  });

  it('skips fully blank rows and counts them', () => {
    const result = parseSpreadsheetBuffer(
      csvBuffer('Name,Email\nAlice,a@x.com\n,\n\nBob,b@x.com\n'),
      'contacts.csv',
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.Name)).toEqual(['Alice', 'Bob']);
    expect(result.blankRowsSkipped).toBeGreaterThanOrEqual(1);
  });

  it('rejects byte-identical duplicate headers with an actionable message', () => {
    expect(() =>
      parseSpreadsheetBuffer(csvBuffer('Email,Email\na@x.com,b@x.com\n'), 'dupes.csv'),
    ).toThrow(/Duplicate column headers found: .*"Email".*unique/);
  });

  it('keeps headers that only collide after normalization as distinct columns', () => {
    // Real Smartsheet export shape: "Contact$" and "Contact%" both normalize
    // to "contact" but are separate columns and must both survive.
    const result = parseSpreadsheetBuffer(
      csvBuffer('Vendor ID,Contact$,Contact%\nV-1,Janet doe,janet@x.com\n'),
      'vendors.csv',
    );
    expect(result.columns).toEqual(['Vendor ID', 'Contact$', 'Contact%']);
    expect(result.rows[0]['Contact$']).toBe('Janet doe');
    expect(result.rows[0]['Contact%']).toBe('janet@x.com');
  });

  it('sniffs semicolon-delimited CSV exports', () => {
    const result = parseSpreadsheetBuffer(
      csvBuffer('Vendor ID;Vendor Name;Value\nV-10010;Create22Maestro;3500\n0192837465;Kayaki;120\n'),
      'export.csv',
    );
    expect(result.columns).toEqual(['Vendor ID', 'Vendor Name', 'Value']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]['Vendor ID']).toBe('0192837465');
  });

  it('rejects an empty file', () => {
    expect(() => parseSpreadsheetBuffer(csvBuffer(''), 'empty.csv')).toThrow();
  });
});

describe('parseSpreadsheetBuffer — TSV', () => {
  it('parses tab-separated values', () => {
    const result = parseSpreadsheetBuffer(
      csvBuffer('Name\tAmount\nAlice\t120.50\nBob\t99\n'),
      'export.tsv',
    );

    expect(result.fileType).toBe('tsv');
    expect(result.columns).toEqual(['Name', 'Amount']);
    expect(result.rows[0]).toEqual({ Name: 'Alice', Amount: '120.50' });
    expect(result.rows[1]).toEqual({ Name: 'Bob', Amount: '99' });
  });
});

describe('parseSpreadsheetBuffer — XLSX', () => {
  it('parses cells to formatted strings (text cells keep long IDs intact)', () => {
    const buffer = xlsxBuffer([
      ['Name', 'Object ID'],
      ['Alice', '1234567890123'],
    ]);
    const result = parseSpreadsheetBuffer(buffer, 'contacts.xlsx');

    expect(result.fileType).toBe('xlsx');
    expect(result.columns).toEqual(['Name', 'Object ID']);
    expect(result.rows[0]['Object ID']).toBe('1234567890123');
  });

  it('lists all sheet names and defaults to the first sheet', () => {
    const buffer = xlsxBuffer(
      [['A'], ['first']],
      'Main',
      { Extra: [['B'], ['second']] },
    );
    const result = parseSpreadsheetBuffer(buffer, 'book.xlsx');

    expect(result.sheetNames).toEqual(['Main', 'Extra']);
    expect(result.sheetName).toBe('Main');
    expect(result.rows[0]).toEqual({ A: 'first' });
  });

  it('selects the requested sheet', () => {
    const buffer = xlsxBuffer(
      [['A'], ['first']],
      'Main',
      { Extra: [['B'], ['second']] },
    );
    const result = parseSpreadsheetBuffer(buffer, 'book.xlsx', 'Extra');

    expect(result.sheetName).toBe('Extra');
    expect(result.columns).toEqual(['B']);
    expect(result.rows[0]).toEqual({ B: 'second' });
  });

  it('rejects an unknown sheet name', () => {
    const buffer = xlsxBuffer([['A'], ['x']]);
    expect(() => parseSpreadsheetBuffer(buffer, 'book.xlsx', 'Missing')).toThrow(/was not found/);
  });
});

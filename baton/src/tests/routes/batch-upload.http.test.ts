/**
 * Bulk Upload file upload over HTTP — Baton
 *
 * POST /api/batch-processors/:id/uploads takes a multipart body. These tests
 * send real multipart requests - well-formed, oversized and malformed - through
 * the route and its multipart parser, with the services behind it stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const { mockBatch } = vi.hoisted(() => ({
  mockBatch: {
    getProcessor: vi.fn(),
    parseSpreadsheetBuffer: vi.fn(),
    deleteDraftRuns: vi.fn(),
    createRunWithRows: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/client', () => ({
  getDocClient: () => ({ send: vi.fn(async () => ({})) }),
  TableNames: { USERS: 'baton-users' },
}));
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { orgId: 'org-1', userId: 'user-1', role: 'owner' };
    next();
  },
}));
vi.mock('../../middleware/rbac', () => ({
  requireMember: (_req: any, _res: any, next: any) => next(),
  requireViewer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../services/audit.service', () => ({ logAudit: vi.fn() }));
vi.mock('../../services/batch.service', () => mockBatch);
vi.mock('../../services/flow-layout.service', () => ({ removeFlowPositions: vi.fn() }));
vi.mock('../../services/maestro.service', () => ({}));
vi.mock('../../services/connection.service', () => ({}));
vi.mock('../../services/instance.service', () => ({ cancelWorkflowInstance: vi.fn() }));
vi.mock('../../lib/billing-hooks', () => ({ getRelayGate: vi.fn() }));

import batchRouter from '../../routes/batch-processors';
import { mountBodyParsers } from '../../middleware/body-parsers';
import { errorHandler } from '../../middleware/error-handler';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  mountBodyParsers(app);
  app.use('/api/batch-processors', batchRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockBatch.getProcessor.mockResolvedValue({ id: 'bp-1', orgId: 'org-1', name: 'Onboarding' });
  mockBatch.parseSpreadsheetBuffer.mockReturnValue({
    columns: ['name', 'email'],
    rows: [{ name: 'Ada', email: 'ada@example.com' }],
    blankRowsSkipped: 0,
    sheetNames: [],
    sheetName: undefined,
  });
  mockBatch.deleteDraftRuns.mockResolvedValue(undefined);
  mockBatch.createRunWithRows.mockResolvedValue({ id: 'run-1', fileName: 'people.csv', totalRows: 1 });
});

const URL_PATH = '/api/batch-processors/bp-1/uploads';
const BOUNDARY = '----batonTestBoundary7MA4YWxkTrZu0gW';

/** A multipart body built by hand, so malformed variants are possible. */
function multipart(parts: string[], { close = true } = {}): Buffer {
  const body = parts.map((p) => `--${BOUNDARY}\r\n${p}\r\n`).join('') + (close ? `--${BOUNDARY}--\r\n` : '');
  return Buffer.from(body, 'utf8');
}

const filePart = (content: string, field = 'file', filename = 'people.csv') =>
  `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}`;

const fieldPart = (name: string, value: string) =>
  `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;

async function post(body: Buffer | FormData, contentType?: string) {
  const res = await fetch(base + URL_PATH, {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

/** The server answers a plain request: it survived whatever came before. */
async function expectServerAlive() {
  const res = await post(multipart([filePart('name,email\nAda,ada@example.com\n')]), MULTIPART);
  expect(res.status).toBe(200);
}

describe('POST /api/batch-processors/:id/uploads', () => {
  it('accepts a file sent the way the browser sends it', async () => {
    const csv = 'name,email\nAda,ada@example.com\n';
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'people.csv');

    const res = await post(form);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ runId: 'run-1', columns: ['name', 'email'], totalRows: 1 });

    const [buffer, filename, sheet] = mockBatch.parseSpreadsheetBuffer.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString('utf8')).toBe(csv);
    expect(filename).toBe('people.csv');
    expect(sheet).toBeUndefined();
  });

  it('passes the sheet name from the query string', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'application/octet-stream' }), 'book.xlsx');

    const res = await fetch(`${base}${URL_PATH}?sheet=Q3`, { method: 'POST', body: form });

    expect(res.status).toBe(200);
    expect(mockBatch.parseSpreadsheetBuffer.mock.calls[0][2]).toBe('Q3');
  });

  it('keeps binary content byte for byte', async () => {
    const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
    const form = new FormData();
    form.append('file', new Blob([bytes]), 'book.xlsx');

    await post(form);

    expect(Buffer.compare(mockBatch.parseSpreadsheetBuffer.mock.calls[0][0], bytes)).toBe(0);
  });

  it('answers 400 when no file is attached', async () => {
    const res = await post(multipart([fieldPart('note', 'no file here')]), MULTIPART);

    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Attach a CSV, XLSX or TSV file in the "file" field.');
    expect(mockBatch.createRunWithRows).not.toHaveBeenCalled();
  });

  it('answers 400 to a file over 10MB and creates nothing', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)]), 'big.csv');

    const res = await post(form);

    expect(res.status).toBe(400);
    expect(res.json.message).toBe('The file is larger than 10MB. Split it into smaller files and try again.');
    expect(mockBatch.parseSpreadsheetBuffer).not.toHaveBeenCalled();
    expect(mockBatch.createRunWithRows).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly 10MB', async () => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.alloc(10 * 1024 * 1024, 0x61)]), 'limit.csv');

    const res = await post(form);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/batch-processors/:id/uploads — requests it cannot read', () => {
  const UNREADABLE = 'The upload could not be read. Send one CSV, XLSX or TSV file in the "file" field.';

  it.each([
    ['a file in a field with another name', () => multipart([filePart('a,b\n1,2\n', 'attachment')])],
    ['a second file', () => multipart([filePart('a\n1\n'), filePart('b\n2\n', 'file', 'second.csv')])],
    ['more fields than the route takes', () =>
      multipart([...Array.from({ length: 11 }, (_, i) => fieldPart(`f${i}`, 'v')), filePart('a\n1\n')])],
    ['a field name longer than the limit', () => multipart([fieldPart('n'.repeat(101), 'v'), filePart('a\n1\n')])],
    ['a body that ends before its closing boundary', () => multipart([filePart('a,b\n1,2')], { close: false })],
  ])('answers 400 to %s', async (_what, build) => {
    const res = await post(build(), MULTIPART);

    expect(res.status).toBe(400);
    expect(res.json.message).toBe(UNREADABLE);
    expect(mockBatch.createRunWithRows).not.toHaveBeenCalled();
    await expectServerAlive();
  });

  it.each([
    ['deeply nested brackets in a field name', `a${'[b]'.repeat(5000)}`],
    ['a very large array index in a field name', 'items[99999999999999999999]'],
    ['a field name of brackets only', '[]'.repeat(2000)],
    ['a prototype key as a field name', '__proto__[polluted]'],
  ])('survives %s', async (_what, name) => {
    const res = await post(multipart([fieldPart(name, 'v'), filePart('a\n1\n')]), MULTIPART);

    // Either refused or read; never a crash, and never a server error.
    expect([200, 400]).toContain(res.status);
    expect(({} as any).polluted).toBeUndefined();
    await expectServerAlive();
  });

  it('answers 400 to a multipart request with no boundary', async () => {
    const res = await post(Buffer.from('not multipart at all'), 'multipart/form-data');

    expect(res.status).toBe(400);
    await expectServerAlive();
  });

  it('answers 400 to a JSON body, which carries no file', async () => {
    const res = await post(Buffer.from('{"file":"people.csv"}'), 'application/json');

    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Attach a CSV, XLSX or TSV file in the "file" field.');
  });
});

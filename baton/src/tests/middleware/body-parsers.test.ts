/**
 * Body Parser Tests — Baton
 *
 * Drives real HTTP requests through the parsers exactly as server.ts mounts
 * them. The webhook handlers are unit-tested with hand-built requests that
 * already carry a Buffer; whether a request ARRIVES as one is decided here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mountBodyParsers } from '../../middleware/body-parsers';
import { rawBodyOf, parseWebhookBody } from '../../lib/request';

let server: Server;
let base: string;

/** Reports what a handler mounted at this path would see. */
function probe(req: express.Request, res: express.Response) {
  const raw = rawBodyOf(req);
  let parsed: unknown = null;
  let parseError = false;
  if (raw) {
    try {
      parsed = parseWebhookBody(raw, req.headers['content-type']);
    } catch {
      parseError = true;
    }
  }
  res.json({
    isBuffer: Buffer.isBuffer(req.body),
    rawText: raw ? raw.toString('utf8') : null,
    parsed,
    parseError,
    body: Buffer.isBuffer(req.body) ? null : req.body,
  });
}

beforeAll(async () => {
  const app = express();
  mountBodyParsers(app);
  app.post('/api/webhooks/app/:key', probe);
  app.post('/api/webhooks/rule/:key', probe);
  app.post('/api/webhooks/zohocrm', probe);
  app.post('/api/postwebhook/:orgId/:endpointId', probe);
  app.post('/api/slack/events', probe);
  app.post('/api/automations', probe);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

async function post(path: string, body: string | undefined, contentType?: string) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  });
  return res.json() as Promise<{
    isBuffer: boolean; rawText: string | null; parsed: any; parseError: boolean; body: any;
  }>;
}

describe('webhook routes receive the bytes that were sent', () => {
  it('keeps a JSON body raw', async () => {
    const sent = '{"event":"deal.created",  "id": 7}';
    const seen = await post('/api/webhooks/app/k', sent, 'application/json');

    expect(seen.isBuffer).toBe(true);
    // Byte for byte, including the spacing a re-serialised object would lose.
    expect(seen.rawText).toBe(sent);
    expect(seen.parsed).toEqual({ event: 'deal.created', id: 7 });
  });

  it.each([
    '/api/webhooks/app/k',
    '/api/webhooks/rule/k',
    '/api/webhooks/zohocrm',
  ])('keeps a form post raw on %s', async (path) => {
    const sent = 'module=Deals&operation=insert&ids=101%2C102&name=Acme+Corp';
    const seen = await post(path, sent, 'application/x-www-form-urlencoded');

    expect(seen.isBuffer).toBe(true);
    expect(seen.rawText).toBe(sent);
    expect(seen.parsed).toEqual({ module: 'Deals', operation: 'insert', ids: '101,102', name: 'Acme Corp' });
  });

  it('keeps a form post with a charset raw', async () => {
    const seen = await post('/api/webhooks/app/k', 'a=1', 'application/x-www-form-urlencoded; charset=UTF-8');

    expect(seen.isBuffer).toBe(true);
    expect(seen.parsed).toEqual({ a: '1' });
  });

  it.each([
    ['text/plain', '{"event":"x"}'],
    ['application/vnd.api+json', '{"event":"x"}'],
    ['application/octet-stream', '{"event":"x"}'],
  ])('keeps a %s body raw', async (contentType, sent) => {
    const seen = await post('/api/webhooks/rule/k', sent, contentType);

    expect(seen.isBuffer).toBe(true);
    expect(seen.rawText).toBe(sent);
    expect(seen.parsed).toEqual({ event: 'x' });
  });

  it('keeps custom endpoint posts raw', async () => {
    const sent = '{"order":{"id":"ORD-7"}}';
    const seen = await post('/api/postwebhook/org-1/ep-1', sent, 'application/json');

    expect(seen.isBuffer).toBe(true);
    expect(seen.rawText).toBe(sent);
  });

  it('hands an empty body to the handler as an empty buffer, which does not parse', async () => {
    const seen = await post('/api/webhooks/app/k', undefined, 'application/json');

    // The handlers answer 400 to this: there is nothing to verify or relay.
    expect(seen.isBuffer).toBe(true);
    expect(seen.rawText).toBe('');
    expect(seen.parseError).toBe(true);
  });

  it('reports a body that is neither JSON nor a form as unparseable', async () => {
    const seen = await post('/api/webhooks/app/k', '<xml/>', 'application/xml');

    expect(seen.isBuffer).toBe(true);
    expect(seen.parseError).toBe(true);
  });
});

describe('Slack events', () => {
  it('keeps the JSON body raw for signature verification', async () => {
    const sent = '{"type":"url_verification","challenge":"abc"}';
    const seen = await post('/api/slack/events', sent, 'application/json');

    expect(seen.isBuffer).toBe(true);
    expect(seen.rawText).toBe(sent);
  });
});

describe('every other route', () => {
  it('receives parsed JSON', async () => {
    const seen = await post('/api/automations', '{"name":"New deal"}', 'application/json');

    expect(seen.isBuffer).toBe(false);
    expect(seen.body).toEqual({ name: 'New deal' });
  });

  it('receives parsed form fields', async () => {
    const seen = await post('/api/automations', 'name=New+deal', 'application/x-www-form-urlencoded');

    expect(seen.isBuffer).toBe(false);
    expect(seen.body).toEqual({ name: 'New deal' });
  });
});

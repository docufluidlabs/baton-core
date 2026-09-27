/**
 * Catalog webhooks over HTTP — Baton
 *
 * The whole inbound path as a platform sees it: a real HTTP request through
 * the body parsers server.ts mounts, the real routers, the real app catalog,
 * real encryption of the stored secret and the real event store. Only the
 * database and the queue are stubbed.
 *
 * The scenario is the one the Zoho CRM guide describes: Zoho posts form data
 * with Basic auth to the URL Baton shows on the automation.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const { mockSend, mockSendMessage } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('../../../env', () => ({
  default: {
    NODE_ENV: 'test',
    TOKEN_ENCRYPTION_KEY: 'catalog-webhooks-http-test-key-0123456789',
    DYNAMODB_TABLE_PREFIX: 'baton-',
    SQS_QUEUE_PREFIX: 'baton-',
  },
}));
vi.mock('../../../lib/logger', () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));
vi.mock('../../../db/client', () => ({
  getDocClient: () => ({ send: (cmd: any) => mockSend(cmd) }),
  TableNames: {
    AUTOMATION_RULES: 'baton-automation-rules',
    ORG_APPS: 'baton-org-apps',
    WEBHOOK_EVENTS: 'baton-webhook-events',
  },
}));
vi.mock('../../../queue/sqs-client', () => ({
  sendMessage: mockSendMessage,
  QueueNames: { WEBHOOK_PROCESSING: 'baton-webhook-processing' },
}));

import { mountBodyParsers } from '../../../middleware/body-parsers';
import ruleWebhookRouter from '../../../routes/webhooks/rule';
import appWebhookRouter from '../../../routes/webhooks/app';
import { encryptToken } from '../../../lib/encryption';
import { getAppTemplate } from '../../../lib/app-catalog';

const USERNAME = 'baton-zoho';
const PASSWORD = 'correct-horse-battery-staple';
const RULE_KEY = 'd'.repeat(64);
const APP_KEY = 'e'.repeat(64);
const ORG_ID = 'org-http';
const APP_ID = 'app-http';
const RULE_ID = 'rule-http';

let server: Server;
let base: string;
let secretKeyEnc: string;

const written: Record<string, any>[] = [];

function orgApp() {
  return {
    id: APP_ID, orgId: ORG_ID, appSlug: 'zohocrm', webhookKey: APP_KEY,
    secretKeyEnc, status: 'active', displayName: 'Zoho CRM',
  };
}

beforeAll(async () => {
  secretKeyEnc = encryptToken(`${USERNAME}:${PASSWORD}`);

  const app = express();
  mountBodyParsers(app);
  app.use('/api/webhooks/rule', ruleWebhookRouter);
  app.use('/api/webhooks/app', appWebhookRouter);

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
  written.length = 0;
  mockSendMessage.mockResolvedValue('msg-id');
  mockSend.mockImplementation((cmd: any) => {
    if (cmd instanceof QueryCommand) {
      if (cmd.input.TableName === 'baton-automation-rules') {
        return Promise.resolve({
          Items: cmd.input.ExpressionAttributeValues?.[':key'] === RULE_KEY
            ? [{
                id: RULE_ID, orgId: ORG_ID, sourcePlatform: 'zohocrm', appSlug: 'zohocrm',
                appId: APP_ID, status: 'active', webhookKey: RULE_KEY,
              }]
            : [],
        });
      }
      return Promise.resolve({
        Items: cmd.input.ExpressionAttributeValues?.[':key'] === APP_KEY ? [orgApp()] : [],
      });
    }
    if (cmd instanceof GetCommand) return Promise.resolve({ Item: orgApp() });
    if (cmd instanceof PutCommand) {
      written.push(cmd.input.Item as Record<string, any>);
      return Promise.resolve({});
    }
    if (cmd instanceof UpdateCommand) return Promise.resolve({});
    return Promise.resolve({});
  });
});

const basic = (username: string, password: string) =>
  'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

const FORM = 'module=Deals&operation=insert&ids=4876876000001%2C4876876000002&org_id=777';

async function post(path: string, body: string, headers: Record<string, string>) {
  const res = await fetch(base + path, { method: 'POST', headers, body });
  return { status: res.status, body: await res.json() as any };
}

/** Post-response work runs in setImmediate; give it a turn of the loop. */
async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
}

const storedEvent = () => written.find((item) => item.payload);

describe('the catalog as shipped', () => {
  it('verifies Zoho CRM and Power Automate with Basic auth', () => {
    expect(getAppTemplate('zohocrm' as any)?.verificationMethod.type).toBe('basic_auth');
    expect(getAppTemplate('powerautomate' as any)?.verificationMethod.type).toBe('basic_auth');
  });
});

describe.each([
  ['per-automation URL', `/api/webhooks/rule/${RULE_KEY}`],
  ['per-app URL', `/api/webhooks/app/${APP_KEY}`],
])('Zoho CRM form post to the %s', (_name, path) => {
  it('is accepted with the configured credentials and relayed with its fields intact', async () => {
    const res = await post(path, FORM, {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(USERNAME, PASSWORD),
    });
    await settle();

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const event = storedEvent();
    expect(event?.payload).toEqual({
      module: 'Deals',
      operation: 'insert',
      ids: '4876876000001,4876876000002',
      org_id: '777',
    });
    expect(event?.platform).toBe('zohocrm');

    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockSendMessage).toHaveBeenCalledWith(
      'baton-webhook-processing',
      expect.objectContaining({ eventId: event?.id, orgId: ORG_ID, connectionId: APP_ID }),
    );
  });

  it('does not keep the credentials in the stored event', async () => {
    await post(path, FORM, {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(USERNAME, PASSWORD),
    });
    await settle();

    expect(storedEvent()?.headers.authorization).toBe('Basic [REDACTED]');
    const everything = JSON.stringify(written);
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain(Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64'));
  });

  it('is rejected without credentials, and nothing is stored or queued', async () => {
    const res = await post(path, FORM, { 'content-type': 'application/x-www-form-urlencoded' });
    await settle();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing Authorization header' });
    expect(written).toEqual([]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('is rejected with a wrong password, and nothing is stored or queued', async () => {
    const res = await post(path, FORM, {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(USERNAME, 'a-guess'),
    });
    await settle();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
    expect(written).toEqual([]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('accepts the same event as JSON', async () => {
    const res = await post(
      path,
      JSON.stringify({ module: 'Deals', operation: 'insert', ids: ['4876876000001'], org_id: '777' }),
      { 'content-type': 'application/json', authorization: basic(USERNAME, PASSWORD) },
    );
    await settle();

    expect(res.status).toBe(200);
    expect(storedEvent()?.payload.ids).toEqual(['4876876000001']);
  });
});

describe('duplicate delivery', () => {
  it('gives a form post and a JSON post of the same event one idempotency key', async () => {
    const path = `/api/webhooks/rule/${RULE_KEY}`;
    await post(path, FORM, {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(USERNAME, PASSWORD),
    });
    await post(
      path,
      JSON.stringify({
        module: 'Deals', operation: 'insert', org_id: '777',
        ids: ['4876876000002', '4876876000001'],
      }),
      { 'content-type': 'application/json', authorization: basic(USERNAME, PASSWORD) },
    );
    await settle();

    const markers = written.map((item) => item.id).filter((id: string) => id.startsWith('dedup#'));
    expect(markers).toHaveLength(2);
    expect(markers[0]).toBe(markers[1]);
  });
});

describe('unknown keys', () => {
  it.each([
    `/api/webhooks/rule/${'0'.repeat(64)}`,
    `/api/webhooks/app/${'0'.repeat(64)}`,
  ])('answers 404 on %s whatever credentials are sent', async (path) => {
    const res = await post(path, FORM, {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basic(USERNAME, PASSWORD),
    });

    expect(res.status).toBe(404);
    expect(written).toEqual([]);
  });
});
